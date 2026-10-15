/** Valeurs autorisées par les contraintes CHECK du schéma (src/db/schema.ts). */
export const ITEM_CATEGORIES = [
  'water',
  'food',
  'medical',
  'energy',
  'tool',
  'weapon',
] as const;
export type ItemCategory = (typeof ITEM_CATEGORIES)[number];

export const ITEM_UNITS = ['L', 'mL', 'kg', 'g', 'unit'] as const;
export type ItemUnit = (typeof ITEM_UNITS)[number];
