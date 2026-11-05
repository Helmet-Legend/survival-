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

describe('annuler un retrait', () => {
  beforeEach(() => {
    today = '2026-10-15';
  });

  it('remet chaque lot tel qu’il était et efface le retrait de l’historique', async () => {
    const { db, repo } = await setup();
    const rice = await repo.createItem(
      { name: 'Riz', category: 'food', unit: 'kg' },
      { quantity: 1, expirationDate: '2026-10-20' },
    );
    await repo.addLot(rice.id, { quantity: 4, expirationDate: '2026-12-01' });
    const lotsBefore = await db.execute(
      `SELECT id, quantity, acquired_at, expiration_date, box_id, created_at
         FROM inventory_lots ORDER BY id`,
    );

    // Vide le premier lot (supprimé) et entame le second.
    const result = await repo.consume(rice.id, 2.5);
    expect(result.remaining).toBe(2.5);
    expect(await repo.undoConsume(result.undo)).toBe(5);

    expect(
      await db.execute(
        `SELECT id, quantity, acquired_at, expiration_date, box_id, created_at
           FROM inventory_lots ORDER BY id`,
      ),
    ).toEqual(lotsBefore);
    expect(summary(await repo.listMovements())).toEqual([
      ['in', 4, 'manual', 'Riz'],
      ['in', 1, 'form', 'Riz'],
    ]);
  });

  it('garde la boîte d’un lot vidé puis recréé', async () => {
    const { db, repo } = await setup();
    await db.execute("INSERT INTO boxes (id, label_no) VALUES ('boite-1', 1)");
    const water = await repo.createItem(
      { name: 'Eau', category: 'water', unit: 'L' },
      { quantity: 6 },
    );
    await db.execute("UPDATE inventory_lots SET box_id = 'boite-1'");
    const result = await repo.consume(water.id, 6);
    expect((await repo.getItem(water.id)).lots).toEqual([]);
    await repo.undoConsume(result.undo);
    const { rows } = await db.execute(
      'SELECT quantity, box_id FROM inventory_lots',
    );
    expect(rows).toEqual([{ quantity: 6, box_id: 'boite-1' }]);
  });

  it('s’ajoute à un lot modifié entre-temps', async () => {
    const { repo } = await setup();
    const rice = await repo.createItem(
      { name: 'Riz', category: 'food', unit: 'kg' },
      { quantity: 5 },
    );
    const result = await repo.consume(rice.id, 2);
    await repo.consume(rice.id, 1);
    expect(await repo.undoConsume(result.undo)).toBe(4);
  });
});

describe('filtres de l’historique', () => {
  it('filtre par date et par nom d’article, sans tenir compte des accents', async () => {
    const { db, repo } = await setup();
    await repo.createItem(
      { name: 'Pâtes', category: 'food', unit: 'kg' },
      { quantity: 2 },
    );
    await repo.createItem(
      { name: 'Eau', category: 'water', unit: 'L' },
      { quantity: 10 },
    );
    // Le premier ajout date du mois dernier.
    await db.execute(
      `UPDATE stock_movements SET created_at = '2026-09-01T10:00:00.000Z'
        WHERE item_name = 'Pâtes'`,
    );

    expect(
      (await repo.listMovements({ query: 'pates' })).map(m => m.itemName),
    ).toEqual(['Pâtes']);
    expect(
      (await repo.listMovements({ since: '2026-10-01T00:00:00.000Z' })).map(
        m => m.itemName,
      ),
    ).toEqual(['Eau']);
    expect(
      await repo.listMovements({
        query: 'PÂTES',
        since: '2026-10-01T00:00:00.000Z',
      }),
    ).toEqual([]);
  });
});
