import { prepareDatabase } from '../../src/db/connection';
import { InventoryRepository } from '../../src/inventory';
import {
  addMonths,
  createPurchasePlan,
  currentMonthIndex,
  loadPurchasePlan,
  monthLabel,
  monthlyReminderDays,
  schedule,
  setPurchaseDone,
  type Need,
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
      ['reserve-0', 1, '15 L'],
      ['b', 2, null],
      ['reserve-1', 2, '15 L'],
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
