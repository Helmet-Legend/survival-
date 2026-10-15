/** Formats d'affichage partagés par les écrans. */
import type { ItemCategory, ItemUnit } from '../inventory/types';
import type { ExpiryBucket } from '../resilience/resilienceCalculator';

export const CATEGORY_LABELS: Record<ItemCategory, string> = {
  water: 'Eau',
  food: 'Vivres',
  medical: 'Santé',
  energy: 'Énergie',
  tool: 'Outils',
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
};

const MONTHS = [
  'janv.',
  'févr.',
  'mars',
  'avr.',
  'mai',
  'juin',
  'juil.',
  'août',
  'sept.',
  'oct.',
  'nov.',
  'déc.',
];

/** « 21 oct. 2026 », sans dépendre de l'Intl de l'appareil. */
export function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

/** Nombre avec virgule décimale et espaces fines entre milliers. */
export function formatNumber(value: number, decimals = 1): string {
  const factor = 10 ** decimals;
  const rounded = Math.round(value * factor) / factor;
  const [intPart, decPart] = Math.abs(rounded).toString().split('.');
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${rounded < 0 ? '−' : ''}${grouped}${decPart ? `,${decPart}` : ''}`;
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
