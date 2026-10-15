/**
 * Moteur de calcul de résilience (cahier des charges §3 module 1 et §4.4).
 *
 * - Autonomie en eau   = litres utilisables / (membres × L par personne et par jour)
 * - Autonomie en vivres = kcal utilisables / (membres × kcal par personne et par jour)
 * - Autonomie globale  = minimum des deux.
 *
 * Deux valeurs sont fournies pour chaque ressource :
 * - `naiveDays` : la formule du cahier des charges, stock non périmé ÷ besoin ;
 * - `days` : simulation jour par jour qui consomme les lots dans l'ordre de
 *   péremption (FEFO) et perd ceux qui périment avant d'être atteints. C'est
 *   la valeur à afficher : un stock de 60 jours qui périme dans 10 jours ne
 *   donne que 10 jours d'autonomie.
 *
 * Les dates manipulées sont des dates calendaires locales `AAAA-MM-JJ` :
 * l'appelant fournit « aujourd'hui » (horloge injectable, tests stables).
 * Une date de péremption est le dernier jour de consommation possible.
 */
import type { SqlDatabase, SqlValue } from '../db/types';
import type { ItemCategory, ItemUnit } from '../inventory/types';
import { addDays, assertIsoDate, daysBetween, localToday } from '../lib/dates';

// --- Types ------------------------------------------------------------------

export type { ItemCategory, ItemUnit };

export interface HouseholdSettings {
  members: number;
  waterLitersPerPersonDay: number;
  kcalPerPersonDay: number;
}

export interface StockLot {
  lotId: string;
  itemId: string;
  itemName: string;
  category: ItemCategory;
  unit: ItemUnit;
  quantity: number;
  /** kcal par unité (`unit`) : par kg, par g, par pièce… */
  caloriesPerUnit: number | null;
  /** `AAAA-MM-JJ` ou null si non périssable. */
  expirationDate: string | null;
}

export interface ResourceAutonomy {
  /** Quantité utilisable aujourd'hui (L ou kcal), lots périmés exclus. */
  available: number;
  /** Besoin quotidien du foyer (L ou kcal). */
  dailyNeed: number;
  /** Formule simple du cahier des charges, en jours (décimaux). */
  naiveDays: number;
  /** Jours entiers garantis en tenant compte des péremptions. */
  days: number;
  /** Quantité qui sera perdue faute d'être consommée à temps. */
  wasted: number;
  /** Date (AAAA-MM-JJ) du premier jour sans stock, si le stock s'épuise. */
  depletionDate: string;
}

export interface ResilienceReport {
  asOf: string;
  household: HouseholdSettings;
  water: ResourceAutonomy;
  food: ResourceAutonomy;
  /** Jours entiers d'autonomie globale (minimum eau / vivres). */
  days: number;
  /** Ressource qui limite l'autonomie. */
  limitingFactor: 'water' | 'food';
}

export type ExpiryBucket = 'expired' | 'within30' | 'within60' | 'within90';

export interface ExpiryAlert {
  lotId: string;
  itemId: string;
  itemName: string;
  category: ItemCategory;
  quantity: number;
  unit: ItemUnit;
  isCritical: boolean;
  expirationDate: string;
  /** Jours restants (négatif si déjà périmé, 0 = dernier jour). */
  daysLeft: number;
  bucket: ExpiryBucket;
}

export class ResilienceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ResilienceError';
  }
}

// --- Dates calendaires ------------------------------------------------------

export { addDays, daysBetween, localToday } from '../lib/dates';

// --- Calcul pur -------------------------------------------------------------

export function assertHousehold(household: HouseholdSettings): void {
  const { members, waterLitersPerPersonDay, kcalPerPersonDay } = household;
  if (!Number.isInteger(members) || members < 1) {
    throw new ResilienceError('Le foyer doit compter au moins une personne');
  }
  if (!(waterLitersPerPersonDay > 0) || !(kcalPerPersonDay > 0)) {
    throw new ResilienceError('Les besoins quotidiens doivent être positifs');
  }
}

/** Litres d'eau d'un lot, ou 0 si ce n'est pas de l'eau. */
export function lotWaterLiters(lot: StockLot): number {
  if (lot.category !== 'water') {
    return 0;
  }
  if (lot.unit === 'L') {
    return lot.quantity;
  }
  if (lot.unit === 'mL') {
    return lot.quantity / 1000;
  }
  return 0;
}

