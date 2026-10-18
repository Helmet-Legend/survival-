import { prepareDatabase } from '../../src/db/connection';
import { InventoryRepository } from '../../src/inventory';
import {
  computeElectric,
  computeWater,
  EFFICIENCY_DEFAULT,
  loadElectricSettings,
  MARGIN_DEFAULT,
  parseAmount,
  saveElectricSettings,
  waterStock,
} from '../../src/resilience/calculators';
import { getResilienceReport } from '../../src/resilience/resilienceCalculator';
import { NodeSqliteDb } from '../db/sqlite';

const TODAY = '2026-10-15';

async function setup() {
  const db = new NodeSqliteDb();
  await prepareDatabase(db);
  return { db, repo: new InventoryRepository(db, { today: () => TODAY }) };
}

describe('calculateur d’eau', () => {
  it('additionne les usages, le manque et la masse', () => {
    const r = computeWater(
      { people: 2, days: 3, drinking: 2, cooking: 3, hygiene: 2 },
      30,
    );
    expect(r.dailyNeed).toBe(14);
    expect(r.totalNeed).toBe(42);
    expect(r.deficit).toBe(12);
    expect(r.massKg).toBe(42);
    expect(r.days).toBe(2);
  });

  it('ne divise pas par zéro et ne donne pas de manque négatif', () => {
    const r = computeWater(
      { people: 1, days: 3, drinking: 0, cooking: 0, hygiene: 0 },
      10,
    );
    expect(r.days).toBeNull();
    expect(r.deficit).toBe(0);
    // 6 L pour 2 L par jour : 3 jours, sans erreur d'arrondi.
    expect(
      computeWater(
        { people: 1, days: 3, drinking: 0.4, cooking: 1.6, hygiene: 0 },
        6,
      ).days,
    ).toBe(3);
  });

  it('sépare l’eau potable du reste et l’exclut de l’autonomie', async () => {
    const { db, repo } = await setup();
    await repo.createItem(
      {
        name: 'Bouteilles',
        category: 'water',
        unit: 'L',
        attributes: { potability: 'potable' },
      },
      { quantity: 12 },
    );
    await repo.createItem(
      { name: 'Ancien bidon', category: 'water', unit: 'L' },
      { quantity: 6 },
    );
    await repo.createItem(
      {
        name: 'Eau de pluie',
        category: 'water',
        unit: 'L',
        attributes: { potability: 'to_treat' },
      },
      { quantity: 50 },
    );
    await repo.createItem(
      {
        name: 'Baignoire',
        category: 'water',
        unit: 'L',
        attributes: { potability: 'not_potable' },
      },
      { quantity: 100 },
    );
    const stock = waterStock(await repo.listItems({ bag: 'none' }));
    expect(stock).toEqual({ potable: 18, other: 150 });
    const report = await getResilienceReport(db, TODAY);
    expect(report.water.available).toBe(18);
  });
});

describe('calculateur électrique', () => {
  const devices = [
    { name: 'Lampe LED', watts: 5, hoursPerDay: 4, quantity: 2 },
    { name: 'Box', watts: 12, hoursPerDay: 10, quantity: 1 },
  ];

  it('calcule Wh par jour, marge, rendement et puissance simultanée', () => {
    const r = computeElectric(devices, 20, 80, 600);
    expect(r.dailyWh).toBe(160);
    expect(r.capacityPerDay).toBeCloseTo(240);
    expect(r.simultaneousWatts).toBe(22);
    expect(r.days).toBe(2);
  });

  it('ne donne pas d’autonomie sans appareil ou sans énergie connue', () => {
    expect(computeElectric([], 20, 80, 600).days).toBeNull();
    expect(computeElectric(devices, 20, 80, 0).days).toBeNull();
  });

  it('lit les nombres saisis à la française', () => {
    expect(parseAmount('2,5')).toBe(2.5);
    expect(parseAmount(' 1 200 ')).toBe(1200);
    expect(parseAmount('-3')).toBeNull();
    expect(parseAmount('abc')).toBeNull();
    expect(parseAmount('')).toBeNull();
  });

  it('enregistre les appareils et ignore un réglage corrompu', async () => {
    const { db } = await setup();
    expect(await loadElectricSettings(db)).toEqual({
      devices: [],
      marginPct: MARGIN_DEFAULT,
      efficiencyPct: EFFICIENCY_DEFAULT,
    });
    await saveElectricSettings(db, {
      devices,
      marginPct: 10,
      efficiencyPct: 90,
    });
    expect(await loadElectricSettings(db)).toEqual({
      devices,
      marginPct: 10,
      efficiencyPct: 90,
    });
    await db.execute("UPDATE settings SET value = '{oops' WHERE key = ?", [
      'energy_devices',
    ]);
    expect((await loadElectricSettings(db)).devices).toEqual([]);
  });
});
