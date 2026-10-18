import { prepareDatabase } from '../../src/db/connection';
import { BagRepository, InventoryRepository } from '../../src/inventory';
import { getPreparation, setMark } from '../../src/plan/preparation';
import { NodeSqliteDb } from '../db/sqlite';

const TODAY = '2026-10-15';

async function setup() {
  const db = new NodeSqliteDb();
  await prepareDatabase(db);
  const repo = new InventoryRepository(db, { today: () => TODAY });
  const bags = new BagRepository(db, { today: () => TODAY });
  return { db, repo, bags };
}

const byId = (report: Awaited<ReturnType<typeof getPreparation>>) =>
  Object.fromEntries(report.results.map(r => [r.definition.id, r]));

describe('préparation par paliers', () => {
  it('coche le kit de la maison d’après le stock et le palier', async () => {
    const { db, repo } = await setup();
    // 1 personne, 3 L par jour par défaut : 12 L = 4 jours d'eau.
    await repo.createItem(
      { name: 'Eau', category: 'water', unit: 'L' },
      { quantity: 12 },
    );
    await repo.createItem(
      {
        name: 'Lampe frontale',
        category: 'energy',
        unit: 'unit',
        subtype: 'lighting',
      },
      { quantity: 1 },
    );
    // Reconnue par son nom, sans type.
    await repo.createItem(
      { name: 'Radio Sangean', category: 'energy', unit: 'unit' },
      { quantity: 1 },
    );
    // Périmé : ne compte pas.
    await repo.createItem(
      {
        name: 'Doliprane',
        category: 'medical',
        unit: 'unit',
        subtype: 'medicine',
      },
      { quantity: 8, expirationDate: '2026-01-01', acquiredAt: '2025-01-01' },
    );
    const items = await repo.listItems({ bag: 'none' });
    const report = async (tier: 2 | 3 | 7 | 10) =>
      byId(
        await getPreparation(db, {
          scope: 'home',
          tier,
          items,
          documentCount: 0,
          asOf: TODAY,
        }),
      );

    const r3 = await report(3);
    expect(r3.water.done).toBe(true);
    expect(r3.water.detail).toBe('4 j sur 3');
    expect(r3.food.done).toBe(false);
    expect(r3.light.done).toBe(true);
    expect(r3.radio.detail).toBe('Radio Sangean');
    expect(r3.medicine.done).toBe(false);
    expect(r3.documents.done).toBe(false);
    expect(r3.documents_copy).toBeUndefined();
    expect((await report(7)).water.done).toBe(false);

    await setMark(db, 'home', 'cash', true);
    expect((await report(3)).cash.done).toBe(true);
    await setMark(db, 'home', 'cash', false);
    expect((await report(3)).cash.done).toBe(false);
  });

  it('vérifie un sac sur 72 h pour une personne, avec son seul contenu', async () => {
    const { db, repo, bags } = await setup();
    const bag = await bags.create({ name: 'Sac Léa' });
    await repo.createItem(
      { name: 'Eau', category: 'water', unit: 'L', bagId: bag.id },
      { quantity: 9 },
    );
    // Lampe à la maison, pas dans le sac.
    await repo.createItem(
      { name: 'Lampe', category: 'energy', unit: 'unit', subtype: 'lighting' },
      { quantity: 1 },
    );
    const result = byId(
      await getPreparation(db, {
        scope: bag.id,
        tier: 10,
        items: await repo.listItems({ bag: bag.id }),
        documentCount: 3,
        asOf: TODAY,
      }),
    );
    expect(result.water.detail).toBe('3 j sur 3');
    expect(result.water.done).toBe(true);
    expect(result.light.done).toBe(false);
    expect(result.documents).toBeUndefined();
    expect(result.documents_copy.done).toBe(false);
  });
});
