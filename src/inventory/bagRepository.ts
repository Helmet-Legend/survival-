/**
 * Sacs d'évacuation : un sac par personne (ou par véhicule), avec son propre
 * contenu. Le contenu est fait d'articles et de lots ordinaires (`bag_id`),
 * donc les fiches, la consommation FEFO et les péremptions sont les mêmes
 * que pour le stock général.
 */
import type { SqlDatabase, SqlRow } from '../db/types';
import { localToday } from '../lib/dates';
import { InventoryError, randomUuid } from './inventoryRepository';

export interface BagInput {
  name: string;
  /** Pour qui (« Léa », « Voiture »…), facultatif. */
  owner?: string | null;
  notes?: string | null;
}

export interface Bag {
  id: string;
  name: string;
  owner: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BagSummary extends Bag {
  itemCount: number;
  /** Lots périmés encore dans le sac. */
  expiredLots: number;
  /** Lots qui périment dans les 30 jours. */
  soonLots: number;
  /** Prochaine péremption parmi les lots non périmés. */
  nextExpiration: string | null;
}

/** Fenêtre « bientôt périmé » d'un sac, alignée sur les alertes à 30 jours. */
export const BAG_SOON_DAYS = 30;

function invalid(field: string, message: string): InventoryError {
  return new InventoryError('VALIDATION', message, { field });
}

function text(
  value: string | null | undefined,
  field: string,
  max: number,
): string | null {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (trimmed.length > max) {
    throw invalid(field, `${max} caractères au maximum`);
  }
  return trimmed === '' ? null : trimmed;
}

function validate(input: BagInput) {
  const name = text(input.name, 'name', 60);
  if (name === null) {
    throw invalid('name', 'Champ obligatoire');
  }
  return {
    name,
    owner: text(input.owner, 'owner', 60),
    notes: text(input.notes, 'notes', 500),
  };
}

function toBag(row: SqlRow): Bag {
  const optional = (value: unknown) => (value === null ? null : String(value));
  return {
    id: String(row.id),
    name: String(row.name),
    owner: optional(row.owner),
    notes: optional(row.notes),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export class BagRepository {
  private readonly newId: () => string;
  private readonly today: () => string;

  constructor(
    private readonly db: SqlDatabase,
    options: { newId?: () => string; today?: () => string } = {},
  ) {
    this.newId = options.newId ?? randomUuid;
    this.today = options.today ?? (() => localToday());
  }

  /** Sacs par nom, avec leur contenu et l'état de leurs péremptions. */
  async list(): Promise<BagSummary[]> {
    const today = this.today();
    const { rows } = await this.db.execute(
      `SELECT b.*,
              (SELECT COUNT(*) FROM inventory_items AS i
                WHERE i.bag_id = b.id) AS item_count,
              (SELECT COUNT(*) FROM inventory_lots AS l
                 JOIN inventory_items AS i ON i.id = l.item_id
                WHERE i.bag_id = b.id AND l.quantity > 0
                  AND l.expiration_date < ?) AS expired_lots,
              (SELECT COUNT(*) FROM inventory_lots AS l
                 JOIN inventory_items AS i ON i.id = l.item_id
                WHERE i.bag_id = b.id AND l.quantity > 0
                  AND l.expiration_date >= ?
                  AND l.expiration_date <= date(?, '+${BAG_SOON_DAYS} days')
              ) AS soon_lots,
              (SELECT MIN(l.expiration_date) FROM inventory_lots AS l
                 JOIN inventory_items AS i ON i.id = l.item_id
                WHERE i.bag_id = b.id AND l.quantity > 0
                  AND l.expiration_date >= ?) AS next_expiration
         FROM bags AS b
        ORDER BY b.name COLLATE NOCASE`,
      [today, today, today, today],
    );
    return rows.map(row => ({
      ...toBag(row),
      itemCount: Number(row.item_count),
      expiredLots: Number(row.expired_lots),
      soonLots: Number(row.soon_lots),
      nextExpiration:
        row.next_expiration === null ? null : String(row.next_expiration),
    }));
  }

  async get(id: string): Promise<Bag> {
    const { rows } = await this.db.execute('SELECT * FROM bags WHERE id = ?', [
      id,
    ]);
    if (rows.length === 0) {
      throw new InventoryError('NOT_FOUND', 'Sac introuvable');
    }
    return toBag(rows[0]);
  }

  async create(input: BagInput): Promise<Bag> {
    const bag = validate(input);
    const id = this.newId();
    await this.db.execute(
      'INSERT INTO bags (id, name, owner, notes) VALUES (?, ?, ?, ?)',
      [id, bag.name, bag.owner, bag.notes],
    );
    return this.get(id);
  }

  async update(id: string, input: BagInput): Promise<Bag> {
    await this.get(id);
    const bag = validate(input);
    await this.db.execute(
      'UPDATE bags SET name = ?, owner = ?, notes = ? WHERE id = ?',
      [bag.name, bag.owner, bag.notes, id],
    );
    return this.get(id);
  }

  /** Supprime le sac ; son contenu retourne dans le stock général. */
  async delete(id: string): Promise<void> {
    await this.get(id);
    await this.db.execute('DELETE FROM bags WHERE id = ?', [id]);
  }
}
