import { prepareDatabase } from '../../src/db/connection';
import { InventoryRepository } from '../../src/inventory';
import { estimateKcal } from '../../src/resilience/kcalEstimate';
import { getResilienceReport } from '../../src/resilience/resilienceCalculator';
import { NodeSqliteDb } from '../db/sqlite';

describe('estimateKcal', () => {
  it.each([
    ['Riz basmati', 'kg', 3550, 'riz'],
    ['Pâtes complètes', 'kg', 3550, 'pâtes'],
    ['Pâté de campagne', 'g', 3, 'pâté'],
    ['Lentilles corail', 'kg', 3300, 'lentilles sèches'],
    ['Huile d’olive', 'kg', 9000, 'huile'],
    ['Beurre de cacahuète', 'kg', 6000, 'beurre de cacahuète'],
    ['Sardines à l’huile', 'unit', 253, 'sardines à l’huile'],
    ['Haricots verts', 'unit', 200, 'haricots verts'],
    ['Haricots rouges secs', 'kg', 3300, 'haricots secs'],
    ['Barres céréales', 'unit', 200, 'barre énergétique'],
  ] as const)('%s (%s) → %d kcal', (name, unit, kcal, basis) => {
    expect(estimateKcal(name, unit)).toEqual({ kcalPerUnit: kcal, basis });
  });

  it('se rabat sur le type de vivres', () => {
    expect(estimateKcal('Plat du chef', 'unit', 'canned')).toEqual({
      kcalPerUnit: 400,
      basis: 'conserve',
    });
    expect(estimateKcal('Mélange maison', 'kg', 'dry')).toEqual({
      kcalPerUnit: 3500,
      basis: 'épicerie sèche',
    });
  });

  it('ne devine rien sans indice', () => {
    expect(estimateKcal('Sac du grenier', 'kg')).toBeNull();
    // Mots courts : mot entier seulement.
    expect(estimateKcal('Maison', 'kg')).toBeNull();
    expect(estimateKcal('Laitue', 'kg')).toBeNull();
    // Pièce sans poids connu : pas d'estimation hasardeuse.
    expect(estimateKcal('Riz', 'unit')).toBeNull();
  });
});

describe('calories dans le calcul d’autonomie', () => {
  it('compte seulement les données saisies, jamais une estimation', async () => {
    const db = new NodeSqliteDb();
    await prepareDatabase(db);
    const repo = new InventoryRepository(db);
    await repo.createItem(
      { name: 'Riz basmati', category: 'food', unit: 'kg' },
      { quantity: 2 },
    ); // reconnu par l'estimateur, mais rien n'est saisi : 0
    await repo.createItem(
      { name: 'Pâtes', category: 'food', unit: 'kg', caloriesPerUnit: 3000 },
      { quantity: 1 },
    ); // kcal par kg saisies : 3 000
    await repo.createItem(
      {
        name: 'Lentilles',
        category: 'food',
        unit: 'g',
        attributes: { energyValue: 330, energyBasis: 'per100g' },
      },
      { quantity: 500 },
    ); // 500 g à 330 kcal/100 g : 1 650
    await repo.createItem(
      {
        name: 'Cassoulet',
        category: 'food',
        unit: 'unit',
        attributes: {
          countUnit: 'box',
          unitWeight: 840,
          unitWeightUnit: 'g',
          energyValue: 125,
          energyBasis: 'per100g',
        },
      },
      { quantity: 2 },
    ); // 2 boîtes de 840 g à 125 kcal/100 g : 2 100
    await repo.createItem(
      {
        name: 'Ration',
        category: 'food',
        unit: 'unit',
        attributes: {
          countUnit: 'portion',
          energyValue: 600,
          energyBasis: 'perPortion',
        },
      },
      { quantity: 3 },
    ); // 3 portions à 600 kcal : 1 800
    await repo.createItem(
      {
        name: 'Conserve',
        category: 'food',
        unit: 'unit',
        attributes: { energyValue: 125, energyBasis: 'per100g' },
      },
      { quantity: 4 },
    ); // poids inconnu : 0 (données incomplètes)

    const report = await getResilienceReport(db, '2026-10-15');
    expect(report.food.available).toBe(3000 + 1650 + 2100 + 1800);
  });
});
