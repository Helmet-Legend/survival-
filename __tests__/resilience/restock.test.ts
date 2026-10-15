import { prepareDatabase } from '../../src/db/connection';
import { InventoryError, InventoryRepository } from '../../src/inventory';
import { addDays } from '../../src/lib/dates';
import {
  getExpiryAlerts,
  loadTargetDays,
  saveHousehold,
  saveTargetDays,
  type HouseholdSettings,
  type StockLot,
} from '../../src/resilience/resilienceCalculator';
import {
  computeRestockPlan,
  getRestockPlan,
} from '../../src/resilience/restock';
import { NodeSqliteDb } from '../db/sqlite';

const TODAY = '2026-10-15';
const in_ = (days: number) => addDays(TODAY, days);
const ONE: HouseholdSettings = {
  members: 1,
  waterLitersPerPersonDay: 3,
  kcalPerPersonDay: 2000,
};

let seq = 0;
function water(
  quantity: number,
  expirationDate: string | null = null,
): StockLot {
  seq++;
  return {
    lotId: `l${seq}`,
    itemId: `i${seq}`,
    itemName: 'Eau',
    category: 'water',
    unit: 'L',
    quantity,
    caloriesPerUnit: null,
    expirationDate,
  };
}
function food(kcal: number, expirationDate: string | null = null): StockLot {
  return {
    ...water(1, expirationDate),
    category: 'food',
    unit: 'unit',
    caloriesPerUnit: kcal,
  };
}

const plan = (lots: StockLot[], targetDays = 14, household = ONE) =>
  computeRestockPlan({ lots, household, targetDays, items: [], asOf: TODAY });

describe('computeRestockPlan', () => {
  it('calcule le manque pour atteindre l’objectif', () => {
    const p = plan([water(30), food(20_000)]);
    // Eau : besoin 14 × 3 = 42 L, stock 30 L → manque 12 L.
    expect(p.water).toEqual({
      needed: 42,
      covered: 30,
      missing: 12,
      coveredDays: 10,
    });
    // Vivres : besoin 28 000 kcal, stock 20 000 → manque 8 000.
    expect(p.food.missing).toBe(8000);
    expect(p.complete).toBe(false);
  });

  it('ne compte pas le stock qui périme avant d’être consommé', () => {
    // 60 L, mais périment dans 4 jours : ne couvrent que 5 jours (15 L).
    const p = plan([water(60, in_(4))]);
    expect(p.water.coveredDays).toBe(5);
    expect(p.water.missing).toBe(27);
  });

  it('ignore le surplus au-delà de l’objectif', () => {
    const p = plan([water(500), food(1_000_000)]);
    expect(p.water.missing).toBe(0);
    expect(p.water.coveredDays).toBe(14);
    expect(p.complete).toBe(true);
  });

  it('suit le nombre de personnes et l’objectif', () => {
    const p = plan([water(30)], 7, { ...ONE, members: 4 });
    expect(p.water.needed).toBe(84);
    expect(p.water.missing).toBe(54);
  });

  it('liste les articles sous leur stock minimal, critiques d’abord', () => {
    const p = computeRestockPlan({
      lots: [water(500), food(1_000_000)],
      household: ONE,
      targetDays: 14,
      asOf: TODAY,
      items: [
        {
          itemId: 'a',
          name: 'Piles AA',
          unit: 'unit',
          isCritical: false,
          minStock: 12,
          usable: 4,
        },
        {
          itemId: 'b',
          name: 'Filtre à eau',
          unit: 'unit',
          isCritical: true,
          minStock: 2,
          usable: 1,
        },
        {
          itemId: 'c',
          name: 'Bougies',
          unit: 'unit',
          isCritical: false,
          minStock: 5,
          usable: 9,
        },
      ],
    });
    expect(p.items.map(i => [i.name, i.missing])).toEqual([
      ['Filtre à eau', 1],
      ['Piles AA', 8],
    ]);
    expect(p.complete).toBe(false);
  });
});

describe('base de données', () => {
  async function setup() {
    const db = new NodeSqliteDb();
    await prepareDatabase(db);
    let n = 0;
    const repo = new InventoryRepository(db, {
      newId: () => `id${++n}`,
      today: () => TODAY,
    });
    return { db, repo };
  }

  it('enregistre l’objectif d’autonomie et le valide', async () => {
    const { db } = await setup();
    expect(await loadTargetDays(db)).toBe(14);
    await saveTargetDays(db, 30);
    expect(await loadTargetDays(db)).toBe(30);
    await expect(saveTargetDays(db, 0)).rejects.toThrow(/entre 1 et 365/);
    await expect(saveTargetDays(db, 2.5)).rejects.toThrow();
  });

  it('produit le plan à partir de l’inventaire', async () => {
    const { db, repo } = await setup();
    await saveHousehold(db, { ...ONE, members: 2 });
    await saveTargetDays(db, 7);
    await repo.createItem(
      { name: 'Eau', category: 'water', unit: 'L' },
      { quantity: 30 },
    );
    const filter = await repo.createItem(
      {
        name: 'Filtre à eau',
        category: 'tool',
        unit: 'unit',
        minStock: 2,
        isCritical: true,
      },
      { quantity: 1, expirationDate: in_(400) },
    );
    // Un lot périmé ne compte pas dans le stock utilisable.
    await repo.addLot(filter.id, { quantity: 5, expirationDate: in_(-1) });

    const p = await getRestockPlan(db, TODAY);
    expect(p.targetDays).toBe(7);
    expect(p.water.missing).toBe(12); // 7 × 2 × 3 = 42 L − 30 L
    expect(p.food.missing).toBe(28_000); // aucun vivre
    expect(p.items).toEqual([
      expect.objectContaining({
        name: 'Filtre à eau',
        minStock: 2,
        usable: 1,
        missing: 1,
      }),
    ]);
  });

  it('valide le stock minimal et le délai d’alerte', async () => {
    const { repo } = await setup();
    const bad = async (patch: object, field: string) => {
      const error = await repo
        .createItem({ name: 'x', category: 'tool', unit: 'unit', ...patch })
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(InventoryError);
      expect(error).toMatchObject({ field });
    };
    await bad({ minStock: -1 }, 'minStock');
    await bad({ alertDays: 0 }, 'alertDays');
    await bad({ alertDays: 1.5 }, 'alertDays');
    const ok = await repo.createItem({
      name: 'Filtre',
      category: 'tool',
      unit: 'unit',
      minStock: 2,
      alertDays: 180,
    });
    expect(ok).toMatchObject({ minStock: 2, alertDays: 180 });
    expect(await repo.updateItem(ok.id, { minStock: null })).toMatchObject({
      minStock: null,
    });
  });

  it('alerte selon le seuil propre à l’article, au-delà de 90 jours', async () => {
    const { db, repo } = await setup();
    await repo.createItem(
      { name: 'Filtre à eau', category: 'tool', unit: 'unit', alertDays: 180 },
      { quantity: 1, expirationDate: in_(150) },
    );
    await repo.createItem(
      { name: 'Piles', category: 'energy', unit: 'unit' },
      { quantity: 4, expirationDate: in_(150) },
    );
    const alerts = await getExpiryAlerts(db, TODAY);
    expect(alerts.map(a => [a.itemName, a.bucket, a.alertDays])).toEqual([
      ['Filtre à eau', 'watch', 180],
    ]);
  });
});
