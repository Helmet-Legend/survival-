/**
 * Inventaire (cahier des charges §3 module 1) : articles, lots et
 * consommation.
 *
 * Un article (ex. « Riz ») possède plusieurs lots (ex. « 2 kg achetés le
 * 03/01, périment le 30/06 »). La consommation puise d'abord dans le lot qui
 * périme le plus tôt, puis dans le plus ancien (FEFO puis FIFO). Les lots non
 * périssables passent en dernier.
 *
 * Toutes les entrées sont validées ici avant d'atteindre SQLite : les
 * contraintes CHECK du schéma ne servent que de dernier rempart, et leurs
 * messages ne sont pas affichables.
 */
import { systemRandom } from '../crypto/native/random';
import { withTransaction } from '../db/transaction';
import type { SqlDatabase, SqlRow, SqlValue } from '../db/types';
import { isIsoDate, localToday } from '../lib/dates';
import {
  parseAttributes,
  serializeAttributes,
  validateItemAttributes,
  type ItemAttributes,
} from './attributes';
import {
  ITEM_CATEGORIES,
  ITEM_UNITS,
  type ItemCategory,
  type ItemUnit,
} from './types';

// --- Types ------------------------------------------------------------------

export type InventoryErrorCode =
  | 'VALIDATION'
  | 'NOT_FOUND'
  | 'INSUFFICIENT_STOCK';

export class InventoryError extends Error {
  readonly code: InventoryErrorCode;
  /** Champ en cause pour VALIDATION. */
  readonly field?: string;
  /** Quantité réellement disponible pour INSUFFICIENT_STOCK. */
  readonly available?: number;

  constructor(
    code: InventoryErrorCode,
    message: string,
    extra?: { field?: string; available?: number },
  ) {
    super(message);
    this.name = 'InventoryError';
    this.code = code;
    this.field = extra?.field;
    this.available = extra?.available;
  }
}

export interface ItemInput {
  name: string;
  category: ItemCategory;
  unit: ItemUnit;
  /** kcal par unité (`unit`) : par kg, par g, par pièce… Entier ou null. */
  caloriesPerUnit?: number | null;
  location?: string | null;
  isCritical?: boolean;
  notes?: string | null;
  /** Stock minimal souhaité, dans l'unité de l'article. */
  minStock?: number | null;
  /** Prévenir N jours avant la péremption (en plus des seuils 30/60/90). */
  alertDays?: number | null;
  /** Calibre des munitions (catégorie `weapon` seulement), ex. « 12/70 ». */
  caliber?: string | null;
  /** Contenance d'un contenant (bidon, boîte), dans l'unité de l'article. */
  packageSize?: number | null;
  /** Type au sein de la catégorie (ex. `canned`, `medicine`). */
  subtype?: string | null;
  /** Champs propres à la catégorie (potabilité, dosage, état…). */
  attributes?: ItemAttributes | null;
  /** Sac d'évacuation qui contient l'article, ou null (stock général). */
  bagId?: string | null;
}

export interface LotInput {
  quantity: number;
  /** `AAAA-MM-JJ`, aujourd'hui par défaut. */
  acquiredAt?: string;
  /** `AAAA-MM-JJ` (dernier jour consommable) ou null si non périssable. */
  expirationDate?: string | null;
}

