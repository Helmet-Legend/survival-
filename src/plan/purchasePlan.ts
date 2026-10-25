/**
 * Plan d'achats échelonné : ce qui manque pour compléter la préparation,
 * réparti sur plusieurs mois, l'essentiel d'abord. Les manques viennent du
 * stock réel : eau et vivres jusqu'à 3 jours puis jusqu'à l'objectif
 * d'autonomie, équipement du kit 72 h, matériel de base « À prévoir » de la
 * liste Kit et matériel, articles sous leur stock minimal, sac d'évacuation,
 * et les manques d'une crise simulée. Aucun prix n'est
 * inventé : l'utilisateur peut saisir le prix de ses achats et un budget
 * mensuel, que le plan respecte en reportant ce qui dépasse.
 *
 * Le plan est enregistré dans le coffre ; chaque achat se coche, et la mise
 * à jour d'après le stock garde les coches. Un rappel neutre peut être
 * programmé le 1er de chaque mois (voir reminders.ts).
 */
import type { SqlDatabase } from '../db/types';
import type { BagSummary, ItemCategory, ItemSummary } from '../inventory';
import { computeRestockPlan, loadMinStockItems } from '../resilience/restock';
import { getBaseGear, isEssential } from './baseGear';
import {
  dailyKcalNeed,
  loadConsumableLots,
  loadHousehold,
  loadTargetDays,
} from '../resilience/resilienceCalculator';
import { getPreparation, OFFICIAL_TIER } from './preparation';

export const PLAN_MONTHS = [2, 3, 6, 12] as const;
export const PLAN_MONTHS_DEFAULT = 3;
/** Durée maximale quand le budget oblige à reporter des achats. */
export const PLAN_MONTHS_MAX = 24;
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
  /** Armement : fiche de munition ou d'accessoire. */
  recordType?: 'ammo' | 'accessory';
  prefill?: Record<string, string>;
  /** Essentiel : à acheter en premier. */
  vital: boolean;
  done: boolean;
  /** Prix saisi par l'utilisateur, en euros. */
  price?: number;
  /** Quantité d'eau ou de vivres de l'achat, pour ne pas la compter deux fois. */
  amount?: number;
  unit?: AmountUnit;
  /** Ajouté depuis le simulateur de crise : gardé à la mise à jour. */
  source?: 'crisis';
}

export type AmountUnit = 'L' | 'kcal' | 'Wh';

export interface PurchasePlan {
  /** Mois de départ, `AAAA-MM`. */
  start: string;
  months: number;
  targetDays: number;
  entries: PurchaseEntry[];
  /** Budget mensuel saisi, en euros. */
  budget?: number;
}

