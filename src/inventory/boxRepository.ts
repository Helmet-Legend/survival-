/**
 * Boîtes de rangement étiquetées : chaque boîte a un numéro (attribué à la
 * suite des autres) et une étiquette QR. Son inventaire est fait de lots du
 * stock (`inventory_lots.box_id`) : une partie d'un article peut être dans
 * une boîte et le reste ailleurs. Mettre en boîte ou sortir de boîte ne
 * change ni les fiches ni le total du stock.
 *
 * L'étiquette ne contient que l'identifiant de la boîte, jamais son
 * contenu.
 */
import { withTransaction } from '../db/transaction';
import type { SqlDatabase, SqlRow } from '../db/types';
import { localToday } from '../lib/dates';
import {
  fold,
  InventoryError,
  randomUuid,
  roundQuantity,
} from './inventoryRepository';
import type { ItemCategory, ItemUnit } from './types';

export interface Box {
  id: string;
  /** Numéro imprimé sur l'étiquette. */
  labelNo: number;
  createdAt: string;
  updatedAt: string;
}

export interface BoxSummary extends Box {
  itemCount: number;
  /** Lots périmés dans la boîte. */
  expiredLots: number;
  /** Lots qui périment dans les 30 jours. */
  soonLots: number;
  /** Prochaine péremption parmi les lots non périmés. */
  nextExpiration: string | null;
}

/** Un article dans une boîte : quantité totale et prochaine péremption. */
export interface BoxLine {
  itemId: string;
  name: string;
  category: ItemCategory;
  unit: ItemUnit;
  quantity: number;
  nextExpiration: string | null;
  /** Quantité déjà périmée. */
  expired: number;
}

/** Article du stock de la maison qu'on peut mettre dans une boîte. */
export interface BoxCandidate {
  itemId: string;
  name: string;
  unit: ItemUnit;
  /** Quantité non périmée hors de toute boîte. */
  loose: number;
  /** Quantité déjà dans cette boîte. */
  inBox: number;
}

export const BOX_SOON_DAYS = 30;

/** Préfixe du texte des étiquettes : il ne contient que l'identifiant. */
export const BOX_QR_PREFIX = 'fenrir:boite:';

export function boxQr(id: string): string {
  return BOX_QR_PREFIX + id;
}

/** Identifiant lu sur une étiquette, ou null pour un autre QR code. */
export function parseBoxQr(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed.startsWith(BOX_QR_PREFIX)) {
    return null;
  }
  const id = trimmed.slice(BOX_QR_PREFIX.length);
  return /^[A-Za-z0-9-]{1,64}$/.test(id) ? id : null;
}

