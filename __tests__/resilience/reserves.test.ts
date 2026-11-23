import { prepareDatabase } from '../../src/db/connection';
import { InventoryRepository } from '../../src/inventory';
import {
  computeFuels,
  computeWaterTreatment,
  defaultDailyUse,
  WATER_TREATMENT_SUBTYPE,
} from '../../src/resilience/reserves';
import { rawWaterLiters } from '../../src/resilience/resilienceCalculator';
import { reserveLines } from '../../src/ui/screens/HomeScreen';
import { NodeSqliteDb } from '../db/sqlite';

const TODAY = '2026-11-23';

async function setup() {
  const db = new NodeSqliteDb();
  await prepareDatabase(db);
  return { db, repo: new InventoryRepository(db, { today: () => TODAY }) };
}

describe('eau traitable', () => {
  it('rend potable l’eau à traiter, dans la limite du filtre', async () => {
    const { db, repo } = await setup();
    await repo.createItem(
      {
        name: 'Cuve de pluie',
        category: 'water',
        unit: 'L',
        attributes: { potability: 'to_treat' },
      },
      { quantity: 300 },
    );
    await repo.createItem(
      {
        name: 'Gourde filtrante',
        category: 'energy',
        unit: 'unit',
        subtype: WATER_TREATMENT_SUBTYPE,
        attributes: { capacityValue: 100, capacityUnit: 'L' },
      },
      { quantity: 2 },
    );
    await repo.createItem(
      {
        name: 'Pastilles',
        category: 'energy',
        unit: 'unit',
        subtype: WATER_TREATMENT_SUBTYPE,
      },
      { quantity: 1 },
    );
    const items = await repo.listItems({ bag: 'none' });
    const raw = await rawWaterLiters(db);
    expect(raw).toBe(300);
    const report = computeWaterTreatment(items, raw, 9);
    // 2 gourdes de 100 L : 200 L traitables sur 300 → 22 jours à 9 L.
    expect(report).toMatchObject({
      capacityLiters: 200,
      treatableLiters: 200,
      extraDays: 22,
      limitedBy: 'capacity',
      unknown: ['Pastilles'],
      hasTreatment: true,
    });
    // Peu d'eau à traiter : c'est elle qui limite.
    expect(computeWaterTreatment(items, 45, 9)).toMatchObject({
      treatableLiters: 45,
      extraDays: 5,
      limitedBy: 'water',
    });
  });

  it('ne compte rien sans filtre ni pastilles', async () => {
    const { repo } = await setup();
    const report = computeWaterTreatment(
      await repo.listItems({ bag: 'none' }),
      300,
      9,
    );
    expect(report).toMatchObject({ extraDays: 0, hasTreatment: false });
  });
});

describe('chauffage et cuisson', () => {
  it('convertit bois, charbon et gaz en jours, cuisson par personne', async () => {
    const { repo } = await setup();
    await repo.createItem(
      {
        name: 'Bois de chauffage',
        category: 'power',
        unit: 'kg',
        subtype: 'wood',
      },
      { quantity: 900 },
    );
    await repo.createItem(
      {
        name: 'Charbon de bois',
        category: 'power',
        unit: 'kg',
        subtype: 'wood',
      },
      { quantity: 10 },
    );
    await repo.createItem(
      {
        name: 'Bouteille de gaz',
        category: 'power',
        unit: 'unit',
        subtype: 'gas',
        attributes: { capacityValue: 13, capacityUnit: 'kg', dailyUse: 0.13 },
      },
      { quantity: 1 },
    );
    const report = computeFuels(await repo.listItems({ bag: 'none' }), 3);
    // Bois : 900 kg ÷ 12 kg/j (logement) = 75 j.
    expect(report.heatingDays).toBe(75);
    // Charbon : 10 ÷ (0,2 × 3) = 16,7 j ; gaz : 13 ÷ (0,13 × 3) = 33,3 j.
    expect(report.cookingDays).toBe(50);
    const gas = report.lines.find(l => l.name === 'Bouteille de gaz');
    expect(gas).toMatchObject({ use: 'cooking', defaulted: false });
    expect(gas?.perDay).toBeCloseTo(0.39);
    expect(report.unknown).toEqual([]);
  });

  it('respecte l’usage choisi et signale une quantité inconvertible', async () => {
    const { repo } = await setup();
    await repo.createItem(
      {
        name: 'Bois',
        category: 'power',
        unit: 'kg',
        subtype: 'wood',
        attributes: { fuelUse: 'cooking', dailyUse: 1 },
      },
      { quantity: 20 },
    );
    await repo.createItem(
      { name: 'Cartouches', category: 'power', unit: 'unit', subtype: 'gas' },
      { quantity: 4 },
    );
    const report = computeFuels(await repo.listItems({ bag: 'none' }), 2);
    expect(report.heatingDays).toBeNull();
    expect(report.cookingDays).toBe(10);
    expect(report.unknown).toEqual(['Cartouches']);
  });

  it('propose des consommations prudentes', () => {
    expect(defaultDailyUse('wood', 'heating')).toBe(12);
    expect(defaultDailyUse('wood', 'cooking', true)).toBe(0.2);
    expect(defaultDailyUse('gas', 'cooking')).toBe(0.1);
    expect(defaultDailyUse('fuel', 'heating')).toBe(2);
  });
});

describe('lignes de l’accueil', () => {
  it('n’ajoute rien sans filtre ni combustible', () => {
    expect(
      reserveLines(computeWaterTreatment([], 300, 9), computeFuels([], 3)),
    ).toEqual([]);
  });
});