/** Calories d'un lot de vivres, ou 0 (non alimentaire ou kcal inconnues). */
export function lotCalories(lot: StockLot): number {
  if (lot.category !== 'food' || lot.caloriesPerUnit === null) {
    return 0;
  }
  return lot.quantity * lot.caloriesPerUnit;
}

interface Portion {
  amount: number;
  /** Jour relatif (0 = aujourd'hui) après lequel la portion est perdue ; Infinity si non périssable. */
  usableUntil: number;
}

/**
 * Simule la consommation continue à débit constant, lots consommés par date
 * de péremption croissante (FEFO). Une portion est utilisable jusqu'à la fin
 * de son jour de péremption.
 */
function simulate(
  portions: Portion[],
  dailyNeed: number,
): { days: number; wasted: number } {
  const ordered = [...portions].sort((a, b) => a.usableUntil - b.usableUntil);
  let elapsed = 0; // jours (décimaux) de consommation couverts
  let wasted = 0;
  for (const { amount, usableUntil } of ordered) {
    if (elapsed >= usableUntil) {
      wasted += amount;
      continue;
    }
    const covered = amount / dailyNeed;
    const end = elapsed + covered;
    if (end > usableUntil) {
      wasted += (end - usableUntil) * dailyNeed;
      elapsed = usableUntil;
    } else {
      elapsed = end;
    }
  }
  // Marge flottante : 3 × 1/3 de jour doit donner 1 jour, pas 0,99999.
  return { days: Math.floor(elapsed + 1e-9), wasted };
}

function computeResource(
  lots: readonly StockLot[],
  amountOf: (lot: StockLot) => number,
  dailyNeed: number,
  asOf: string,
): ResourceAutonomy {
  const portions: Portion[] = [];
  let available = 0;
  let expiredAmount = 0;
  for (const lot of lots) {
    const amount = amountOf(lot);
    if (!(amount > 0)) {
      continue;
    }
    // Dernier jour utilisable inclus → utilisable jusqu'à daysLeft + 1.
    const usableUntil =
      lot.expirationDate === null
        ? Infinity
        : daysBetween(asOf, lot.expirationDate) + 1;
    if (usableUntil <= 0) {
      expiredAmount += amount;
      continue;
    }
    available += amount;
    portions.push({ amount, usableUntil });
  }
  const { days, wasted } = simulate(portions, dailyNeed);
  return {
    available,
    dailyNeed,
    naiveDays: available / dailyNeed,
    days,
    wasted: wasted + expiredAmount,
    depletionDate: addDays(asOf, days),
  };
}

export function computeResilience(
  lots: readonly StockLot[],
  household: HouseholdSettings,
  asOf: string,
): ResilienceReport {
  assertHousehold(household);
  assertIsoDate(asOf);
  const water = computeResource(
    lots,
    lotWaterLiters,
    household.members * household.waterLitersPerPersonDay,
    asOf,
  );
  const food = computeResource(
    lots,
    lotCalories,
    household.members * household.kcalPerPersonDay,
    asOf,
  );
  const limitingFactor = water.days <= food.days ? 'water' : 'food';
  return {
    asOf,
    household,
    water,
    food,
    days: Math.min(water.days, food.days),
    limitingFactor,
  };
}

export function expiryBucket(daysLeft: number): ExpiryBucket | null {
  if (daysLeft < 0) {
    return 'expired';
  }
  if (daysLeft <= 30) {
    return 'within30';
  }
  if (daysLeft <= 60) {
    return 'within60';
  }
  if (daysLeft <= 90) {
    return 'within90';
  }
  return null;
}

// --- Accès à la base --------------------------------------------------------

const SETTING_KEYS = {
  members: 'household_members',
  waterLitersPerPersonDay: 'water_liters_per_person_day',
  kcalPerPersonDay: 'kcal_per_person_day',
} as const;