export interface InventoryItem {
  id: string;
  name: string;
  category: ItemCategory;
  unit: ItemUnit;
  caloriesPerUnit: number | null;
  location: string | null;
  isCritical: boolean;
  notes: string | null;
  minStock: number | null;
  alertDays: number | null;
  caliber: string | null;
  packageSize: number | null;
  subtype: string | null;
  attributes: ItemAttributes;
  bagId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface InventoryLot {
  id: string;
  itemId: string;
  quantity: number;
  acquiredAt: string;
  expirationDate: string | null;
  /** Calculé à la date du jour. */
  isExpired: boolean;
  /** Boîte de rangement où se trouve le lot (absent : hors boîte). */
  box?: { id: string; labelNo: number };
}

export interface ItemSummary extends InventoryItem {
  /** Somme de tous les lots, périmés compris. */
  totalQuantity: number;
  /** Somme des lots non périmés. */
  usableQuantity: number;
  lotCount: number;
  /** Prochaine péremption parmi les lots non périmés. */
  nextExpiration: string | null;
}

export interface ItemFilter {
  category?: ItemCategory;
  criticalOnly?: boolean;
  /** Recherche dans le nom, insensible à la casse et aux accents. */
  query?: string;
  /**
   * `'none'` : stock général seulement (hors sacs) ; un identifiant : le
   * contenu de ce sac ; absent : tout.
   */
  bag?: string;
}

export interface ConsumedPortion {
  lotId: string;
  quantity: number;
  expirationDate: string | null;
}

/** Nature d'un mouvement de stock. */
export type MovementKind = 'in' | 'out' | 'discard' | 'correct' | 'deleted';
/** D'où vient le mouvement : saisie dans les stocks, scanner, fiche d'ajout. */
export type MovementOrigin = 'manual' | 'scan' | 'form';

export interface StockMovement {
  id: string;
  itemId: string | null;
  itemName: string;
  unit: ItemUnit;
  kind: MovementKind;
  /** Positif pour une entrée, négatif pour une sortie. */
  quantity: number;
  origin: MovementOrigin;
  /** Horodatage ISO (UTC). */
  createdAt: string;
}

export interface MovementFilter {
  itemId?: string;
  /** Entrées (`in`) ou sorties (retraits, périmés, corrections négatives). */
  direction?: 'in' | 'out';
  limit?: number;
}

export interface ConsumptionResult {
  taken: ConsumedPortion[];
  /** Quantité utilisable restante pour cet article. */
  remaining: number;
}

export interface InventoryRepositoryOptions {
  /** Générateur d'identifiants (UUID v4 par défaut). */
  newId?: () => string;
  /** Date du jour `AAAA-MM-JJ` (horloge injectable pour les tests). */
  today?: () => string;
}

// --- Validation -------------------------------------------------------------

const NAME_MAX = 120;
const TEXT_MAX = 500;
/** Les quantités sont arrondies au millionième pour éviter 0,30000000000000004. */
const QUANTITY_SCALE = 1e6;

export function roundQuantity(value: number): number {
  return Math.round(value * QUANTITY_SCALE) / QUANTITY_SCALE;
}

function invalid(field: string, message: string): InventoryError {
  return new InventoryError('VALIDATION', message, { field });
}

function cleanText(
  value: string | null | undefined,
  field: string,
): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  const trimmed = value.trim();
  if (trimmed.length > TEXT_MAX) {
    throw invalid(field, `${TEXT_MAX} caractères au maximum`);
  }
  return trimmed === '' ? null : trimmed;
}

interface CleanItem {
  name: string;
  category: ItemCategory;
  unit: ItemUnit;
  caloriesPerUnit: number | null;
  location: string | null;
  isCritical: boolean;
  notes: string | null;
  minStock: number | null;
  alertDays: number | null;
  caliber: string | null;
  packageSize: number | null;
  subtype: string | null;
  attributes: ItemAttributes;
  bagId: string | null;
}

const SUBTYPE_RE = /^[a-z_]{1,30}$/;

export const CALIBER_MAX = 40;

function validateItem(input: ItemInput): CleanItem {
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  if (name === '') {
    throw invalid('name', 'Le nom est obligatoire');
  }
  if (name.length > NAME_MAX) {
    throw invalid('name', `${NAME_MAX} caractères au maximum`);
  }
  if (!ITEM_CATEGORIES.includes(input.category)) {
    throw invalid('category', 'Catégorie inconnue');
  }
  if (!ITEM_UNITS.includes(input.unit)) {
    throw invalid('unit', 'Unité inconnue');
  }
  if (input.category === 'water' && input.unit !== 'L' && input.unit !== 'mL') {
    throw invalid('unit', "L'eau se compte en litres ou en millilitres");
  }
  const calories = input.caloriesPerUnit ?? null;
  if (calories !== null && (!Number.isInteger(calories) || calories < 0)) {
    throw invalid(
      'caloriesPerUnit',
      'Les calories doivent être un entier positif',
    );
  }
  return {
    name,
    category: input.category,
    unit: input.unit,
    caloriesPerUnit: calories,
    location: cleanText(input.location, 'location'),
    isCritical: input.isCritical === true,
    notes: cleanText(input.notes, 'notes'),
    minStock: validateMinStock(input.minStock),
    alertDays: validateAlertDays(input.alertDays),
    // Le calibre n'a de sens que pour les munitions : ignoré ailleurs.
    caliber:
      input.category === 'weapon' ? validateCaliber(input.caliber) : null,
    packageSize: validatePackageSize(input.packageSize),
    subtype: validateSubtype(input.subtype),
    attributes: validateItemAttributes(input.attributes),
    bagId:
      typeof input.bagId === 'string' && input.bagId !== ''
        ? input.bagId
        : null,
  };
}

