/**
 * Tables partagées entre les téléphones d'un foyer, dans l'ordre où les
 * lignes reçues sont écrites (parents avant enfants). Les suppressions se
 * font dans l'ordre inverse.
 *
 * Restent propres à chaque téléphone : codes et réglages de l'appareil
 * (alertes, rappels, lumière rouge…), panier du scanner, cartes hors ligne,
 * guides intégrés et journal de synchronisation.
 */
import type { SqlValue } from '../db/types';

export interface SharedTable {
  readonly name: string;
  /** Colonnes de la clé primaire. */
  readonly keys: readonly string[];
}

export const SHARED_TABLES: readonly SharedTable[] = [
  { name: 'settings', keys: ['key'] },
  { name: 'family_plan', keys: ['id'] },
  { name: 'preparation_marks', keys: ['scope', 'item'] },
  { name: 'bags', keys: ['id'] },
  { name: 'boxes', keys: ['id'] },
  { name: 'inventory_items', keys: ['id'] },
  { name: 'inventory_lots', keys: ['id'] },
  { name: 'weapons', keys: ['id'] },
  { name: 'documents', keys: ['id'] },
  { name: 'photos', keys: ['id'] },
  { name: 'barcode_products', keys: ['code'] },
  { name: 'stock_movements', keys: ['id'] },
  { name: 'poi_locations', keys: ['id'] },
];

const BY_NAME = new Map(SHARED_TABLES.map(t => [t.name, t]));

export function sharedTable(name: string): SharedTable | undefined {
  return BY_NAME.get(name);
}

/** Réglages partagés : le foyer et ses hypothèses, pas ceux de l'appareil. */
export const SHARED_SETTINGS: readonly string[] = [
  'household_members',
  'household_children',
  'household_babies',
  'water_liters_per_person_day',
  'kcal_per_person_day',
  'target_days',
  'wh_per_person_day',
  'energy_devices',
  'purchase_plan',
];

const SEPARATOR = '\u001f';

/** Valeurs de la clé primaire, typées comme dans la table. */
export function keyValues(table: SharedTable, key: string): SqlValue[] {
  const parts = table.keys.length === 1 ? [key] : key.split(SEPARATOR);
  if (parts.length !== table.keys.length) {
    throw new Error(`Clé invalide pour ${table.name}`);
  }
  return table.name === 'family_plan' ? parts.map(Number) : parts;
}
