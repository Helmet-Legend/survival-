/**
 * Plan d'achats échelonné : ce qui manque pour compléter la préparation,
 * réparti sur plusieurs mois, l'essentiel d'abord. Les manques viennent du
 * stock réel : eau et vivres jusqu'à 3 jours puis jusqu'à l'objectif
 * d'autonomie, équipement du kit 72 h, articles sous leur stock minimal,
 * sac d'évacuation. Aucun prix n'est inventé : le plan dit quoi acheter et
 * quand, pas combien cela coûte.
 *
 * Le plan est enregistré dans le coffre ; chaque achat se coche. Un rappel
 * neutre peut être programmé le 1er de chaque mois (voir reminders.ts).
 */
import type { SqlDatabase } from '../db/types';
import type { BagSummary, ItemCategory, ItemSummary } from '../inventory';
import { computeRestockPlan, loadMinStockItems } from '../resilience/restock';
import {
  loadConsumableLots,
  loadHousehold,
  loadTargetDays,
} from '../resilience/resilienceCalculator';
import { getPreparation, OFFICIAL_TIER } from './preparation';

export const PLAN_MONTHS = [2, 3, 6, 12] as const;
export const PLAN_MONTHS_DEFAULT = 3;
const PLAN_KEY = 'purchase_plan';

export interface PurchaseEntry {
  id: string;
  /** Mois du plan, de 0 (le mois de création) à `months - 1`. */
  month: number;
  label: string;
  /** Quantité ou précision (« 12 L », « pour 2 jours »). */
  detail: string | null;
  /** Fiche d'ajout à ouvrir une fois l'achat fait. */
  category: ItemCategory | null;
  prefill?: Record<string, string>;
  /** Essentiel : à acheter en premier. */
  vital: boolean;
  done: boolean;
}

export interface PurchasePlan {
  /** Mois de départ, `AAAA-MM`. */
  start: string;
  months: number;
  targetDays: number;
  entries: PurchaseEntry[];
}

/** Besoin à placer dans le plan, avant répartition. */
export interface Need {
  id: string;
  label: string;
  detail: string | null;
  category: ItemCategory | null;
  prefill?: Record<string, string>;
  vital: boolean;
  /** Quantité fractionnable sur plusieurs mois (eau, vivres), sinon absent. */
  split?: { amount: number; format: (amount: number) => string };
}

// --- Mois -------------------------------------------------------------------------

const MONTH_NAMES = [
  'janvier',
  'février',
  'mars',
  'avril',
  'mai',
  'juin',
  'juillet',
  'août',
  'septembre',
  'octobre',
  'novembre',
  'décembre',
];

export function monthOf(iso: string): string {
  return iso.slice(0, 7);
}

