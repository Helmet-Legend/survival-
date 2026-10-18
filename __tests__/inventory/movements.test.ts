import { prepareDatabase } from '../../src/db/connection';
import { InventoryRepository, type StockMovement } from '../../src/inventory';
import { NodeSqliteDb } from '../db/sqlite';

let today = '2026-10-15';

async function setup() {
  const db = new NodeSqliteDb();
  await prepareDatabase(db);
  return { db, repo: new InventoryRepository(db, { today: () => today }) };
}

const summary = (list: StockMovement[]) =>
  list.map(m => [m.kind, m.quantity, m.origin, m.itemName]);

describe('historique des mouvements', () => {
  beforeEach(() => {
    today = '2026-10-15';
  });

  it('enregistre entrées, retraits, corrections et périmés jetés', async () => {
    const { repo } = await setup();
    const rice = await repo.createItem(
      { name: 'Riz', category: 'food', unit: 'kg' },
      { quantity: 5 },
    );
    const lot = await repo.addLot(
      rice.id,
      { quantity: 2, expirationDate: '2026-10-20' },
      { origin: 'scan' },
    );
    // FEFO : le lot qui périme le 20 passe de 2 à 0,5.
    await repo.consume(rice.id, 1.5, { origin: 'scan' });
    await repo.updateLot(lot.id, { quantity: 1 });
    today = '2026-11-01';
    await repo.discardExpired();
    expect(summary(await repo.listMovements())).toEqual([
      ['discard', -1, 'manual', 'Riz'],
      ['correct', 0.5, 'manual', 'Riz'],
      ['out', -1.5, 'scan', 'Riz'],
      ['in', 2, 'scan', 'Riz'],
      ['in', 5, 'form', 'Riz'],
    ]);
    expect(
      summary(await repo.listMovements({ direction: 'in', limit: 2 })),
    ).toEqual([
      ['correct', 0.5, 'manual', 'Riz'],
      ['in', 2, 'scan', 'Riz'],
    ]);
    expect(
      (await repo.listMovements({ direction: 'out' })).map(m => m.kind),
    ).toEqual(['discard', 'out']);
  });

  it('garde l’historique lisible après suppression de l’article', async () => {
    const { repo } = await setup();
    const water = await repo.createItem(
      { name: 'Bidons', category: 'water', unit: 'L' },
      { quantity: 20 },
    );
    const extra = await repo.addLot(water.id, { quantity: 5 });
    await repo.deleteLot(extra.id);
    await repo.deleteItem(water.id);
    const list = await repo.listMovements();
    expect(summary(list)).toEqual([
      ['deleted', -20, 'manual', 'Bidons'],
      ['correct', -5, 'manual', 'Bidons'],
      ['in', 5, 'manual', 'Bidons'],
      ['in', 20, 'form', 'Bidons'],
    ]);
    expect(list.every(m => m.itemId === null && m.unit === 'L')).toBe(true);
  });

  it('n’enregistre rien quand un retrait échoue ou qu’un article est vide', async () => {
    const { repo } = await setup();
    const item = await repo.createItem({
      name: 'Piles',
      category: 'power',
      unit: 'unit',
    });
    await expect(repo.consume(item.id, 1)).rejects.toThrow(/insuffisant/);
    await repo.deleteItem(item.id);
    expect(await repo.listMovements()).toEqual([]);
  });

  it('filtre par article', async () => {
    const { repo } = await setup();
    const a = await repo.createItem(
      { name: 'A', category: 'food', unit: 'unit' },
      { quantity: 1 },
    );
    await repo.createItem(
      { name: 'B', category: 'food', unit: 'unit' },
      { quantity: 1 },
    );
    expect(
      (await repo.listMovements({ itemId: a.id })).map(m => m.itemName),
    ).toEqual(['A']);
  });
});
