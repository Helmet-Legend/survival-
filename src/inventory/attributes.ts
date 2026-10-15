/**
 * Champs propres à chaque catégorie de stock (pack « fiches ») : stockés
 * en JSON dans `inventory_items.attributes` et `weapons.attributes`.
 *
 * Tout est facultatif : une donnée inconnue reste absente, jamais devinée.
 * Les valeurs énumérées sont des codes stables ; les libellés sont dans
 * l'interface.
 */
import { isIsoDate } from '../lib/dates';
import { InventoryError } from './inventoryRepository';

/** Unité de comptage affichée pour un article en pièces (`unit`). */
export const COUNT_UNITS = [
  'piece',
  'package',
  'box',
  'portion',
  'dose',
  'bottle',
  'lot',
  'kit',
] as const;
export type CountUnit = (typeof COUNT_UNITS)[number];

export const POTABILITY = [
  'potable',
  'to_treat',
  'not_potable',
  'unknown',
] as const;
export const TREATMENTS = [
  'none',
  'boiling',
  'filtration',
  'tablets',
  'other',
  'unknown',
] as const;
export const STORAGE = [
  'ambient',
  'fresh',
  'fridge',
  'frozen',
  'dry',
  'light_protected',
  'other',
] as const;
export const CONDITIONS = [
  'new',
  'good',
  'check',
  'maintain',
  'repair',
  'unavailable',
] as const;
export const ENERGY_BASES = ['per100g', 'perPortion'] as const;
export const WEIGHT_UNITS = ['kg', 'g'] as const;
export const CAPACITY_UNITS = [
  'Wh',
  'mAh',
  'h',
  'persons',
  'L',
  'other',
] as const;
export const RECORD_TYPES = ['ammo', 'accessory'] as const;

export interface ItemAttributes {
  countUnit?: CountUnit;
  // Eau
  potability?: (typeof POTABILITY)[number];
  treatment?: (typeof TREATMENTS)[number];
  treatedAt?: string;
  checkedAt?: string;
  // Nourriture
  unitWeight?: number;
  unitWeightUnit?: (typeof WEIGHT_UNITS)[number];
  energyValue?: number;
  energyBasis?: (typeof ENERGY_BASES)[number];
  storage?: (typeof STORAGE)[number];
  // Médical
  dosage?: string;
  lotNumber?: string;
  // Armement (articles : munitions ou accessoires)
  recordType?: (typeof RECORD_TYPES)[number];
  // Outils, matériel, armement
  brandModel?: string;
  condition?: (typeof CONDITIONS)[number];
  lastServiceAt?: string;
  nextServiceAt?: string;
  capacityValue?: number;
  capacityUnit?: (typeof CAPACITY_UNITS)[number];
  weightDims?: string;
}

/** Champs d'une arme (table `weapons`). */
export interface WeaponAttributes {
  brandModel?: string;
  condition?: (typeof CONDITIONS)[number];
  checkedAt?: string;
  /** Emplacement sécurisé : jamais affiché dans les listes. */
  location?: string;
}

function invalid(field: string, message: string): InventoryError {
  return new InventoryError('VALIDATION', message, { field });
}

type Rule =
  | { kind: 'enum'; values: readonly string[] }
  | { kind: 'date' }
  | { kind: 'number' }
  | { kind: 'text'; max: number };

const ITEM_RULES: Record<keyof ItemAttributes, Rule> = {
  countUnit: { kind: 'enum', values: COUNT_UNITS },
  potability: { kind: 'enum', values: POTABILITY },
  treatment: { kind: 'enum', values: TREATMENTS },
  treatedAt: { kind: 'date' },
  checkedAt: { kind: 'date' },
  unitWeight: { kind: 'number' },
  unitWeightUnit: { kind: 'enum', values: WEIGHT_UNITS },
  energyValue: { kind: 'number' },
  energyBasis: { kind: 'enum', values: ENERGY_BASES },
  storage: { kind: 'enum', values: STORAGE },
  dosage: { kind: 'text', max: 120 },
  lotNumber: { kind: 'text', max: 60 },
  recordType: { kind: 'enum', values: RECORD_TYPES },
  brandModel: { kind: 'text', max: 120 },
  condition: { kind: 'enum', values: CONDITIONS },
  lastServiceAt: { kind: 'date' },
  nextServiceAt: { kind: 'date' },
  capacityValue: { kind: 'number' },
  capacityUnit: { kind: 'enum', values: CAPACITY_UNITS },
  weightDims: { kind: 'text', max: 120 },
};

