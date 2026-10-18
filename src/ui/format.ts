/** Formats d'affichage partagés par les écrans. */

import type { WeaponKind } from '../inventory/armoryRepository';
import type { ItemCategory, ItemUnit } from '../inventory/types';
import type { ExpiryBucket } from '../resilience/resilienceCalculator';
import {
  AmmoIcon,
  EnergyIcon,
  EquipmentIcon,
  FoodIcon,
  MedicalIcon,
  ToolIcon,
  WaterIcon,
  type Icon,
} from './icons';
import { colors, type StatusTone } from './theme';

/**
 * Libellés courts (puces, listes). La catégorie technique `energy` est
 * présentée comme « Matériel & équipements » (éclairage, abri…) : les
 * données existantes restent valides. L'énergie (piles, carburant, gaz…)
 * a sa propre catégorie, `power`.
 */
export const CATEGORY_LABELS: Record<ItemCategory, string> = {
  water: 'Eau',
  food: 'Nourriture',
  medical: 'Médical',
  energy: 'Matériel',
  tool: 'Outils',
  weapon: 'Armement',
  power: 'Énergie',
};

/** Libellés complets (titres de fiches et de catégories). */
export const CATEGORY_TITLES: Record<ItemCategory, string> = {
  water: 'Eau',
  food: 'Nourriture',
  medical: 'Médical',
  energy: 'Matériel & équipements',
  tool: 'Outils',
  weapon: 'Armement & munitions',
  power: 'Énergie',
};

/** Ordre d'affichage des catégories (celui du pack de fiches). */
export const STOCK_ORDER: readonly ItemCategory[] = [
  'water',
  'food',
  'weapon',
  'medical',
  'tool',
  'energy',
  'power',
];

export const CATEGORY_ICONS: Record<ItemCategory, Icon> = {
  water: WaterIcon,
  food: FoodIcon,
  medical: MedicalIcon,
  energy: EquipmentIcon,
  tool: ToolIcon,
  weapon: AmmoIcon,
  power: EnergyIcon,
};

export const CATEGORY_COLORS: Record<ItemCategory, string> = {
  water: colors.water,
  food: colors.food,
  medical: colors.health,
  energy: colors.equipment,
  tool: colors.tools,
  weapon: colors.weapons,
  power: colors.energy,
};

export const WEAPON_KIND_LABELS: Record<WeaponKind, string> = {
  rifle: 'Arme d’épaule (carabine)',
  shotgun: 'Fusil (canon lisse)',
  handgun: 'Arme de poing',
  other: 'Autre',
};

export const UNIT_LABELS: Record<ItemUnit, string> = {
  L: 'L',
  mL: 'mL',
  kg: 'kg',
  g: 'g',
  unit: 'pièce(s)',
};

export const BUCKET_LABELS: Record<ExpiryBucket, string> = {
  expired: 'Périmé',
  within30: '≤ 30 j',
  within60: '≤ 60 j',
  within90: '≤ 90 j',
  watch: 'Seuil perso',
};

/** Date affichée au format JJ/MM/AAAA. */
export function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

/** Nombre avec virgule décimale et espaces fines entre milliers. */
export function formatNumber(value: number, decimals = 1): string {
  const factor = 10 ** decimals;
  const rounded = Math.round(value * factor) / factor;
  const [intPart, decPart] = Math.abs(rounded).toString().split('.');
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${rounded < 0 ? '−' : ''}${grouped}${decPart ? `,${decPart}` : ''}`;
}

/** Montant en euros : « 12,5 € ». */
export function formatEuros(value: number): string {
  return `${formatNumber(value, 2)} €`;
}

export function formatRelativeDays(days: number): string {
  if (days < 0) {
    return `périmé depuis ${-days} j`;
  }
  if (days === 0) {
    return 'dernier jour';
  }
  return `dans ${days} j`;
}

/** Lit « 1,5 » comme « 1.5 » ; NaN si la saisie n'est pas un nombre. */
export function parseDecimal(text: string): number {
  const cleaned = text.trim().replace(/\s/g, '').replace(',', '.');
  return cleaned === '' ? NaN : Number(cleaned);
}

export const BUCKET_TONES: Record<ExpiryBucket, StatusTone> = {
  expired: 'danger',
  within30: 'danger',
  within60: 'warn',
  within90: 'neutral',
  watch: 'neutral',
};

/** Seuil en jours sous lequel l'autonomie est critique. */
export const CRITICAL_DAYS = 3;

export function autonomyStatus(
  days: number,
  targetDays: number,
): { tone: StatusTone; label: string } {
  if (days < CRITICAL_DAYS) {
    return { tone: 'danger', label: 'Critique' };
  }
  if (days < targetDays) {
    return { tone: 'warn', label: 'Sous l’objectif' };
  }
  return { tone: 'ok', label: 'Objectif atteint' };
}

/** Paliers proposés pour l'objectif d'autonomie. */
export const TARGET_STEPS = [3, 7, 14, 30, 60, 90, 180, 365] as const;

export function nextTarget(current: number, direction: 1 | -1): number {
  if (direction === 1) {
    return TARGET_STEPS.find(step => step > current) ?? current;
  }
  return [...TARGET_STEPS].reverse().find(step => step < current) ?? current;
}
