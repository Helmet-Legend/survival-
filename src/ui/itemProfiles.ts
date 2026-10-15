/**
 * Saisie propre à chaque catégorie : une fiche de munitions ne se remplit
 * pas comme une fiche d'eau. Unités proposées, contenant (bidon, boîte),
 * calories, calibre et libellés.
 */
import type { InventoryItem, ItemCategory, ItemUnit } from '../inventory';
import { formatNumber, UNIT_LABELS } from './format';

export interface Container {
  one: string;
  many: string;
}

export interface CategoryProfile {
  namePlaceholder: string;
  /** Unités proposées ; la première est celle par défaut. */
  units: readonly ItemUnit[];
  /** Contenant habituel (saisie « contenance × nombre »). */
  container: Container | null;
  /** Nom d'une pièce quand l'unité est `unit` (ex. cartouche). */
  piece: Container | null;
  calories: boolean;
  caliber: boolean;
}

export const PROFILES: Record<ItemCategory, CategoryProfile> = {
  water: {
    namePlaceholder: 'Ex. Bidons d’eau',
    units: ['L', 'mL'],
    container: { one: 'bidon', many: 'bidons' },
    piece: null,
    calories: false,
    caliber: false,
  },
  food: {
    namePlaceholder: 'Ex. Riz basmati',
    units: ['kg', 'g', 'unit'],
    container: null,
    piece: null,
    calories: true,
    caliber: false,
  },
  medical: {
    namePlaceholder: 'Ex. Compresses stériles',
    units: ['unit'],
    container: null,
    piece: null,
    calories: false,
    caliber: false,
  },
  energy: {
    namePlaceholder: 'Ex. Piles AA, gazole',
    units: ['unit', 'L'],
    container: null,
    piece: null,
    calories: false,
    caliber: false,
  },
  tool: {
    namePlaceholder: 'Ex. Lampe frontale',
    units: ['unit'],
    container: null,
    piece: null,
    calories: false,
    caliber: false,
  },
  weapon: {
    namePlaceholder: 'Ex. Cartouches plomb 7',
    units: ['unit'],
    container: { one: 'boîte', many: 'boîtes' },
    piece: { one: 'cartouche', many: 'cartouches' },
    calories: false,
    caliber: true,
  },
};

function plural(count: number, noun: Container): string {
  return count > 1 ? noun.many : noun.one;
}

/** Unité affichée : « cartouches » plutôt que « pièce(s) » pour les munitions. */
export function unitLabel(
  category: ItemCategory,
  unit: ItemUnit,
  count = 2,
): string {
  const piece = PROFILES[category].piece;
  return unit === 'unit' && piece !== null
    ? plural(count, piece)
    : UNIT_LABELS[unit];
}

/** « 3 bidons de 10 L », ou null sans contenance connue. */
export function packageSummary(
  item: Pick<InventoryItem, 'category' | 'unit' | 'packageSize'>,
  quantity: number,
): string | null {
  const container = PROFILES[item.category].container;
  if (item.packageSize === null || container === null) {
    return null;
  }
  const count = quantity / item.packageSize;
  return `${formatNumber(count)} ${plural(count, container)} de ${formatNumber(
    item.packageSize,
  )} ${unitLabel(item.category, item.unit, item.packageSize)}`;
}