const WEAPON_RULES: Record<keyof WeaponAttributes, Rule> = {
  brandModel: { kind: 'text', max: 120 },
  condition: { kind: 'enum', values: CONDITIONS },
  checkedAt: { kind: 'date' },
  location: { kind: 'text', max: 120 },
};

function clean<T extends object>(
  input: Partial<Record<string, unknown>> | null | undefined,
  rules: Record<string, Rule>,
): T {
  const out: Record<string, unknown> = {};
  for (const [key, rule] of Object.entries(rules)) {
    const raw = input?.[key];
    if (raw === undefined || raw === null || raw === '') {
      continue;
    }
    switch (rule.kind) {
      case 'enum':
        if (typeof raw !== 'string' || !rule.values.includes(raw)) {
          throw invalid(key, 'Valeur inconnue');
        }
        out[key] = raw;
        break;
      case 'date':
        if (typeof raw !== 'string' || !isIsoDate(raw)) {
          throw invalid(key, 'Date invalide (JJ/MM/AAAA)');
        }
        out[key] = raw;
        break;
      case 'number':
        if (typeof raw !== 'number' || !Number.isFinite(raw) || raw <= 0) {
          throw invalid(key, 'Nombre positif attendu');
        }
        out[key] = Math.round(raw * 1e6) / 1e6;
        break;
      case 'text': {
        const text = typeof raw === 'string' ? raw.trim() : '';
        if (text.length > rule.max) {
          throw invalid(key, `${rule.max} caractères au maximum`);
        }
        if (text !== '') {
          out[key] = text;
        }
        break;
      }
    }
  }
  return out as T;
}

export function validateItemAttributes(
  input: ItemAttributes | null | undefined,
): ItemAttributes {
  const attrs = clean<ItemAttributes>(
    input as Record<string, unknown>,
    ITEM_RULES,
  );
  // Une valeur sans son unité (ou l'inverse) ne peut pas servir au calcul.
  if ((attrs.energyValue === undefined) !== (attrs.energyBasis === undefined)) {
    throw invalid(
      'energyValue',
      'Indiquez la valeur et sa référence (100 g ou portion)',
    );
  }
  if (
    (attrs.unitWeight === undefined) !==
    (attrs.unitWeightUnit === undefined)
  ) {
    throw invalid('unitWeight', 'Indiquez le poids et son unité');
  }
  if (
    (attrs.capacityValue === undefined) !==
    (attrs.capacityUnit === undefined)
  ) {
    throw invalid('capacityValue', 'Indiquez la capacité et son unité');
  }
  return attrs;
}

export function validateWeaponAttributes(
  input: WeaponAttributes | null | undefined,
): WeaponAttributes {
  return clean<WeaponAttributes>(
    input as Record<string, unknown>,
    WEAPON_RULES,
  );
}

/** JSON pour la base, ou NULL si vide. */
export function serializeAttributes(attrs: object): string | null {
  return Object.keys(attrs).length === 0 ? null : JSON.stringify(attrs);
}

/** Lecture tolérante : une valeur illisible donne un objet vide. */
export function parseAttributes<T extends object>(raw: unknown): T {
  if (typeof raw !== 'string' || raw === '') {
    return {} as T;
  }
  try {
    const value: unknown = JSON.parse(raw);
    return (typeof value === 'object' && value !== null ? value : {}) as T;
  } catch {
    return {} as T;
  }
}