/** `AAAA-MM` décalé de `n` mois. */
export function addMonths(month: string, n: number): string {
  const [y, m] = month.split('-').map(Number);
  const index = y * 12 + (m - 1) + n;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(
    2,
    '0',
  )}`;
}

export function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return `${MONTH_NAMES[m - 1]} ${y}`;
}

/** Index du mois du plan correspondant à `today`, borné au plan. */
export function currentMonthIndex(plan: PurchasePlan, today: string): number {
  const [sy, sm] = plan.start.split('-').map(Number);
  const [y, m] = monthOf(today).split('-').map(Number);
  return Math.max(0, Math.min(plan.months - 1, (y - sy) * 12 + (m - sm)));
}

// --- Répartition ------------------------------------------------------------------

const fmt = (n: number, decimals = 0) => {
  const factor = 10 ** decimals;
  return String(Math.round(n * factor) / factor).replace('.', ',');
};

/**
 * Répartit les besoins : les essentiels le premier mois ; les autres
 * équipements un par un sur les mois suivants ; les quantités fractionnables
 * (eau et vivres au-delà de 3 jours) en parts égales sur les mois restants.
 */
export function schedule(
  needs: readonly Need[],
  months: number,
): PurchaseEntry[] {
  const entries: PurchaseEntry[] = [];
  const later = months > 1 ? months - 1 : 1;
  const firstLater = months > 1 ? 1 : 0;
  let next = 0;
  for (const need of needs) {
    const base = {
      label: need.label,
      category: need.category,
      prefill: need.prefill,
      vital: need.vital,
      done: false,
    };
    if (need.vital) {
      entries.push({ ...base, id: need.id, month: 0, detail: need.detail });
    } else if (need.split) {
      const part = need.split.amount / later;
      for (let k = 0; k < later; k++) {
        entries.push({
          ...base,
          id: `${need.id}-${k}`,
          month: firstLater + k,
          detail: need.split.format(part),
        });
      }
    } else {
      entries.push({
        ...base,
        id: need.id,
        month: firstLater + (next % later),
        detail: need.detail,
      });
      next++;
    }
  }
  return entries.sort((a, b) => a.month - b.month);
}

// --- Besoins à partir du stock -------------------------------------------------

const VITAL_CHECKS = new Set(['light', 'radio', 'firstaid', 'medicine']);

export async function collectNeeds(
  db: SqlDatabase,
  input: {
    items: readonly ItemSummary[];
    bags: readonly BagSummary[];
    documentCount: number;
    asOf: string;
  },
): Promise<{ needs: Need[]; targetDays: number }> {
  const [lots, household, targetDays, shortfalls, preparation] =
    await Promise.all([
      loadConsumableLots(db),
      loadHousehold(db),
      loadTargetDays(db),
      loadMinStockItems(db, input.asOf),
      getPreparation(db, {
        scope: 'home',
        tier: OFFICIAL_TIER,
        items: input.items,
        documentCount: input.documentCount,
        asOf: input.asOf,
      }),
    ]);
  const base = { lots, household, items: shortfalls, asOf: input.asOf };
  const official = computeRestockPlan({ ...base, targetDays: OFFICIAL_TIER });
  const target = computeRestockPlan({
    ...base,
    targetDays: Math.max(OFFICIAL_TIER, targetDays),
  });
  const dailyKcal = household.members * household.kcalPerPersonDay;
  const needs: Need[] = [];

  if (official.water.missing > 0) {
    needs.push({
      id: 'water-3',
      label: 'Eau potable (3 premiers jours)',
      detail: `${fmt(official.water.missing, 1)} L`,
      category: 'water',
      vital: true,
    });
  }
  if (official.food.missing > 0) {
    needs.push({
      id: 'food-3',
      label: 'Vivres sans cuisson (3 premiers jours)',
      detail: `${fmt(official.food.missing)} kcal, soit ${fmt(
        official.food.missing / dailyKcal,
        1,
      )} j pour le foyer`,
      category: 'food',
      vital: true,
    });
  }
  for (const result of preparation.results) {
    const d = result.definition;
    if (result.done || d.kind !== 'stock') {
      continue;
    }
    needs.push({
      id: `kit-${d.id}`,
      label: d.label,
      detail: d.hint ?? null,
      category: d.add?.category ?? null,
      prefill: d.add?.prefill,
      vital: VITAL_CHECKS.has(d.id),
    });
  }
  if (input.bags.every(b => b.itemCount === 0)) {
    needs.push({
      id: 'bag',
      label: 'Sac à dos d’évacuation',
      detail: 'Un par personne, à remplir avec Préparation › sac',
      category: null,
      vital: false,
    });
  }
  for (const s of target.items) {
    needs.push({
      id: `min-${s.itemId}`,
      label: s.name,
      detail: `${fmt(s.missing, 2)} ${
        s.unit === 'unit' ? 'pièce(s)' : s.unit
      } pour revenir au stock minimal`,
      category: null,
      vital: s.isCritical,
    });
  }
  const extraWater = target.water.missing - official.water.missing;
  if (extraWater > 0.05) {
    needs.push({
      id: 'water-target',
      label: `Eau potable (jusqu’à ${target.targetDays} jours)`,
      detail: null,
      category: 'water',
      vital: false,
      split: { amount: extraWater, format: n => `${fmt(n, 1)} L` },
    });
  }
  const extraFood = target.food.missing - official.food.missing;
  if (extraFood > 0.5) {
    needs.push({
      id: 'food-target',
      label: `Vivres (jusqu’à ${target.targetDays} jours)`,
      detail: null,
      category: 'food',
      vital: false,
      split: {
        amount: extraFood,
        format: n => `${fmt(n)} kcal, soit ${fmt(n / dailyKcal, 1)} j`,
      },
    });
  }
  return { needs, targetDays: target.targetDays };
}

// --- Enregistrement ---------------------------------------------------------------

export async function loadPurchasePlan(
  db: SqlDatabase,
): Promise<PurchasePlan | null> {
  const { rows } = await db.execute(
    'SELECT value FROM settings WHERE key = ?',
    [PLAN_KEY],
  );
  if (rows.length === 0) {
    return null;
  }
  try {
    const plan = JSON.parse(String(rows[0].value)) as PurchasePlan;
    return /^\d{4}-\d{2}$/.test(plan.start) && Array.isArray(plan.entries)
      ? plan
      : null;
  } catch {
    return null;
  }
}

export async function savePurchasePlan(
  db: SqlDatabase,
  plan: PurchasePlan | null,
): Promise<void> {
  if (plan === null) {
    await db.execute('DELETE FROM settings WHERE key = ?', [PLAN_KEY]);
    return;
  }
  await db.execute(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
    [PLAN_KEY, JSON.stringify(plan)],
  );
}

export async function createPurchasePlan(
  db: SqlDatabase,
  input: {
    items: readonly ItemSummary[];
    bags: readonly BagSummary[];
    documentCount: number;
    asOf: string;
    months: number;
  },
): Promise<PurchasePlan> {
  const { needs, targetDays } = await collectNeeds(db, input);
  const plan: PurchasePlan = {
    start: monthOf(input.asOf),
    months: input.months,
    targetDays,
    entries: schedule(needs, input.months),
  };
  await savePurchasePlan(db, plan);
  return plan;
}

export async function setPurchaseDone(
  db: SqlDatabase,
  id: string,
  done: boolean,
): Promise<PurchasePlan | null> {
  const plan = await loadPurchasePlan(db);
  if (plan === null) {
    return null;
  }
  const next = {
    ...plan,
    entries: plan.entries.map(e => (e.id === id ? { ...e, done } : e)),
  };
  await savePurchasePlan(db, next);
  return next;
}

/** Premiers jours des mois du plan qui ont encore des achats, à 9 h. */
export function monthlyReminderDays(plan: PurchasePlan): string[] {
  const days: string[] = [];
  for (let m = 0; m < plan.months; m++) {
    if (plan.entries.some(e => e.month === m && !e.done)) {
      days.push(`${addMonths(plan.start, m)}-01`);
    }
  }
  return days;
}
