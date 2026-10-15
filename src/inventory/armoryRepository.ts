/**
 * Armes : modèle, type, calibre, numéro de série. Les munitions sont des
 * articles de stock (catégorie `weapon`) portant un calibre ; chaque arme
 * affiche les munitions utilisables (lots non périmés) de son calibre.
 *
 * Les calibres sont comparés sans tenir compte des espaces, de la casse ni
 * du séparateur décimal : « 9x19 », « 9 X 19 » et « 9×19 » désignent la
 * même munition.
 */
import type { SqlDatabase, SqlRow } from '../db/types';
import { localToday } from '../lib/dates';
import { InventoryError, randomUuid } from './inventoryRepository';

export const WEAPON_KINDS = ['rifle', 'shotgun', 'handgun', 'other'] as const;
export type WeaponKind = (typeof WEAPON_KINDS)[number];

export interface WeaponInput {
  model: string;
  kind: WeaponKind;
  caliber: string;
  serialNumber?: string | null;
  notes?: string | null;
}

export interface Weapon {
  id: string;
  model: string;
  kind: WeaponKind;
  caliber: string;
  serialNumber: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WeaponSummary extends Weapon {
  /** Munitions utilisables du même calibre (en pièces). */
  rounds: number;
}

const MODEL_MAX = 120;
const CALIBER_MAX = 40;
const SERIAL_MAX = 60;
const NOTES_MAX = 500;

function invalid(field: string, message: string): InventoryError {
  return new InventoryError('VALIDATION', message, { field });
}

function text(
  value: string | null | undefined,
  field: string,
  max: number,
  required: false,
): string | null;
function text(
  value: string | null | undefined,
  field: string,
  max: number,
  required: true,
): string;
function text(
  value: string | null | undefined,
  field: string,
  max: number,
  required: boolean,
): string | null {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (trimmed === '') {
    if (required) {
      throw invalid(field, 'Champ obligatoire');
    }
    return null;
  }
  if (trimmed.length > max) {
    throw invalid(field, `${max} caractères au maximum`);
  }
  return trimmed;
}

function validate(input: WeaponInput) {
  if (!WEAPON_KINDS.includes(input.kind)) {
    throw invalid('kind', 'Type d’arme inconnu');
  }
  return {
    model: text(input.model, 'model', MODEL_MAX, true),
    kind: input.kind,
    caliber: text(input.caliber, 'caliber', CALIBER_MAX, true),
    serialNumber: text(input.serialNumber, 'serialNumber', SERIAL_MAX, false),
    notes: text(input.notes, 'notes', NOTES_MAX, false),
  };
}

/** Clé de comparaison d'un calibre. */
export function caliberKey(caliber: string): string {
  return caliber
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/×/g, 'x')
    .replace(/,/g, '.')
    .replace(/\s+/g, '');
}

function toWeapon(row: SqlRow): Weapon {
  return {
    id: String(row.id),
    model: String(row.model),
    kind: row.kind as WeaponKind,
    caliber: String(row.caliber),
    serialNumber: row.serial_number === null ? null : String(row.serial_number),
    notes: row.notes === null ? null : String(row.notes),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export class ArmoryRepository {
  private readonly newId: () => string;
  private readonly today: () => string;

  constructor(
    private readonly db: SqlDatabase,
    options: { newId?: () => string; today?: () => string } = {},
  ) {
    this.newId = options.newId ?? randomUuid;
    this.today = options.today ?? (() => localToday());
  }

  /** Munitions utilisables par calibre (clé `caliberKey`). */
  async roundsByCaliber(): Promise<Map<string, number>> {
    const { rows } = await this.db.execute(
      `SELECT i.caliber AS caliber, SUM(l.quantity) AS rounds
         FROM inventory_items AS i
         JOIN inventory_lots AS l ON l.item_id = i.id
        WHERE i.category = 'weapon' AND i.unit = 'unit'
          AND i.caliber IS NOT NULL
          AND (l.expiration_date IS NULL OR l.expiration_date >= ?)
        GROUP BY i.caliber`,
      [this.today()],
    );
    const totals = new Map<string, number>();
    for (const row of rows) {
      const key = caliberKey(String(row.caliber));
      totals.set(key, (totals.get(key) ?? 0) + Number(row.rounds));
    }
    return totals;
  }

  /** Armes par modèle, avec leurs munitions disponibles. */
  async listWeapons(): Promise<WeaponSummary[]> {
    const [{ rows }, rounds] = await Promise.all([
      this.db.execute('SELECT * FROM weapons ORDER BY model COLLATE NOCASE'),
      this.roundsByCaliber(),
    ]);
    return rows.map(row => {
      const weapon = toWeapon(row);
      return { ...weapon, rounds: rounds.get(caliberKey(weapon.caliber)) ?? 0 };
    });
  }

  async createWeapon(input: WeaponInput): Promise<Weapon> {
    const weapon = validate(input);
    const id = this.newId();
    await this.db.execute(
      `INSERT INTO weapons (id, model, kind, caliber, serial_number, notes)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        id,
        weapon.model,
        weapon.kind,
        weapon.caliber,
        weapon.serialNumber,
        weapon.notes,
      ],
    );
    return this.requireWeapon(id);
  }

  async updateWeapon(id: string, input: WeaponInput): Promise<Weapon> {
    await this.requireWeapon(id);
    const weapon = validate(input);
    await this.db.execute(
      `UPDATE weapons
          SET model = ?, kind = ?, caliber = ?, serial_number = ?, notes = ?
        WHERE id = ?`,
      [
        weapon.model,
        weapon.kind,
        weapon.caliber,
        weapon.serialNumber,
        weapon.notes,
        id,
      ],
    );
    return this.requireWeapon(id);
  }

  /** Retire l'arme ; les munitions restent dans le stock. */
  async deleteWeapon(id: string): Promise<void> {
    await this.requireWeapon(id);
    await this.db.execute('DELETE FROM weapons WHERE id = ?', [id]);
  }

  private async requireWeapon(id: string): Promise<Weapon> {
    const { rows } = await this.db.execute(
      'SELECT * FROM weapons WHERE id = ?',
      [id],
    );
    if (rows.length === 0) {
      throw new InventoryError('NOT_FOUND', 'Arme introuvable');
    }
    return toWeapon(rows[0]);
  }
}