export async function loadHousehold(
  db: SqlDatabase,
): Promise<HouseholdSettings> {
  const { rows } = await db.execute(
    'SELECT key, value FROM settings WHERE key IN (?, ?, ?)',
    Object.values(SETTING_KEYS),
  );
  const values = new Map(rows.map(r => [String(r.key), Number(r.value)]));
  const household: HouseholdSettings = {
    members: values.get(SETTING_KEYS.members) ?? NaN,
    waterLitersPerPersonDay:
      values.get(SETTING_KEYS.waterLitersPerPersonDay) ?? NaN,
    kcalPerPersonDay: values.get(SETTING_KEYS.kcalPerPersonDay) ?? NaN,
  };
  assertHousehold(household);
  return household;
}

export async function saveHousehold(
  db: SqlDatabase,
  household: HouseholdSettings,
): Promise<void> {
  assertHousehold(household);
  await db.execute(
    `INSERT INTO settings (key, value) VALUES (?, ?), (?, ?), (?, ?)
     ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
    [
      SETTING_KEYS.members,
      String(household.members),
      SETTING_KEYS.waterLitersPerPersonDay,
      String(household.waterLitersPerPersonDay),
      SETTING_KEYS.kcalPerPersonDay,
      String(household.kcalPerPersonDay),
    ],
  );
}

/** Lots non vides d'eau et de vivres, seuls utiles au calcul d'autonomie. */
export async function loadConsumableLots(db: SqlDatabase): Promise<StockLot[]> {
  const { rows } = await db.execute(
    `SELECT l.id AS lot_id, i.id AS item_id, i.name, i.category, i.unit,
            l.quantity, i.calories_per_unit, l.expiration_date
       FROM inventory_lots AS l
       JOIN inventory_items AS i ON i.id = l.item_id
      WHERE l.quantity > 0 AND i.category IN ('water', 'food')`,
  );
  return rows.map(r => ({
    lotId: String(r.lot_id),
    itemId: String(r.item_id),
    itemName: String(r.name),
    category: r.category as ItemCategory,
    unit: r.unit as ItemUnit,
    quantity: Number(r.quantity),
    caloriesPerUnit:
      r.calories_per_unit === null ? null : Number(r.calories_per_unit),
    expirationDate:
      r.expiration_date === null ? null : String(r.expiration_date),
  }));
}

export async function getResilienceReport(
  db: SqlDatabase,
  asOf: string = localToday(),
): Promise<ResilienceReport> {
  const [household, lots] = await Promise.all([
    loadHousehold(db),
    loadConsumableLots(db),
  ]);
  return computeResilience(lots, household, asOf);
}

/**
 * Requête des alertes. Sa clause WHERE reprend celle de l'index partiel
 * `idx_inventory_lots_expiration` pour que SQLite l'utilise (vérifié par un
 * test sur le plan d'exécution).
 */
export const EXPIRY_ALERTS_SQL = `
  SELECT l.id AS lot_id, i.id AS item_id, i.name, i.category, i.unit,
         i.is_critical, l.quantity, l.expiration_date
    FROM inventory_lots AS l
    JOIN inventory_items AS i ON i.id = l.item_id
   WHERE l.expiration_date IS NOT NULL AND l.quantity > 0
     AND l.expiration_date <= ?
   ORDER BY l.expiration_date, i.is_critical DESC, i.name`;

/** Lots périmés ou périmant sous 30, 60 et 90 jours, du plus urgent au moins urgent. */
export async function getExpiryAlerts(
  db: SqlDatabase,
  asOf: string = localToday(),
): Promise<ExpiryAlert[]> {
  const params: SqlValue[] = [addDays(asOf, 90)];
  const { rows } = await db.execute(EXPIRY_ALERTS_SQL, params);
  const alerts: ExpiryAlert[] = [];
  for (const r of rows) {
    const expirationDate = String(r.expiration_date);
    const daysLeft = daysBetween(asOf, expirationDate);
    const bucket = expiryBucket(daysLeft);
    if (bucket === null) {
      continue;
    }
    alerts.push({
      lotId: String(r.lot_id),
      itemId: String(r.item_id),
      itemName: String(r.name),
      category: r.category as ItemCategory,
      quantity: Number(r.quantity),
      unit: r.unit as ItemUnit,
      isCritical: Number(r.is_critical) === 1,
      expirationDate,
      daysLeft,
      bucket,
    });
  }
  return alerts;
}