function toBox(row: SqlRow): Box {
  return {
    id: String(row.id),
    labelNo: Number(row.label_no),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export class BoxRepository {
  private readonly newId: () => string;
  private readonly today: () => string;

  constructor(
    private readonly db: SqlDatabase,
    options: { newId?: () => string; today?: () => string } = {},
  ) {
    this.newId = options.newId ?? randomUuid;
    this.today = options.today ?? (() => localToday());
  }

  /** Boîtes par numéro, avec l'état de leurs péremptions. */
  async list(): Promise<BoxSummary[]> {
    return this.summaries('1', []);
  }

  async summary(id: string): Promise<BoxSummary> {
    const [found] = await this.summaries('b.id = ?', [id]);
    if (found === undefined) {
      throw new InventoryError('NOT_FOUND', 'Boîte introuvable');
    }
    return found;
  }

  async get(id: string): Promise<Box> {
    const { rows } = await this.db.execute('SELECT * FROM boxes WHERE id = ?', [
      id,
    ]);
    if (rows.length === 0) {
      throw new InventoryError('NOT_FOUND', 'Boîte introuvable');
    }
    return toBox(rows[0]);
  }

  /** Nouvelle boîte, numérotée à la suite des autres. */
  async create(): Promise<Box> {
    const id = this.newId();
    await this.db.execute(
      `INSERT INTO boxes (id, label_no)
       SELECT ?, COALESCE(MAX(label_no), 0) + 1 FROM boxes`,
      [id],
    );
    return this.get(id);
  }

  /** Supprime la boîte ; son contenu reste dans le stock, hors boîte. */
  async delete(id: string): Promise<void> {
    await this.get(id);
    await withTransaction(this.db, async () => {
      const { rows } = await this.db.execute(
        'SELECT DISTINCT item_id FROM inventory_lots WHERE box_id = ?',
        [id],
      );
      for (const row of rows) {
        await this.move(String(row.item_id), id, null, Infinity);
      }
      await this.db.execute('DELETE FROM boxes WHERE id = ?', [id]);
    });
  }

  /** Contenu d'une boîte, article par article. */
  async contents(id: string): Promise<BoxLine[]> {
    const today = this.today();
    const { rows } = await this.db.execute(
      `SELECT i.id, i.name, i.category, i.unit,
              SUM(l.quantity) AS quantity,
              MIN(CASE WHEN l.expiration_date >= ? THEN l.expiration_date END)
                AS next_expiration,
              COALESCE(SUM(CASE WHEN l.expiration_date < ? THEN l.quantity END), 0)
                AS expired
         FROM inventory_lots AS l
         JOIN inventory_items AS i ON i.id = l.item_id
        WHERE l.box_id = ? AND l.quantity > 0
        GROUP BY i.id
        ORDER BY i.name COLLATE NOCASE`,
      [today, today, id],
    );
    return rows.map(row => ({
      itemId: String(row.id),
      name: String(row.name),
      category: String(row.category) as ItemCategory,
      unit: String(row.unit) as ItemUnit,
      quantity: roundQuantity(Number(row.quantity)),
      nextExpiration:
        row.next_expiration === null ? null : String(row.next_expiration),
      expired: roundQuantity(Number(row.expired)),
    }));
  }

  /**
   * Articles du stock de la maison (hors sacs d'évacuation) qui ont des
   * lots hors boîte ou dans cette boîte.
   */
  async candidates(id: string, query = ''): Promise<BoxCandidate[]> {
    const today = this.today();
    const { rows } = await this.db.execute(
      `SELECT i.id, i.name, i.unit,
              COALESCE(SUM(CASE WHEN l.box_id IS NULL
                                 AND (l.expiration_date IS NULL
                                      OR l.expiration_date >= ?)
                                THEN l.quantity END), 0) AS loose,
              COALESCE(SUM(CASE WHEN l.box_id = ? THEN l.quantity END), 0)
                AS in_box
         FROM inventory_items AS i
         JOIN inventory_lots AS l ON l.item_id = i.id AND l.quantity > 0
        WHERE i.bag_id IS NULL
        GROUP BY i.id
        HAVING loose > 0 OR in_box > 0
        ORDER BY in_box > 0 DESC, i.name COLLATE NOCASE`,
      [today, id],
    );
    const needle = fold(query.trim());
    return rows
      .map(row => ({
        itemId: String(row.id),
        name: String(row.name),
        unit: String(row.unit) as ItemUnit,
        loose: roundQuantity(Number(row.loose)),
        inBox: roundQuantity(Number(row.in_box)),
      }))
      .filter(c => needle === '' || fold(c.name).includes(needle));
  }

  /**
   * Met `quantity` de l'article dans la boîte, en prenant les lots hors
   * boîte qui périment le plus tard (les plus proches restent à portée de
   * main). Les lots périmés ne sont jamais mis en boîte.
   */
  async put(id: string, itemId: string, quantity: number): Promise<void> {
    await this.get(id);
    await withTransaction(this.db, () => this.move(itemId, null, id, quantity));
  }

  /** Sort `quantity` de l'article de la boîte (lots les plus proches d'abord). */
  async take(id: string, itemId: string, quantity: number): Promise<void> {
    await this.get(id);
    await withTransaction(this.db, () => this.move(itemId, id, null, quantity));
  }

  /**
   * Déplace une quantité d'un article entre « hors boîte » (`null`) et une
   * boîte, en coupant un lot si besoin. Le lot déplacé rejoint un lot de
   * même date à l'arrivée plutôt que d'en créer un double.
   */
  private async move(
    itemId: string,
    from: string | null,
    to: string | null,
    quantity: number,
  ): Promise<void> {
    if (!(quantity > 0)) {
      throw new InventoryError('VALIDATION', 'Quantité invalide', {
        field: 'quantity',
      });
    }
    const today = this.today();
    const intoBox = to !== null;
    const { rows } = await this.db.execute(
      `SELECT id, quantity, acquired_at, expiration_date
         FROM inventory_lots
        WHERE item_id = ? AND quantity > 0 AND box_id IS ?
          ${
            intoBox
              ? 'AND (expiration_date IS NULL OR expiration_date >= ?)'
              : ''
          }
        ORDER BY ${
          intoBox
            ? '(expiration_date IS NOT NULL), expiration_date DESC'
            : '(expiration_date IS NULL), expiration_date'
        }, acquired_at, id`,
      intoBox ? [itemId, from, today] : [itemId, from],
    );
    const available = roundQuantity(
      rows.reduce((sum, row) => sum + Number(row.quantity), 0),
    );
    if (quantity !== Infinity && available < roundQuantity(quantity)) {
      throw new InventoryError(
        'INSUFFICIENT_STOCK',
        `Quantité insuffisante : ${available} disponible(s)`,
        { available },
      );
    }
    let left = quantity === Infinity ? available : roundQuantity(quantity);
    for (const row of rows) {
      if (left <= 0) {
        break;
      }
      const lotQuantity = Number(row.quantity);
      const moved = Math.min(lotQuantity, left);
      const rest = roundQuantity(lotQuantity - moved);
      const expiration =
        row.expiration_date === null ? null : String(row.expiration_date);
      const { rows: twins } = await this.db.execute(
        `SELECT id FROM inventory_lots
          WHERE item_id = ? AND box_id IS ? AND acquired_at = ?
            AND expiration_date IS ? AND id <> ?
          LIMIT 1`,
        [itemId, to, String(row.acquired_at), expiration, String(row.id)],
      );
      const twin = twins.length > 0 ? String(twins[0].id) : null;
      if (twin !== null) {
        await this.db.execute(
          'UPDATE inventory_lots SET quantity = quantity + ? WHERE id = ?',
          [moved, twin],
        );
      } else if (rest > 0) {
        await this.db.execute(
          `INSERT INTO inventory_lots
             (id, item_id, quantity, acquired_at, expiration_date, box_id)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [
            this.newId(),
            itemId,
            moved,
            String(row.acquired_at),
            expiration,
            to,
          ],
        );
      }
      if (rest > 0) {
        await this.db.execute(
          'UPDATE inventory_lots SET quantity = ? WHERE id = ?',
          [rest, String(row.id)],
        );
      } else if (twin !== null) {
        await this.db.execute('DELETE FROM inventory_lots WHERE id = ?', [
          String(row.id),
        ]);
      } else {
        await this.db.execute(
          'UPDATE inventory_lots SET box_id = ? WHERE id = ?',
          [to, String(row.id)],
        );
      }
      left = roundQuantity(left - moved);
    }
  }

  private async summaries(
    where: string,
    params: string[],
  ): Promise<BoxSummary[]> {
    const today = this.today();
    const { rows } = await this.db.execute(
      `SELECT b.*,
              (SELECT COUNT(DISTINCT l.item_id) FROM inventory_lots AS l
                WHERE l.box_id = b.id AND l.quantity > 0) AS item_count,
              (SELECT COUNT(*) FROM inventory_lots AS l
                WHERE l.box_id = b.id AND l.quantity > 0
                  AND l.expiration_date < ?) AS expired_lots,
              (SELECT COUNT(*) FROM inventory_lots AS l
                WHERE l.box_id = b.id AND l.quantity > 0
                  AND l.expiration_date >= ?
                  AND l.expiration_date <= date(?, '+${BOX_SOON_DAYS} days')
              ) AS soon_lots,
              (SELECT MIN(l.expiration_date) FROM inventory_lots AS l
                WHERE l.box_id = b.id AND l.quantity > 0
                  AND l.expiration_date >= ?) AS next_expiration
         FROM boxes AS b
        WHERE ${where}
        ORDER BY b.label_no, b.created_at`,
      [today, today, today, today, ...params],
    );
    return rows.map(row => ({
      ...toBox(row),
      itemCount: Number(row.item_count),
      expiredLots: Number(row.expired_lots),
      soonLots: Number(row.soon_lots),
      nextExpiration:
        row.next_expiration === null ? null : String(row.next_expiration),
    }));
  }
}
