/**
 * Réserves « en plus » de l'autonomie garantie, affichées à part :
 *
 * - eau traitable : l'eau à traiter du stock (cuve, pluie) que les filtres
 *   et pastilles du matériel peuvent rendre potable, limitée par l'une ou
 *   l'autre ;
 * - chauffage et cuisson : jours couverts par les combustibles (bois,
 *   charbon, gaz, carburant), d'après une consommation par jour propre à
 *   chaque fiche, ou une valeur prudente par défaut. La cuisson se compte
 *   par personne, le chauffage pour le logement.
 *
 * Le chiffre d'autonomie du foyer n'en dépend jamais : un filtre peut se
 * boucher, un poêle tomber en panne.
 */
import type { ItemSummary } from '../inventory';

export type FuelUse = 'heating' | 'cooking' | 'lighting';

/** Sous-type du matériel « Traitement de l'eau » (filtres, pastilles). */
export const WATER_TREATMENT_SUBTYPE = 'water_treatment';

const FUEL_SUBTYPES = new Set(['wood', 'gas', 'fuel']);

function inGeneralStock(item: ItemSummary): boolean {
  return item.usableQuantity > 0 && item.bagId === null;
}

// --- Eau traitable -------------------------------------------------------

export interface WaterTreatmentReport {
  /** Litres que le matériel peut encore traiter. */
  capacityLiters: number;
  /** Litres d'eau à traiter en stock. */
  rawLiters: number;
  /** Litres réellement rendus potables : le plus petit des deux. */
  treatableLiters: number;
  /** Jours entiers en plus, au besoin quotidien du foyer. */
  extraDays: number;
  /** Ce qui limite : le matériel ou l'eau à traiter. */
  limitedBy: 'capacity' | 'water';
  /** Filtres ou pastilles sans capacité en litres : non comptés. */
  unknown: string[];
  /** Au moins un moyen de traitement en stock. */
  hasTreatment: boolean;
}

export function isWaterTreatment(item: ItemSummary): boolean {
  return item.category === 'energy' && item.subtype === WATER_TREATMENT_SUBTYPE;
}

export function computeWaterTreatment(
  items: readonly ItemSummary[],
  rawLiters: number,
  dailyNeedLiters: number,
): WaterTreatmentReport {
  let capacityLiters = 0;
  let hasTreatment = false;
  const unknown: string[] = [];
  for (const item of items) {
    if (!inGeneralStock(item) || !isWaterTreatment(item)) {
      continue;
    }
    if (item.attributes.condition === 'unavailable') {
      continue;
    }
    hasTreatment = true;
    const value = item.attributes.capacityValue;
    if (
      item.attributes.capacityUnit === 'L' &&
      value !== undefined &&
      value > 0
    ) {
      capacityLiters += value * item.usableQuantity;
    } else {
      unknown.push(item.name);
    }
  }
  const raw = Math.max(0, rawLiters);
  const treatableLiters = Math.min(raw, capacityLiters);
  return {
    capacityLiters,
    rawLiters: raw,
    treatableLiters,
    extraDays:
      dailyNeedLiters > 0 ? Math.floor(treatableLiters / dailyNeedLiters) : 0,
    limitedBy: capacityLiters < raw ? 'capacity' : 'water',
    unknown,
    hasTreatment,
  };
}

// --- Chauffage et cuisson -----------------------------------------------

export type FuelBase = 'kg' | 'L';

/** Quantité de combustible d'une fiche, en kg ou en litres, ou null. */
export function fuelAmount(
  item: ItemSummary,
): { amount: number; base: FuelBase } | null {
  const q = item.usableQuantity;
  switch (item.unit) {
    case 'kg':
      return { amount: q, base: 'kg' };
    case 'g':
      return { amount: q / 1000, base: 'kg' };
    case 'L':
      return { amount: q, base: 'L' };
    case 'mL':
      return { amount: q / 1000, base: 'L' };
    case 'unit': {
      const value = item.attributes.capacityValue;
      const unit = item.attributes.capacityUnit;
      if (value === undefined || !(value > 0)) {
        return null;
      }
      if (unit === 'kg') {
        return { amount: q * value, base: 'kg' };
      }
      if (unit === 'L') {
        return { amount: q * value, base: 'L' };
      }
      return null;
    }
  }
  return null;
}

