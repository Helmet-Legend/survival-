import { prepareDatabase } from '../../src/db/connection';
import { InventoryRepository } from '../../src/inventory';
import {
  addCrisisShortfalls,
  addMonths,
  applyBudget,
  createPurchasePlan,
  currentMonthIndex,
  loadPurchasePlan,
  monthLabel,
  monthlyReminderDays,
  monthTotal,
  schedule,
  setPurchaseBudget,
  setPurchaseDone,
  setPurchasePrice,
  updatePurchasePlan,
  type Need,
  type PurchaseEntry,
} from '../../src/plan/purchasePlan';
import { reminderTimes } from '../../src/resilience/reminders';
import { saveTargetDays } from '../../src/resilience/resilienceCalculator';
import { NodeSqliteDb } from '../db/sqlite';

const TODAY = '2026-10-18';

async function setup() {
  const db = new NodeSqliteDb();
  await prepareDatabase(db);
  return { db, repo: new InventoryRepository(db, { today: () => TODAY }) };
}

const need = (id: string, extra: Partial<Need> = {}): Need => ({
  id,
  label: id,
  detail: null,
  category: null,
  vital: false,
  ...extra,
});

describe('mois du plan', () => {
  it('décale, nomme et situe les mois', () => {
    expect(addMonths('2026-11', 2)).toBe('2027-01');
    expect(addMonths('2026-01', -1)).toBe('2025-12');
    expect(monthLabel('2027-02')).toBe('février 2027');
    const plan = { start: '2026-10', months: 3, targetDays: 7, entries: [] };
    expect(currentMonthIndex(plan, '2026-10-31')).toBe(0);
    expect(currentMonthIndex(plan, '2026-12-01')).toBe(2);
    expect(currentMonthIndex(plan, '2027-06-01')).toBe(2);
  });
});

describe('répartition', () => {
  it('met l’essentiel le premier mois et étale le reste', () => {
    const entries = schedule(
      [
        need('eau', { vital: true }),
        need('a'),
        need('b'),
        need('c'),
        need('reserve', {
          split: { amount: 30, format: n => `${n} L` },
        }),
      ],
      3,
    );
    expect(entries.map(e => [e.id, e.month, e.detail])).toEqual([
      ['eau', 0, null],
      ['a', 1, null],
      ['c', 1, null],
      ['reserve-1', 1, '15 L'],
      ['b', 2, null],
      ['reserve-2', 2, '15 L'],
    ]);
  });

  it('tout tient dans le mois quand le plan dure un mois', () => {
    expect(
      schedule(
        [need('a'), need('x', { split: { amount: 6, format: String } })],
        1,
      ).map(e => [e.id, e.month, e.detail]),
    ).toEqual([
      ['a', 0, null],
      ['x-0', 0, '6'],
    ]);
  });

  it('repart du mois en cours', () => {
    expect(
      schedule(
        [
          need('eau', { vital: true }),
          need('a'),
          need('x', { split: { amount: 6, unit: 'L', format: String } }),
        ],
        6,
        4,
      ).map(e => [e.id, e.month, e.amount]),
    ).toEqual([
      ['eau', 4, undefined],
      ['a', 5, undefined],
      ['x-5', 5, 6],
    ]);
  });
});

const entry = (
  id: string,
  month: number,
  extra: Partial<PurchaseEntry> = {},
): PurchaseEntry => ({
  id,
  month,
  label: id,
  detail: null,
  category: null,
  vital: false,
  done: false,
  ...extra,
});

describe('budget mensuel', () => {
  it('place les achats chiffrés au plus tôt dans le budget et allonge le plan', () => {
    const plan = applyBudget(
      {
        start: '2026-10',
        months: 2,
        targetDays: 7,
        budget: 50,
        entries: [
          entry('eau', 0, { vital: true, price: 30 }),
          entry('radio', 0, { price: 25 }),
          entry('lampe', 1, { price: 15 }),
          entry('filtre', 1, { price: 80 }),
          entry('sac', 1),
          entry('fait', 1, { done: true, price: 40 }),
        ],
      },
      0,
    );
    const at = (id: string) => plan.entries.find(e => e.id === id)?.month;
    // 30 € d'essentiel en octobre : la lampe (15 €) y tient, pas la radio.
    expect([at('eau'), at('lampe'), at('radio'), at('filtre')]).toEqual([
      0, 0, 2, 3,
    ]);
    // Sans prix ou déjà fait : rien ne bouge.
    expect([at('sac'), at('fait')]).toEqual([1, 1]);
    expect(plan.months).toBe(4);
    expect([0, 1, 2, 3].map(m => monthTotal(plan, m))).toEqual([
      45, 40, 25, 80,
    ]);
  });
});

