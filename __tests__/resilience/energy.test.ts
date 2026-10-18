import { prepareDatabase } from '../../src/db/connection';
import { InventoryRepository } from '../../src/inventory';
import {
  computeEnergy,
  ENERGY_NEED_DEFAULT,
  loadEnergyNeed,
  saveEnergyNeed,
} from '../../src/resilience/energy';
import { SCENARIOS } from '../../src/resilience/scenarios';
import { NodeSqliteDb } from '../db/sqlite';

const TODAY = '2026-10-15';

async function setup() {
  const db = new NodeSqliteDb();
  await prepareDatabase(db);
  return { db, repo: new InventoryRepository(db, { today: () => TODAY }) };
}

describe('réserves d’énergie', () => {
  it('compte les Wh connus, après pertes, sans deviner les capacités', async () => {
    const { repo } = await setup();
    // 2 batteries externes de 20 000 mAh : 2 × 74 Wh = 148 Wh, 118,4 utiles.
    await repo.createItem(
      {
        name: 'Batterie externe',
        category: 'power',
        unit: 'unit',
        subtype: 'powerbank',
        attributes: { capacityValue: 20000, capacityUnit: 'mAh' },
      },
      { quantity: 2 },
    );
    // Piles en mAh : tension inconnue, non comptées.
    await repo.createItem(
      {
        name: 'Piles AA',
        category: 'power',
        unit: 'unit',
        subtype: 'battery',
        attributes: { capacityValue: 2500, capacityUnit: 'mAh' },
      },
      { quantity: 8 },
    );
    await repo.createItem(
      { name: 'Gaz', category: 'power', unit: 'unit', subtype: 'gas' },
      { quantity: 3 },
    );
    await repo.createItem(
      {
        name: 'Frontale',
        category: 'energy',
        unit: 'unit',
        subtype: 'lighting',
      },
      { quantity: 2 },
    );
    const items = await repo.listItems({ bag: 'none' });
    const report = computeEnergy(items, 2, 15);
    expect(report.storedWh).toBeCloseTo(148);
    expect(report.usableWh).toBeCloseTo(118.4);
    expect(report.dailyNeed).toBe(30);
    expect(report.days).toBe(3);
    expect(report.unknown).toEqual(['Piles AA']);
    expect(report.fuels).toEqual([{ name: 'Gaz', quantity: 3, unit: 'unit' }]);
    expect(report.lights).toBe(2);
  });

  it('ne donne pas de jours sans aucune capacité connue', () => {
    expect(computeEnergy([], 3, 15).days).toBeNull();
  });

  it('garde le besoin quotidien choisi', async () => {
    const { db } = await setup();
    expect(await loadEnergyNeed(db)).toBe(ENERGY_NEED_DEFAULT);
    await saveEnergyNeed(db, 20);
    expect(await loadEnergyNeed(db)).toBe(20);
  });
});

describe('scénarios de consommation', () => {
  const base = {
    members: 2,
    waterLitersPerPersonDay: 2,
    kcalPerPersonDay: 2000,
  };
  const scenario = (id: string) => SCENARIOS.find(s => s.id === id)!;

  it('modifie les besoins sans toucher aux réglages', () => {
    expect(scenario('normal').apply(base)).toEqual(base);
    expect(scenario('heat').apply(base).waterLitersPerPersonDay).toBe(3);
    expect(scenario('effort').apply(base)).toEqual({
      members: 2,
      waterLitersPerPersonDay: 3,
      kcalPerPersonDay: 2500,
    });
    expect(scenario('guests').apply(base).members).toBe(4);
    expect(scenario('blackout').energyFactor).toBe(2);
    expect(base.waterLitersPerPersonDay).toBe(2);
  });
});
