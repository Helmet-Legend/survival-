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

describe('estimation dans le calcul d’autonomie', () => {
  it('compte les vivres sans kcal saisies, sans écraser une étiquette', async () => {
    const db = new NodeSqliteDb();
    await prepareDatabase(db);
    const repo = new InventoryRepository(db);
    await repo.createItem(
      { name: 'Riz basmati', category: 'food', unit: 'kg' },
      { quantity: 2 },
    ); // estimé : 2 × 3 550
    await repo.createItem(
      { name: 'Pâtes', category: 'food', unit: 'kg', caloriesPerUnit: 3000 },
      { quantity: 1 },
    ); // étiquette saisie : 3 000
    await repo.createItem(
      {
        name: 'Plat du chef',
        category: 'food',
        unit: 'unit',
        subtype: 'canned',
      },
      { quantity: 3 },
    ); // conserve : 3 × 400
    await repo.createItem(
      { name: 'Sac mystère', category: 'food', unit: 'kg' },
      { quantity: 5 },
    ); // inconnu : 0

    const report = await getResilienceReport(db, '2026-10-15');
    expect(report.food.available).toBe(7100 + 3000 + 1200);
  });
});
