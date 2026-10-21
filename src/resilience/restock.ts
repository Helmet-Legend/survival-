/**
 * Liste de réapprovisionnement : ce qu'il faut acheter pour tenir l'objectif
 * d'autonomie du foyer (ex. 14 jours), et pour remonter chaque article sous
 * son stock minimal.
 *
 * Le manque en eau et en vivres tient compte des péremptions : 20 L qui
 * périment dans 5 jours ne couvrent que 5 jours d'un objectif de 14.
 */
import type { SqlDatabase } from '../db/types';
import type { ItemUnit } from '../inventory/types';
import { localToday } from '../lib/dates';
import {
  coveredDaysWithin,
  dailyKcalNeed,
  dailyWaterNeed,
  loadConsumableLots,
  loadHousehold,
  loadTargetDays,
  lotCalories,
  lotWaterLiters,
  type HouseholdSettings,
  type StockLot,
} from './resilienceCalculator';

export interface TargetCoverage {
  /** Besoin total sur l'objectif (L ou kcal). */
  needed: number;
  /** Part du besoin couverte par le stock actuel. */
  covered: number;
  /** Quantité à acheter (L ou kcal), 0 si l'objectif est atteint. */
  missing: number;
  /** Jours entiers couverts, plafonnés à l'objectif. */
  coveredDays: number;
}

export interface ItemShortfall {
  itemId: string;
  name: string;
  unit: ItemUnit;
  isCritical: boolean;
  /** Stock minimal souhaité. */
  minStock: number;
  /** Stock utilisable (lots non périmés). */
  usable: number;
  /** Quantité à acheter. */
  missing: number;
}

export interface RestockPlan {
  asOf: string;
  targetDays: number;
  household: HouseholdSettings;
  water: TargetCoverage;
  food: TargetCoverage;
  /** Articles sous leur stock minimal, critiques d'abord. */
  items: ItemShortfall[];
  /** Vrai si rien n'est à acheter. */
  complete: boolean;
}

/** Les manques inférieurs à cette fraction d'une journée sont ignorés. */
const NEGLIGIBLE_DAY_FRACTION = 0.01;

function coverage(
  lots: readonly StockLot[],
  amountOf: (lot: StockLot) => number,
  dailyNeed: number,
  targetDays: number,
  asOf: string,
): TargetCoverage {
  const days = coveredDaysWithin(lots, amountOf, dailyNeed, asOf, targetDays);
  const missingDays =
    targetDays - days < NEGLIGIBLE_DAY_FRACTION ? 0 : targetDays - days;
  return {
    needed: targetDays * dailyNeed,
    covered: (targetDays - missingDays) * dailyNeed,
    missing: missingDays * dailyNeed,
    coveredDays: Math.floor(days + 1e-9),
  };
}

/** Calcul pur, sans base de données. */
export function computeRestockPlan(input: {
  lots: readonly StockLot[];
  household: HouseholdSettings;
  targetDays: number;
  items: readonly Omit<ItemShortfall, 'missing'>[];
  asOf: string;
}): RestockPlan {
  const { lots, household, targetDays, asOf } = input;
  const water = coverage(
    lots,
    lotWaterLiters,
    dailyWaterNeed(household),
    targetDays,
    asOf,
  );
  const food = coverage(
    lots,
    lotCalories,
    dailyKcalNeed(household),
    targetDays,
    asOf,
  );
  const items = input.items
    .map(item => ({
      ...item,
      missing: Math.round((item.minStock - item.usable) * 1e6) / 1e6,
    }))
    .filter(item => item.missing > 0)
    .sort(
      (a, b) =>
        Number(b.isCritical) - Number(a.isCritical) ||
        a.name.localeCompare(b.name, 'fr'),
    );
  return {
    asOf,
    targetDays,
    household,
    water,
    food,
    items,
    complete: water.missing === 0 && food.missing === 0 && items.length === 0,
  };
}

/** Articles ayant un stock minimal, avec leur stock utilisable. */
export async function loadMinStockItems(
  db: SqlDatabase,
  asOf: string,
): Promise<Omit<ItemShortfall, 'missing'>[]> {
  const { rows } = await db.execute(
    `SELECT i.id, i.name, i.unit, i.is_critical, i.min_stock,
            COALESCE(SUM(CASE WHEN l.expiration_date IS NULL
                                OR l.expiration_date >= ?
                              THEN l.quantity END), 0) AS usable
       FROM inventory_items AS i
       LEFT JOIN inventory_lots AS l ON l.item_id = i.id
      WHERE i.min_stock IS NOT NULL AND i.min_stock > 0
      GROUP BY i.id`,
    [asOf],
  );
  return rows.map(r => ({
    itemId: String(r.id),
    name: String(r.name),
    unit: r.unit as ItemUnit,
    isCritical: Number(r.is_critical) === 1,
    minStock: Number(r.min_stock),
    usable: Number(r.usable),
  }));
}

export async function getRestockPlan(
  db: SqlDatabase,
  asOf: string = localToday(),
): Promise<RestockPlan> {
  const [lots, household, targetDays, items] = await Promise.all([
    loadConsumableLots(db),
    loadHousehold(db),
    loadTargetDays(db),
    loadMinStockItems(db, asOf),
  ]);
  return computeRestockPlan({ lots, household, targetDays, items, asOf });
}