function validateSubtype(value: string | null | undefined): string | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  if (!SUBTYPE_RE.test(value)) {
    throw invalid('subtype', 'Type inconnu');
  }
  return value;
}

function validatePackageSize(value: number | null | undefined): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (!Number.isFinite(value) || value <= 0) {
    throw invalid('packageSize', 'La contenance doit être un nombre positif');
  }
  return roundQuantity(value);
}

function validateCaliber(value: string | null | undefined): string | null {
  const caliber = cleanText(value, 'caliber');
  if (caliber !== null && caliber.length > CALIBER_MAX) {
    throw invalid('caliber', `${CALIBER_MAX} caractères au maximum`);
  }
  return caliber;
}

function validateMinStock(value: number | null | undefined): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (!Number.isFinite(value) || value < 0) {
    throw invalid('minStock', 'Le stock minimal doit être un nombre positif');
  }
  return value === 0 ? null : roundQuantity(value);
}

export const ALERT_DAYS_MAX = 3650;

function validateAlertDays(value: number | null | undefined): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (!Number.isInteger(value) || value < 1 || value > ALERT_DAYS_MAX) {
    throw invalid(
      'alertDays',
      `Le délai d'alerte doit être un nombre de jours entre 1 et ${ALERT_DAYS_MAX}`,
    );
  }
  return value;
}

function validateQuantity(value: number, field = 'quantity'): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw invalid(field, 'La quantité doit être un nombre positif');
  }
  const rounded = roundQuantity(value);
  if (rounded <= 0) {
    throw invalid(field, 'Quantité trop petite');
  }
  return rounded;
}

function validateDate(
  value: string | null | undefined,
  field: string,
): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (!isIsoDate(value)) {
    throw invalid(field, 'Date invalide (format AAAA-MM-JJ attendu)');
  }
  return value;
}