function isCharcoal(item: ItemSummary): boolean {
  return /charbon/i.test(item.name);
}

/** Usage par défaut : le charbon et le gaz cuisent, le bois chauffe. */
export function defaultFuelUse(item: ItemSummary): FuelUse {
  if (item.subtype === 'gas') {
    return 'cooking';
  }
  if (item.subtype === 'wood') {
    return isCharcoal(item) ? 'cooking' : 'heating';
  }
  return 'heating';
}

export function fuelUse(item: ItemSummary): FuelUse {
  return item.attributes.fuelUse ?? defaultFuelUse(item);
}

/**
 * Consommation proposée, dans l'unité du combustible : pour le logement
 * (chauffage) ou par personne (cuisson). Valeurs prudentes, à ajuster.
 */
export function defaultDailyUse(
  subtype: string | null,
  use: FuelUse,
  charcoal = false,
): number {
  if (use === 'heating') {
    // Poêle à bois en hiver ; poêle à pétrole ; chauffage d'appoint au gaz.
    return subtype === 'wood' ? 12 : subtype === 'fuel' ? 2 : 1;
  }
  if (use === 'cooking') {
    if (subtype === 'gas') {
      return 0.1;
    }
    if (subtype === 'wood') {
      return charcoal ? 0.2 : 0.5;
    }
    return 0.1;
  }
  return 0;
}

export function dailyUseOf(item: ItemSummary): number {
  const set = item.attributes.dailyUse;
  if (set !== undefined && set > 0) {
    return set;
  }
  return defaultDailyUse(item.subtype, fuelUse(item), isCharcoal(item));
}

export interface FuelLine {
  name: string;
  use: FuelUse;
  amount: number;
  base: FuelBase;
  /** Consommation du foyer par jour (cuisson déjà multipliée). */
  perDay: number;
  /** Consommation saisie (ou proposée) : par logement ou par personne. */
  dailyUse: number;
  /** Valeur proposée, la fiche n'en précisant pas. */
  defaulted: boolean;
  days: number;
}

export interface FuelReport {
  heatingDays: number | null;
  cookingDays: number | null;
  lines: FuelLine[];
  /** Combustibles dont la quantité n'est pas convertible (unité, capacité). */
  unknown: string[];
}

export function computeFuels(
  items: readonly ItemSummary[],
  members: number,
): FuelReport {
  const lines: FuelLine[] = [];
  const unknown: string[] = [];
  for (const item of items) {
    if (
      !inGeneralStock(item) ||
      item.category !== 'power' ||
      item.subtype === null ||
      !FUEL_SUBTYPES.has(item.subtype)
    ) {
      continue;
    }
    const use = fuelUse(item);
    if (use === 'lighting') {
      continue;
    }
    const amount = fuelAmount(item);
    if (amount === null) {
      unknown.push(item.name);
      continue;
    }
    const dailyUse = dailyUseOf(item);
    const perDay =
      use === 'cooking' ? dailyUse * Math.max(1, members) : dailyUse;
    lines.push({
      name: item.name,
      use,
      amount: amount.amount,
      base: amount.base,
      perDay,
      dailyUse,
      defaulted: !(
        item.attributes.dailyUse !== undefined && item.attributes.dailyUse > 0
      ),
      days: perDay > 0 ? amount.amount / perDay : 0,
    });
  }
  const total = (use: FuelUse) => {
    const own = lines.filter(l => l.use === use);
    return own.length === 0
      ? null
      : Math.floor(own.reduce((sum, l) => sum + l.days, 0));
  };
  return {
    heatingDays: total('heating'),
    cookingDays: total('cooking'),
    lines,
    unknown,
  };
}