/** Besoin à placer dans le plan, avant répartition. */
export interface Need {
  id: string;
  label: string;
  detail: string | null;
  category: ItemCategory | null;
  recordType?: 'ammo' | 'accessory';
  prefill?: Record<string, string>;
  vital: boolean;
  /** Quantité d'un achat d'un bloc (eau, vivres des 3 premiers jours). */
  quantity?: { amount: number; unit: AmountUnit };
  /** Quantité fractionnable sur plusieurs mois (eau, vivres), sinon absent. */
  split?: {
    amount: number;
    unit?: AmountUnit;
    format: (amount: number) => string;
  };
  source?: 'crisis';
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
 * Répartit les besoins à partir du mois `from` (0 : le mois de création) :
 * les essentiels ce mois-là ; les autres équipements un par un sur les mois
 * suivants ; les quantités fractionnables (eau et vivres au-delà de 3 jours)
 * en parts égales sur les mois restants.
 */
export function schedule(
  needs: readonly Need[],
  months: number,
  from = 0,
): PurchaseEntry[] {
  const entries: PurchaseEntry[] = [];
  const first = Math.min(from, months - 1);
  const later = months - first > 1 ? months - first - 1 : 1;
  const firstLater = months - first > 1 ? first + 1 : first;
  let next = 0;
  for (const need of needs) {
    const base = {
      label: need.label,
      category: need.category,
      ...(need.recordType ? { recordType: need.recordType } : {}),
      prefill: need.prefill,
      vital: need.vital,
      done: false,
      ...(need.source ? { source: need.source } : {}),
    };
    const quantity = need.quantity
      ? { amount: need.quantity.amount, unit: need.quantity.unit }
      : {};
    if (need.vital) {
      entries.push({
        ...base,
        ...quantity,
        id: need.id,
        month: first,
        detail: need.detail,
      });
    } else if (need.split) {
      const part = need.split.amount / later;
      for (let k = 0; k < later; k++) {
        const month = firstLater + k;
        entries.push({
          ...base,
          // Identifiant lié au mois : stable d'une mise à jour à l'autre.
          id: `${need.id}-${month}`,
          month,
          detail: need.split.format(part),
          ...(need.split.unit ? { amount: part, unit: need.split.unit } : {}),
        });
      }
    } else {
      entries.push({
        ...base,
        ...quantity,
        id: need.id,
        month: firstLater + (next % later),
        detail: need.detail,
      });
      next++;
    }
  }
  return entries.sort((a, b) => a.month - b.month);
}

/** Total des prix saisis d'un mois. */
export function monthTotal(plan: PurchasePlan, month: number): number {
  return plan.entries
    .filter(e => e.month === month && e.price !== undefined)
    .reduce((sum, e) => sum + (e.price ?? 0), 0);
}

/**
 * Applique le budget mensuel à partir du mois `from` : les achats chiffrés,
 * non essentiels et pas encore faits sont replacés, dans leur ordre, au
 * premier mois où ils tiennent dans le budget ; le plan s'allonge si
 * nécessaire (jusqu'à PLAN_MONTHS_MAX). Achats faits, essentiels et achats
 * sans prix ne bougent pas. Un achat plus cher que le budget a son propre
 * mois.
 */
export function applyBudget(plan: PurchasePlan, from: number): PurchasePlan {
  const budget = plan.budget;
  if (budget === undefined || !(budget > 0)) {
    return plan;
  }
  const movable = (e: PurchaseEntry) =>
    !e.done && !e.vital && e.price !== undefined && e.month >= from;
  const fixed = plan.entries.filter(e => !movable(e));
  const totals: number[] = [];
  const add = (month: number, price: number) => {
    totals[month] = (totals[month] ?? 0) + price;
  };
  for (const e of fixed) {
    add(e.month, e.price ?? 0);
  }
  let months = plan.months;
  const moved: PurchaseEntry[] = [];
  const toPlace = plan.entries
    .map((e, index) => ({ e, index }))
    .filter(({ e }) => movable(e))
    .sort((a, b) => a.e.month - b.e.month || a.index - b.index);
  for (const { e } of toPlace) {
    const price = e.price ?? 0;
    let month = from;
    while (
      month < PLAN_MONTHS_MAX - 1 &&
      (totals[month] ?? 0) > 0 &&
      (totals[month] ?? 0) + price > budget
    ) {
      month++;
    }
    add(month, price);
    months = Math.max(months, month + 1);
    moved.push({ ...e, month });
  }
  return {
    ...plan,
    months,
    entries: [...fixed, ...moved].sort((a, b) => a.month - b.month),
  };
}

// --- Besoins à partir du stock -------------------------------------------------

const VITAL_CHECKS = new Set(['light', 'radio', 'firstaid', 'medicine']);

/**
 * Matériel de base qui n'entre pas dans le plan : eau et vivres (comptés en
 * quantités ci-dessus), sac d'évacuation (besoin à part), et ce qui ne
 * s'achète pas (copies, plan papier, argent, double des clés).
 */
const GEAR_NOT_BOUGHT = new Set([
  'water_reserve',
  'food',
  'bag',
  'documents',
  'contacts',
  'family_plan',
  'cash',
  'keys',
  'weapon_papers',
]);

/**
 * Matériel de base déjà couvert par un point du kit 72 h : proposé seulement
 * si ce point est rempli (bougies présentes mais pas de briquet, par
 * exemple), sinon le kit 72 h le propose déjà.
 */
const GEAR_IN_KIT: Record<string, string> = {
  light: 'light',
  batteries: 'batteries',
  powerbank: 'powerbank',
  radio: 'radio',
  firstaid: 'firstaid',
  medicine: 'medicine',
  candles: 'fire',
  lighter: 'fire',
  warm_clothes: 'warm',
};

/** Matériel de base : tout le stock (maison et sacs) et les armes. */
export interface GearInput {
  items: readonly ItemSummary[];
  bagNames: readonly string[];
  weaponCount: number;
}

export async function collectNeeds(
  db: SqlDatabase,
  input: {
    items: readonly ItemSummary[];
    bags: readonly BagSummary[];
    documentCount: number;
    asOf: string;
    gear?: GearInput;
  },
): Promise<{ needs: Need[]; targetDays: number }> {
  const [lots, household, targetDays, shortfalls, preparation, gear] =
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
      input.gear
        ? getBaseGear(db, {
            items: input.gear.items,
            documentCount: input.documentCount,
            bagNames: input.gear.bagNames,
            weaponCount: input.gear.weaponCount,
          })
        : null,
    ]);
  const base = { lots, household, items: shortfalls, asOf: input.asOf };
  const official = computeRestockPlan({ ...base, targetDays: OFFICIAL_TIER });
  const target = computeRestockPlan({
    ...base,
    targetDays: Math.max(OFFICIAL_TIER, targetDays),
  });
  const dailyKcal = dailyKcalNeed(household);
  const needs: Need[] = [];

  if (official.water.missing > 0) {
    needs.push({
      id: 'water-3',
      label: 'Eau potable (3 premiers jours)',
      detail: `${fmt(official.water.missing, 1)} L`,
      category: 'water',
      vital: true,
      quantity: { amount: official.water.missing, unit: 'L' },
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
      quantity: { amount: official.food.missing, unit: 'kcal' },
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
  // Proposés seulement si le foyer compte un bébé ou des enfants.
  const notForHousehold = new Set([
    ...((household.babies ?? 0) > 0 ? [] : ['baby']),
    ...((household.children ?? 0) > 0 ? [] : ['kids']),
  ]);
  const kitMissing = new Set(
    preparation.results.filter(r => !r.done).map(r => r.definition.id),
  );
  for (const result of gear?.results ?? []) {
    const d = result.definition;
    const kit = GEAR_IN_KIT[d.id];
    if (
      result.status !== 'missing' ||
      GEAR_NOT_BOUGHT.has(d.id) ||
      notForHousehold.has(d.id) ||
      (kit !== undefined && kitMissing.has(kit))
    ) {
      continue;
    }
    needs.push({
      id: `gear-${d.id}`,
      label: d.label,
      detail: d.hint ?? null,
      category: d.add?.category ?? null,
      ...(d.add?.recordType ? { recordType: d.add.recordType } : {}),
      prefill: d.add?.prefill,
      vital: isEssential(d),
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
      split: {
        amount: extraWater,
        unit: 'L',
        format: n => `${fmt(n, 1)} L`,
      },
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
        unit: 'kcal',
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

interface StockInput {
  items: readonly ItemSummary[];
  bags: readonly BagSummary[];
  documentCount: number;
  asOf: string;
  gear?: GearInput;
}

export async function createPurchasePlan(
  db: SqlDatabase,
  input: StockInput & { months: number },
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

/**
 * Met le plan à jour d'après le stock actuel sans perdre ce qui est fait :
 * achats cochés et ajouts du simulateur gardés tels quels ; manques encore
 * présents gardés à leur mois avec leur prix ; nouveaux manques répartis à
 * partir du mois en cours ; manques comblés retirés. Sans plan, en crée un.
 */
export async function updatePurchasePlan(
  db: SqlDatabase,
  input: StockInput & { months?: number },
): Promise<PurchasePlan> {
  const plan = await loadPurchasePlan(db);
  if (plan === null) {
    return createPurchasePlan(db, {
      ...input,
      months: input.months ?? PLAN_MONTHS_DEFAULT,
    });
  }
  const from = currentMonthIndex(plan, input.asOf);
  const { needs, targetDays } = await collectNeeds(db, input);
  const previous = new Map(plan.entries.map(e => [e.id, e]));
  const done = new Set(plan.entries.filter(e => e.done).map(e => e.id));
  const kept = plan.entries.filter(e => e.done || e.source === 'crisis');
  // Un équipement coché comme acheté n'est pas reproposé ; les quantités
  // (eau, vivres) sont recalculées d'après le stock.
  const fresh = schedule(
    needs.filter(n => n.split !== undefined || !done.has(n.id)),
    plan.months,
    from,
  )
    .filter(e => !done.has(e.id))
    .map(e => {
      const old = previous.get(e.id);
      if (old === undefined) {
        return e;
      }
      return {
        ...e,
        month:
          e.amount === undefined || e.vital
            ? Math.max(old.month, from)
            : e.month,
        ...(old.price !== undefined ? { price: old.price } : {}),
      };
    });
  const next = applyBudget(
    {
      ...plan,
      targetDays,
      entries: [...kept, ...fresh].sort((a, b) => a.month - b.month),
    },
    from,
  );
  await savePurchasePlan(db, next);
  return next;
}

/** Manque relevé par le simulateur de crise. */
export interface CrisisShortfall {
  /** `water`, `food` ou `energy` : un seul ajout de chaque par plan. */
  kind: 'water' | 'food' | 'energy';
  amount: number;
  /** Nom de la crise simulée, pour le libellé (« confinement de 21 jours »). */
  crisis: string;
}

const SHORTFALL: Record<
  CrisisShortfall['kind'],
  {
    label: string;
    unit: AmountUnit;
    category: ItemCategory;
    prefill?: Record<string, string>;
    format: (n: number) => string;
  }
> = {
  water: {
    label: 'Eau potable',
    unit: 'L',
    category: 'water',
    format: n => `${fmt(n, 1)} L`,
  },
  food: {
    label: 'Vivres',
    unit: 'kcal',
    category: 'food',
    format: n => `${fmt(n)} kcal`,
  },
  energy: {
    label: 'Énergie stockée (batteries, batterie externe)',
    unit: 'Wh',
    category: 'power',
    prefill: { name: 'Batterie externe', subtype: 'powerbank' },
    format: n => `${fmt(n)} Wh`,
  },
};

/**
 * Ajoute au plan les manques d'une crise simulée, moins ce que le plan
 * prévoit déjà d'acheter (eau, vivres), réparti à partir du mois en cours.
 * Un nouvel ajout du même type remplace le précédent s'il n'est pas fait.
 * Renvoie le plan et les manques déjà couverts par le plan.
 */
export async function addCrisisShortfalls(
  db: SqlDatabase,
  input: StockInput,
  shortfalls: readonly CrisisShortfall[],
): Promise<{ plan: PurchasePlan; alreadyPlanned: CrisisShortfall['kind'][] }> {
  const base =
    (await loadPurchasePlan(db)) ??
    (await createPurchasePlan(db, { ...input, months: PLAN_MONTHS_DEFAULT }));
  const from = currentMonthIndex(base, input.asOf);
  let entries = base.entries;
  const needs: Need[] = [];
  const alreadyPlanned: CrisisShortfall['kind'][] = [];
  for (const s of shortfalls) {
    const def = SHORTFALL[s.kind];
    const id = `crisis-${s.kind}`;
    entries = entries.filter(
      e => e.done || !(e.id === id || e.id.startsWith(`${id}-`)),
    );
    const planned = entries
      .filter(e => !e.done && e.unit === def.unit)
      .reduce((sum, e) => sum + (e.amount ?? 0), 0);
    const extra = s.amount - planned;
    if (!(extra > (def.unit === 'L' ? 0.05 : 0.5))) {
      alreadyPlanned.push(s.kind);
      continue;
    }
    needs.push({
      id,
      label: `${def.label} · ${s.crisis}`,
      detail: null,
      category: def.category,
      prefill: def.prefill,
      vital: false,
      source: 'crisis',
      split: { amount: extra, unit: def.unit, format: def.format },
    });
  }
  const added = schedule(needs, base.months, from);
  const plan = applyBudget(
    {
      ...base,
      entries: [...entries, ...added].sort((a, b) => a.month - b.month),
    },
    from,
  );
  await savePurchasePlan(db, plan);
  return { plan, alreadyPlanned };
}

/** Saisit le prix d'un achat (null : l'effacer), puis réapplique le budget. */
export async function setPurchasePrice(
  db: SqlDatabase,
  id: string,
  price: number | null,
  asOf: string,
): Promise<PurchasePlan | null> {
  const plan = await loadPurchasePlan(db);
  if (plan === null) {
    return null;
  }
  const next = {
    ...plan,
    entries: plan.entries.map(e => {
      if (e.id !== id) {
        return e;
      }
      const rest = { ...e };
      delete rest.price;
      return price === null ? rest : { ...rest, price };
    }),
  };
  // Un prix saisi peut faire dépasser le budget du mois : réappliqué.
  const placed = applyBudget(next, currentMonthIndex(plan, asOf));
  await savePurchasePlan(db, placed);
  return placed;
}

/** Règle le budget mensuel (null : sans budget) et répartit en conséquence. */
export async function setPurchaseBudget(
  db: SqlDatabase,
  budget: number | null,
  asOf: string,
): Promise<PurchasePlan | null> {
  const plan = await loadPurchasePlan(db);
  if (plan === null) {
    return null;
  }
  const rest = { ...plan };
  delete rest.budget;
  const next =
    budget === null
      ? rest
      : applyBudget({ ...rest, budget }, currentMonthIndex(plan, asOf));
  await savePurchasePlan(db, next);
  return next;
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