/** Minuscules sans accents, pour la recherche. */
export function fold(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

// --- Identifiants -----------------------------------------------------------

/** UUID v4 à partir du CSPRNG du système. */
export function randomUuid(): string {
  const b = systemRandom.bytes(16);
  b[6] = (b[6] % 16) + 64; // version 4
  b[8] = (b[8] % 64) + 128; // variante RFC 4122
  const hex = Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(
    12,
    16,
  )}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// --- Correspondance lignes SQL → objets -------------------------------------

function toItem(row: SqlRow): InventoryItem {
  return {
    id: String(row.id),
    name: String(row.name),
    category: row.category as ItemCategory,
    unit: row.unit as ItemUnit,
    caloriesPerUnit:
      row.calories_per_unit === null ? null : Number(row.calories_per_unit),
    location: row.location === null ? null : String(row.location),
    isCritical: Number(row.is_critical) === 1,
    notes: row.notes === null ? null : String(row.notes),
    minStock: row.min_stock === null ? null : Number(row.min_stock),
    alertDays: row.alert_days === null ? null : Number(row.alert_days),
    caliber:
      row.caliber === null || row.caliber === undefined
        ? null
        : String(row.caliber),
    packageSize:
      row.package_size === null || row.package_size === undefined
        ? null
        : Number(row.package_size),
    subtype:
      row.subtype === null || row.subtype === undefined
        ? null
        : String(row.subtype),
    attributes: parseAttributes<ItemAttributes>(row.attributes),
    bagId:
      row.bag_id === null || row.bag_id === undefined
        ? null
        : String(row.bag_id),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

const ITEM_COLUMNS = `i.id, i.name, i.category, i.unit, i.calories_per_unit,
  i.location, i.is_critical, i.notes, i.min_stock, i.alert_days, i.caliber, i.package_size, i.subtype, i.attributes,
  i.bag_id, i.created_at, i.updated_at`;

/**
 * Ordre de consommation : lots hors boîte d'abord (une boîte fermée reste
 * fermée), puis péremption la plus proche, lots non périssables en dernier,
 * puis le plus ancien.
 */
const CONSUMPTION_ORDER = `(box_id IS NOT NULL), (expiration_date IS NULL), expiration_date,
  acquired_at, created_at, id`;

// --- Dépôt ------------------------------------------------------------------

export class InventoryRepository {
  private readonly newId: () => string;
  private readonly today: () => string;

  constructor(
    private readonly db: SqlDatabase,
    options: InventoryRepositoryOptions = {},
  ) {
    this.newId = options.newId ?? randomUuid;
    this.today = options.today ?? (() => localToday());
  }

  // --- Articles -------------------------------------------------------------

  /** Crée un article, avec éventuellement son premier lot. */
  async createItem(
    input: ItemInput,
    firstLot?: LotInput,
    options: { origin?: MovementOrigin } = {},
  ): Promise<InventoryItem> {
    const item = validateItem(input);
    const lot = firstLot === undefined ? null : this.validateLot(firstLot);
    const id = this.newId();
    return withTransaction(this.db, async () => {
      await this.db.execute(
        `INSERT INTO inventory_items
           (id, name, category, unit, calories_per_unit, location, is_critical,
            notes, min_stock, alert_days, caliber, package_size, subtype,
            attributes, bag_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          item.name,
          item.category,
          item.unit,
          item.caloriesPerUnit,
          item.location,
          item.isCritical ? 1 : 0,
          item.notes,
          item.minStock,
          item.alertDays,
          item.caliber,
          item.packageSize,
          item.subtype,
          serializeAttributes(item.attributes),
          item.bagId,
        ],
      );
      if (lot !== null) {
        await this.insertLot(id, lot);
        await this.record(id, 'in', lot.quantity, options.origin ?? 'form');
      }
      return this.requireItem(id);
    });
  }

  /** Modifie un article. Les champs absents de `patch` sont conservés. */
  async updateItem(
    id: string,
    patch: Partial<ItemInput>,
  ): Promise<InventoryItem> {
    return withTransaction(this.db, async () => {
      const current = await this.requireItem(id);
      const item = validateItem({ ...current, ...patch });
      if (item.unit !== current.unit) {
        // 2 « kg » deviendraient 2 « g » : on refuse plutôt que de fausser le stock.
        const { rows } = await this.db.execute(
          'SELECT 1 FROM inventory_lots WHERE item_id = ? LIMIT 1',
          [id],
        );
        if (rows.length > 0) {
          throw invalid(
            'unit',
            "Impossible de changer l'unité d'un article qui a du stock",
          );
        }
      }
      await this.db.execute(
        `UPDATE inventory_items
            SET name = ?, category = ?, unit = ?, calories_per_unit = ?,
                location = ?, is_critical = ?, notes = ?,
                min_stock = ?, alert_days = ?, caliber = ?,
                package_size = ?, subtype = ?, attributes = ?, bag_id = ?
          WHERE id = ?`,
        [
          item.name,
          item.category,
          item.unit,
          item.caloriesPerUnit,
          item.location,
          item.isCritical ? 1 : 0,
          item.notes,
          item.minStock,
          item.alertDays,
          item.caliber,
          item.packageSize,
          item.subtype,
          serializeAttributes(item.attributes),
          item.bagId,
          id,
        ],
      );
      return this.requireItem(id);
    });
  }

  /** Supprime un article et tous ses lots. */
  async deleteItem(id: string): Promise<void> {
    await this.requireItem(id);
    await withTransaction(this.db, async () => {
      const { rows } = await this.db.execute(
        'SELECT COALESCE(SUM(quantity), 0) AS q FROM inventory_lots WHERE item_id = ?',
        [id],
      );
      const total = roundQuantity(Number(rows[0].q));
      if (total > 0) {
        await this.record(id, 'deleted', -total, 'manual');
      }
      await this.db.execute('DELETE FROM inventory_items WHERE id = ?', [id]);
    });
  }

  async getItem(
    id: string,
  ): Promise<{ item: InventoryItem; lots: InventoryLot[] }> {
    const item = await this.requireItem(id);
    const { rows } = await this.db.execute(
      `SELECT id, item_id, quantity, acquired_at, expiration_date, box_id,
              (SELECT label_no FROM boxes WHERE boxes.id = box_id) AS box_label
         FROM inventory_lots
        WHERE item_id = ?
        ORDER BY ${CONSUMPTION_ORDER}`,
      [id],
    );
    return { item, lots: rows.map(row => this.toLot(row)) };
  }

  /** Articles avec leurs totaux, critiques d'abord puis par nom. */
  async listItems(filter: ItemFilter = {}): Promise<ItemSummary[]> {
    const where: string[] = [];
    const params: SqlValue[] = [this.today(), this.today()];
    if (filter.category !== undefined) {
      where.push('i.category = ?');
      params.push(filter.category);
    }
    if (filter.criticalOnly === true) {
      where.push('i.is_critical = 1');
    }
    if (filter.bag === 'none') {
      where.push('i.bag_id IS NULL');
    } else if (filter.bag !== undefined) {
      where.push('i.bag_id = ?');
      params.push(filter.bag);
    }
    const { rows } = await this.db.execute(
      `SELECT ${ITEM_COLUMNS},
              COALESCE(SUM(l.quantity), 0) AS total_quantity,
              COALESCE(SUM(CASE WHEN l.expiration_date IS NULL
                                  OR l.expiration_date >= ?
                                THEN l.quantity END), 0) AS usable_quantity,
              COUNT(l.id) AS lot_count,
              MIN(CASE WHEN l.expiration_date >= ? AND l.quantity > 0
                       THEN l.expiration_date END) AS next_expiration
         FROM inventory_items AS i
         LEFT JOIN inventory_lots AS l ON l.item_id = i.id
        ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
        GROUP BY i.id
        ORDER BY i.is_critical DESC, i.name COLLATE NOCASE`,
      params,
    );
    const needle = filter.query === undefined ? '' : fold(filter.query.trim());
    return rows
      .map(row => ({
        ...toItem(row),
        totalQuantity: roundQuantity(Number(row.total_quantity)),
        usableQuantity: roundQuantity(Number(row.usable_quantity)),
        lotCount: Number(row.lot_count),
        nextExpiration:
          row.next_expiration === null ? null : String(row.next_expiration),
      }))
      .filter(item => needle === '' || fold(item.name).includes(needle));
  }

  // --- Lots -----------------------------------------------------------------

  async addLot(
    itemId: string,
    input: LotInput,
    options: { origin?: MovementOrigin } = {},
  ): Promise<InventoryLot> {
    const lot = this.validateLot(input);
    return withTransaction(this.db, async () => {
      await this.requireItem(itemId);
      const id = await this.insertLot(itemId, lot);
      await this.record(itemId, 'in', lot.quantity, options.origin ?? 'manual');
      return this.requireLot(id);
    });
  }

  /** Corrige un lot (recomptage, date mal saisie). Une quantité nulle supprime le lot. */
  async updateLot(
    lotId: string,
    patch: Partial<LotInput>,
  ): Promise<InventoryLot | null> {
    return withTransaction(this.db, async () => {
      const current = await this.requireLot(lotId);
      if (patch.quantity === 0) {
        await this.db.execute('DELETE FROM inventory_lots WHERE id = ?', [
          lotId,
        ]);
        await this.record(
          current.itemId,
          'correct',
          -current.quantity,
          'manual',
        );
        return null;
      }
      const lot = this.validateLot({
        quantity: patch.quantity ?? current.quantity,
        acquiredAt: patch.acquiredAt ?? current.acquiredAt,
        expirationDate:
          patch.expirationDate === undefined
            ? current.expirationDate
            : patch.expirationDate,
      });
      await this.db.execute(
        `UPDATE inventory_lots
            SET quantity = ?, acquired_at = ?, expiration_date = ?
          WHERE id = ?`,
        [lot.quantity, lot.acquiredAt, lot.expirationDate, lotId],
      );
      const delta = roundQuantity(lot.quantity - current.quantity);
      if (delta !== 0) {
        await this.record(current.itemId, 'correct', delta, 'manual');
      }
      return this.requireLot(lotId);
    });
  }

  async deleteLot(lotId: string): Promise<void> {
    const lot = await this.requireLot(lotId);
    await withTransaction(this.db, async () => {
      await this.db.execute('DELETE FROM inventory_lots WHERE id = ?', [lotId]);
      if (lot.quantity > 0) {
        await this.record(lot.itemId, 'correct', -lot.quantity, 'manual');
      }
    });
  }

  // --- Consommation ---------------------------------------------------------

  /**
   * Retire `quantity` (dans l'unité de l'article) en puisant dans les lots
   * selon l'ordre FEFO/FIFO. Les lots vidés sont supprimés. Les lots
   * périmés sont ignorés, sauf avec `allowExpired` (ex. eau de lavage).
   *
   * Tout ou rien : si le stock est insuffisant, rien n'est modifié et
   * l'erreur indique la quantité disponible.
   */
  async consume(
    itemId: string,
    quantity: number,
    options: { allowExpired?: boolean; origin?: MovementOrigin } = {},
  ): Promise<ConsumptionResult> {
    const wanted = validateQuantity(quantity);
    const today = this.today();
    return withTransaction(this.db, async () => {
      await this.requireItem(itemId);
      const { rows } = await this.db.execute(
        `SELECT id, quantity, expiration_date
           FROM inventory_lots
          WHERE item_id = ? AND quantity > 0
            AND (? OR expiration_date IS NULL OR expiration_date >= ?)
          ORDER BY ${CONSUMPTION_ORDER}`,
        [itemId, options.allowExpired === true ? 1 : 0, today],
      );

      const available = roundQuantity(
        rows.reduce((sum, row) => sum + Number(row.quantity), 0),
      );
      if (available < wanted) {
        throw new InventoryError(
          'INSUFFICIENT_STOCK',
          `Stock insuffisant : ${available} disponible(s)`,
          { available },
        );
      }

      const taken: ConsumedPortion[] = [];
      let left = wanted;
      for (const row of rows) {
        if (left <= 0) {
          break;
        }
        const lotQuantity = Number(row.quantity);
        const take = Math.min(lotQuantity, left);
        const rest = roundQuantity(lotQuantity - take);
        if (rest <= 0) {
          await this.db.execute('DELETE FROM inventory_lots WHERE id = ?', [
            row.id as string,
          ]);
        } else {
          await this.db.execute(
            'UPDATE inventory_lots SET quantity = ? WHERE id = ?',
            [rest, row.id as string],
          );
        }
        taken.push({
          lotId: String(row.id),
          quantity: take,
          expirationDate:
            row.expiration_date === null ? null : String(row.expiration_date),
        });
        left = roundQuantity(left - take);
      }

      await this.record(itemId, 'out', -wanted, options.origin ?? 'manual');
      return { taken, remaining: await this.usableQuantity(itemId, today) };
    });
  }

  /** Supprime tous les lots périmés (« jeter les périmés »). */
  async discardExpired(): Promise<InventoryLot[]> {
    const today = this.today();
    return withTransaction(this.db, async () => {
      const { rows } = await this.db.execute(
        `SELECT id, item_id, quantity, acquired_at, expiration_date
           FROM inventory_lots
          WHERE expiration_date IS NOT NULL AND quantity > 0
            AND expiration_date < ?
          ORDER BY expiration_date`,
        [today],
      );
      await this.db.execute(
        `DELETE FROM inventory_lots
          WHERE expiration_date IS NOT NULL AND expiration_date < ?`,
        [today],
      );
      const lots = rows.map(row => this.toLot(row));
      for (const lot of lots) {
        await this.record(lot.itemId, 'discard', -lot.quantity, 'manual');
      }
      return lots;
    });
  }

  // --- Historique -----------------------------------------------------------

  /** Mouvements les plus récents d'abord (200 par défaut). */
  async listMovements(filter: MovementFilter = {}): Promise<StockMovement[]> {
    const where: string[] = [];
    const params: SqlValue[] = [];
    if (filter.itemId !== undefined) {
      where.push('item_id = ?');
      params.push(filter.itemId);
    }
    if (filter.direction === 'in') {
      where.push('quantity > 0');
    } else if (filter.direction === 'out') {
      where.push('quantity < 0');
    }
    params.push(Math.max(1, Math.min(1000, filter.limit ?? 200)));
    const { rows } = await this.db.execute(
      `SELECT id, item_id, item_name, unit, kind, quantity, origin, created_at
         FROM stock_movements
        ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY created_at DESC, rowid DESC
        LIMIT ?`,
      params,
    );
    return rows.map(r => ({
      id: String(r.id),
      itemId: r.item_id === null ? null : String(r.item_id),
      itemName: String(r.item_name),
      unit: r.unit as ItemUnit,
      kind: r.kind as MovementKind,
      quantity: Number(r.quantity),
      origin: r.origin as MovementOrigin,
      createdAt: String(r.created_at),
    }));
  }

  private async record(
    itemId: string,
    kind: MovementKind,
    quantity: number,
    origin: MovementOrigin,
  ): Promise<void> {
    const amount = roundQuantity(quantity);
    if (amount === 0) {
      return;
    }
    await this.db.execute(
      `INSERT INTO stock_movements (id, item_id, item_name, unit, kind, quantity, origin)
       SELECT ?, id, name, unit, ?, ?, ? FROM inventory_items WHERE id = ?`,
      [this.newId(), kind, amount, origin, itemId],
    );
  }

  // --- Interne --------------------------------------------------------------

  private validateLot(input: LotInput): {
    quantity: number;
    acquiredAt: string;
    expirationDate: string | null;
  } {
    return {
      quantity: validateQuantity(input.quantity),
      acquiredAt: validateDate(input.acquiredAt, 'acquiredAt') ?? this.today(),
      expirationDate: validateDate(input.expirationDate, 'expirationDate'),
    };
  }

  private async insertLot(
    itemId: string,
    lot: {
      quantity: number;
      acquiredAt: string;
      expirationDate: string | null;
    },
  ): Promise<string> {
    const id = this.newId();
    await this.db.execute(
      `INSERT INTO inventory_lots (id, item_id, quantity, acquired_at, expiration_date)
       VALUES (?, ?, ?, ?, ?)`,
      [id, itemId, lot.quantity, lot.acquiredAt, lot.expirationDate],
    );
    return id;
  }

  private async usableQuantity(itemId: string, today: string): Promise<number> {
    const { rows } = await this.db.execute(
      `SELECT COALESCE(SUM(quantity), 0) AS q FROM inventory_lots
        WHERE item_id = ? AND (expiration_date IS NULL OR expiration_date >= ?)`,
      [itemId, today],
    );
    return roundQuantity(Number(rows[0].q));
  }

  private async requireItem(id: string): Promise<InventoryItem> {
    const { rows } = await this.db.execute(
      `SELECT ${ITEM_COLUMNS} FROM inventory_items AS i WHERE i.id = ?`,
      [id],
    );
    if (rows.length === 0) {
      throw new InventoryError('NOT_FOUND', 'Article introuvable');
    }
    return toItem(rows[0]);
  }

  private async requireLot(id: string): Promise<InventoryLot> {
    const { rows } = await this.db.execute(
      `SELECT id, item_id, quantity, acquired_at, expiration_date
         FROM inventory_lots WHERE id = ?`,
      [id],
    );
    if (rows.length === 0) {
      throw new InventoryError('NOT_FOUND', 'Lot introuvable');
    }
    return this.toLot(rows[0]);
  }

  private toLot(row: SqlRow): InventoryLot {
    const expirationDate =
      row.expiration_date === null ? null : String(row.expiration_date);
    return {
      id: String(row.id),
      itemId: String(row.item_id),
      quantity: roundQuantity(Number(row.quantity)),
      acquiredAt: String(row.acquired_at),
      expirationDate,
      isExpired: expirationDate !== null && expirationDate < this.today(),
      ...(typeof row.box_id === 'string' && row.box_label != null
        ? { box: { id: row.box_id, labelNo: Number(row.box_label) } }
        : {}),
    };
  }
}