describe('plan d’après le stock', () => {
  it('liste les manques, se coche et programme les rappels du 1er', async () => {
    const { db, repo } = await setup();
    // 1 personne à 3 L : 3 L pour 3 jours, 6 L de plus pour 5 jours.
    await saveTargetDays(db, 5);
    await repo.createItem(
      {
        name: 'Lampe frontale',
        category: 'energy',
        unit: 'unit',
        subtype: 'lighting',
      },
      { quantity: 1 },
    );
    const plan = await createPurchasePlan(db, {
      items: await repo.listItems({ bag: 'none' }),
      bags: [],
      documentCount: 0,
      asOf: TODAY,
      months: 3,
    });
    expect(plan.start).toBe('2026-10');
    const ids = plan.entries.map(e => e.id);
    expect(ids).toContain('water-3');
    expect(ids).toContain('food-3');
    expect(ids).toContain('kit-radio');
    expect(ids).not.toContain('kit-light');
    expect(ids).toContain('bag');
    const water = plan.entries.filter(e => e.id.startsWith('water'));
    expect(water.map(e => [e.month, e.detail])).toEqual([
      [0, expect.stringMatching(/ L$/)],
      [1, expect.stringMatching(/ L$/)],
      [2, expect.stringMatching(/ L$/)],
    ]);
    expect(plan.entries.find(e => e.id === 'kit-radio')).toMatchObject({
      month: 0,
      vital: true,
      category: 'energy',
    });

    expect(monthlyReminderDays(plan)).toEqual([
      '2026-10-01',
      '2026-11-01',
      '2026-12-01',
    ]);
    const times = await reminderTimes(db, new Date(2026, 9, 18, 12));
    expect(times).toContain(new Date(2026, 10, 1, 9).getTime());
    expect(times).not.toContain(new Date(2026, 9, 1, 9).getTime());

    // Mois de décembre terminé : plus de rappel ce mois-là.
    for (const e of plan.entries.filter(x => x.month === 2)) {
      await setPurchaseDone(db, e.id, true);
    }
    const saved = await loadPurchasePlan(db);
    expect(monthlyReminderDays(saved!)).toEqual(['2026-10-01', '2026-11-01']);
  });
});

describe('mise à jour, budget et simulateur', () => {
  async function planFor(db: NodeSqliteDb, repo: InventoryRepository) {
    await saveTargetDays(db, 5);
    return createPurchasePlan(db, {
      items: await repo.listItems({ bag: 'none' }),
      bags: [],
      documentCount: 0,
      asOf: TODAY,
      months: 3,
    });
  }

  it('garde les coches et retire ce que le stock comble', async () => {
    const { db, repo } = await setup();
    await planFor(db, repo);
    await setPurchaseDone(db, 'kit-radio', true);
    await setPurchasePrice(db, 'bag', 45, TODAY);
    // Achat d'une lampe : le manque disparaît à la mise à jour.
    await repo.createItem(
      { name: 'Lampe', category: 'energy', unit: 'unit', subtype: 'lighting' },
      { quantity: 1 },
    );
    const input = {
      items: await repo.listItems({ bag: 'none' }),
      bags: [],
      documentCount: 0,
      asOf: '2026-11-03',
    };
    const plan = await updatePurchasePlan(db, input);
    const byId = new Map(plan.entries.map(e => [e.id, e]));
    expect(byId.get('kit-radio')).toMatchObject({ done: true, month: 0 });
    expect(byId.has('kit-light')).toBe(false);
    expect(byId.get('bag')?.price).toBe(45);
    // L'eau des 3 premiers jours, encore manquante, passe au mois en cours.
    expect(byId.get('water-3')?.month).toBe(1);
    expect(plan.entries.filter(e => e.month === 0 && !e.done)).toEqual([]);
  });

  it('ajoute les manques d’une crise moins ce qui est déjà prévu', async () => {
    const { db, repo } = await setup();
    const before = await planFor(db, repo);
    const plannedWater = before.entries
      .filter(e => e.unit === 'L')
      .reduce((sum, e) => sum + (e.amount ?? 0), 0);
    // 1 personne à 3 L, objectif 5 jours : 15 L prévus.
    expect(plannedWater).toBeCloseTo(15);
    const input = { items: [], bags: [], documentCount: 0, asOf: TODAY };
    const { plan, alreadyPlanned } = await addCrisisShortfalls(db, input, [
      { kind: 'water', amount: 63, crisis: 'confinement de 21 jours' },
      { kind: 'food', amount: 1000, crisis: 'confinement de 21 jours' },
      { kind: 'energy', amount: 40, crisis: 'confinement de 21 jours' },
    ]);
    expect(alreadyPlanned).toEqual(['food']);
    const crisisWater = plan.entries.filter(e =>
      e.id.startsWith('crisis-water'),
    );
    expect(crisisWater.map(e => e.month)).toEqual([1, 2]);
    expect(crisisWater.reduce((s, e) => s + (e.amount ?? 0), 0)).toBeCloseTo(
      48,
    );
    expect(crisisWater[0]).toMatchObject({
      label: 'Eau potable · confinement de 21 jours',
      category: 'water',
      source: 'crisis',
    });
    // Une nouvelle simulation remplace l'ajout précédent.
    const again = await addCrisisShortfalls(db, input, [
      { kind: 'water', amount: 21, crisis: 'coupure de 7 jours' },
    ]);
    const water2 = again.plan.entries.filter(e =>
      e.id.startsWith('crisis-water'),
    );
    expect(water2.reduce((s, e) => s + (e.amount ?? 0), 0)).toBeCloseTo(6);
    // Gardé par la mise à jour d'après le stock.
    const updated = await updatePurchasePlan(db, input);
    expect(updated.entries.some(e => e.id.startsWith('crisis-energy'))).toBe(
      true,
    );
  });

  it('règle et efface le budget', async () => {
    const { db, repo } = await setup();
    await planFor(db, repo);
    await setPurchasePrice(db, 'bag', 60, TODAY);
    const plan = await setPurchaseBudget(db, 50, TODAY);
    expect(plan?.budget).toBe(50);
    const cleared = await setPurchaseBudget(db, null, TODAY);
    expect(cleared?.budget).toBeUndefined();
    expect(cleared?.entries.find(e => e.id === 'bag')?.price).toBe(60);
  });
});
