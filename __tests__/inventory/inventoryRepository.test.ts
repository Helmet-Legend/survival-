import { prepareDatabase } from '../../src/db/connection';
import type { SqlValue } from '../../src/db/types';
import {
  InventoryError,
  InventoryRepository,
  randomUuid,
  seedDecoyInventory,
  type ItemInput,
} from '../../src/inventory';
import { addDays } from '../../src/lib/dates';
import { getResilienceReport } from '../../src/resilience/resilienceCalculator';
import { SeededRandom } from '../crypto/fakes';
import { NodeSqliteDb } from '../db/sqlite';

const TODAY = '2026-10-15';
const in_ = (days: number) => addDays(TODAY, days);

const WATER: ItemInput = { name: 'Eau', category: 'water', unit: 'L' };
const RICE: ItemInput = {
  name: 'Riz',
  category: 'food',
  unit: 'kg',
  caloriesPerUnit: 3600,
};

async function setup() {
  const db = new NodeSqliteDb();
  await prepareDatabase(db);
  let seq = 0;
  const clock = { today: TODAY };
  const repo = new InventoryRepository(db, {
    newId: () => `id-${++seq}`,
    today: () => clock.today,
  });
  return { db, repo, clock };
}

async function count(db: NodeSqliteDb, table: string): Promise<number> {
  const { rows } = await db.execute(`SELECT count(*) AS n FROM ${table}`);
  return Number(rows[0].n);
}

async function expectInventoryError(
  promise: Promise<unknown>,
  expected: Partial<InventoryError>,
) {
  const error = await promise.then(
    () => {
      throw new Error('La promesse aurait dû échouer');
    },
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(InventoryError);
  expect(error).toMatchObject(expected);
}

describe('articles', () => {
  it('crée un article avec son premier lot', async () => {
    const { repo } = await setup();
    const item = await repo.createItem(
      { ...RICE, name: '  Riz basmati ', location: '  ', isCritical: true },
      { quantity: 2, expirationDate: in_(200) },
    );
    expect(item).toMatchObject({
      name: 'Riz basmati',
      location: null,
      isCritical: true,
      caloriesPerUnit: 3600,
    });

    const { lots } = await repo.getItem(item.id);
    expect(lots).toEqual([
      expect.objectContaining({
        quantity: 2,
        acquiredAt: TODAY,
        expirationDate: in_(200),
        isExpired: false,
      }),
    ]);
  });

  it.each<[string, Partial<ItemInput>, string]>([
    ['nom vide', { name: '   ' }, 'name'],
    ['nom trop long', { name: 'x'.repeat(121) }, 'name'],
    ['catégorie inconnue', { category: 'vehicle' as never }, 'category'],
    ['unité inconnue', { unit: 'gallon' as never }, 'unit'],
    ['eau en kg', { category: 'water', unit: 'kg' }, 'unit'],
    ['calories décimales', { caloriesPerUnit: 3.5 }, 'caloriesPerUnit'],
    ['calories négatives', { caloriesPerUnit: -1 }, 'caloriesPerUnit'],
  ])('refuse un article invalide (%s)', async (_, patch, field) => {
    const { db, repo } = await setup();
    await expectInventoryError(repo.createItem({ ...RICE, ...patch }), {
      code: 'VALIDATION',
      field,
    });
    expect(await count(db, 'inventory_items')).toBe(0);
  });

  it.each<[string, object, string]>([
    ['quantité nulle', { quantity: 0 }, 'quantity'],
    ['quantité négative', { quantity: -2 }, 'quantity'],
    ['quantité NaN', { quantity: NaN }, 'quantity'],
    [
      'date inexistante',
      { quantity: 1, expirationDate: '2026-02-30' },
      'expirationDate',
    ],
    [
      'date mal formée',
      { quantity: 1, acquiredAt: '15/10/2026' },
      'acquiredAt',
    ],
  ])(
    'refuse un lot invalide sans créer l’article (%s)',
    async (_, lot, field) => {
      const { db, repo } = await setup();
      await expectInventoryError(repo.createItem(RICE, lot as never), {
        code: 'VALIDATION',
        field,
      });
      expect(await count(db, 'inventory_items')).toBe(0);
    },
  );

  it('modifie un article en conservant les champs non fournis', async () => {
    const { repo } = await setup();
    const item = await repo.createItem({ ...RICE, notes: 'sac de 5 kg' });
    const updated = await repo.updateItem(item.id, { isCritical: true });
    expect(updated).toMatchObject({
      name: 'Riz',
      notes: 'sac de 5 kg',
      isCritical: true,
    });
    await expectInventoryError(
      repo.updateItem(item.id, { category: 'water' }),
      {
        field: 'unit',
      },
    );
  });

  it("refuse de changer l'unité d'un article qui a du stock", async () => {
    const { repo } = await setup();
    const withStock = await repo.createItem(RICE, { quantity: 2 });
    await expectInventoryError(repo.updateItem(withStock.id, { unit: 'g' }), {
      code: 'VALIDATION',
      field: 'unit',
    });

    const empty = await repo.createItem({ ...RICE, name: 'Lentilles' });
    expect((await repo.updateItem(empty.id, { unit: 'g' })).unit).toBe('g');
  });

  it('supprime un article avec ses lots', async () => {
    const { db, repo } = await setup();
    const item = await repo.createItem(RICE, { quantity: 2 });
    await repo.addLot(item.id, { quantity: 1 });
    await repo.deleteItem(item.id);
    expect(await count(db, 'inventory_lots')).toBe(0);
    await expectInventoryError(repo.getItem(item.id), { code: 'NOT_FOUND' });
    await expectInventoryError(repo.deleteItem(item.id), { code: 'NOT_FOUND' });
  });
});

describe('liste', () => {
  async function stocked() {
    const ctx = await setup();
    const water = await ctx.repo.createItem({ ...WATER, isCritical: true });
    await ctx.repo.addLot(water.id, { quantity: 10, expirationDate: in_(30) });
    await ctx.repo.addLot(water.id, { quantity: 6, expirationDate: in_(-2) });
    await ctx.repo.addLot(water.id, { quantity: 4, expirationDate: in_(10) });
    await ctx.repo.createItem(
      { name: 'Pâtes', category: 'food', unit: 'kg', caloriesPerUnit: 3500 },
      { quantity: 1.5 },
    );
    await ctx.repo.createItem({
      name: 'Bougies',
      category: 'energy',
      unit: 'unit',
    });
    return ctx;
  }

  it('calcule les totaux et la prochaine péremption, critiques en tête', async () => {
    const { repo } = await stocked();
    const items = await repo.listItems();
    expect(items.map(i => i.name)).toEqual(['Eau', 'Bougies', 'Pâtes']);
    expect(items[0]).toMatchObject({
      totalQuantity: 20,
      usableQuantity: 14,
      lotCount: 3,
      nextExpiration: in_(10),
    });
    expect(items[1]).toMatchObject({
      totalQuantity: 0,
      lotCount: 0,
      nextExpiration: null,
    });
    expect(items[2]).toMatchObject({
      usableQuantity: 1.5,
      nextExpiration: null,
    });
  });

  it('filtre par catégorie, criticité et texte (sans accents)', async () => {
    const { repo } = await stocked();
    expect(
      (await repo.listItems({ category: 'food' })).map(i => i.name),
    ).toEqual(['Pâtes']);
    expect(
      (await repo.listItems({ criticalOnly: true })).map(i => i.name),
    ).toEqual(['Eau']);
    expect((await repo.listItems({ query: 'PATES' })).map(i => i.name)).toEqual(
      ['Pâtes'],
    );
    expect(await repo.listItems({ query: 'xyz' })).toEqual([]);
  });
});

describe('consommation', () => {
  async function riceWithLots() {
    const ctx = await setup();
    const item = await ctx.repo.createItem(RICE);
    const lots = {
      later: await ctx.repo.addLot(item.id, {
        quantity: 2,
        expirationDate: in_(10),
      }),
      sooner: await ctx.repo.addLot(item.id, {
        quantity: 3,
        expirationDate: in_(5),
      }),
      forever: await ctx.repo.addLot(item.id, { quantity: 5 }),
      expired: await ctx.repo.addLot(item.id, {
        quantity: 1,
        expirationDate: in_(-1),
      }),
    };
    return { ...ctx, item, lots };
  }

  it('puise d’abord dans le lot qui périme le plus tôt (FEFO)', async () => {
    const { repo, item, lots } = await riceWithLots();
    const result = await repo.consume(item.id, 4);

    expect(result.taken).toEqual([
      { lotId: lots.sooner.id, quantity: 3, expirationDate: in_(5) },
      { lotId: lots.later.id, quantity: 1, expirationDate: in_(10) },
    ]);
    expect(result.remaining).toBe(6);

    const { lots: left } = await repo.getItem(item.id);
    expect(left.map(l => [l.id, l.quantity])).toEqual([
      [lots.expired.id, 1], // périmé : ignoré, conservé
      [lots.later.id, 1],
      [lots.forever.id, 5],
    ]);
  });

  it('départage deux lots de même péremption par ancienneté (FIFO)', async () => {
    const { repo } = await setup();
    const item = await repo.createItem(RICE);
    const recent = await repo.addLot(item.id, {
      quantity: 1,
      acquiredAt: in_(-1),
    });
    const old = await repo.addLot(item.id, {
      quantity: 1,
      acquiredAt: in_(-30),
    });
    const { taken } = await repo.consume(item.id, 1);
    expect(taken[0].lotId).toBe(old.id);
    expect((await repo.getItem(item.id)).lots.map(l => l.id)).toEqual([
      recent.id,
    ]);
  });

  it('refuse sans rien modifier si le stock utilisable est insuffisant', async () => {
    const { db, repo, item } = await riceWithLots();
    const before = await db.execute(
      'SELECT id, quantity FROM inventory_lots ORDER BY id',
    );

    await expectInventoryError(repo.consume(item.id, 10.5), {
      code: 'INSUFFICIENT_STOCK',
      available: 10, // le lot périmé ne compte pas
    });
    expect(
      await db.execute('SELECT id, quantity FROM inventory_lots ORDER BY id'),
    ).toEqual(before);
  });

  it('peut entamer les lots périmés sur demande, en commençant par eux', async () => {
    const { repo, item, lots } = await riceWithLots();
    const { taken } = await repo.consume(item.id, 11, { allowExpired: true });
    expect(taken[0].lotId).toBe(lots.expired.id);
    expect((await repo.getItem(item.id)).lots).toEqual([]);
  });

  it('ne laisse pas de reliquat flottant', async () => {
    const { db, repo } = await setup();
    const item = await repo.createItem(WATER);
    await repo.addLot(item.id, { quantity: 0.1 });
    await repo.addLot(item.id, { quantity: 0.2 });
    const result = await repo.consume(item.id, 0.3);
    expect(result.remaining).toBe(0);
    expect(await count(db, 'inventory_lots')).toBe(0);
  });

  it('annule tout si une écriture échoue en cours de route', async () => {
    const { db, repo, item } = await riceWithLots();
    const before = await db.execute(
      'SELECT id, quantity FROM inventory_lots ORDER BY id',
    );
    const execute = db.execute.bind(db);
    jest
      .spyOn(db, 'execute')
      .mockImplementation(async (sql: string, params?: SqlValue[]) => {
        if (sql.startsWith('UPDATE inventory_lots SET quantity')) {
          throw new Error('disque plein');
        }
        return execute(sql, params);
      });

    // Vide le premier lot (DELETE), puis échoue sur l'UPDATE du second.
    await expect(repo.consume(item.id, 4)).rejects.toThrow('disque plein');
    jest.restoreAllMocks();
    expect(
      await db.execute('SELECT id, quantity FROM inventory_lots ORDER BY id'),
    ).toEqual(before);
  });

  it('refuse une quantité invalide ou un article inconnu', async () => {
    const { repo, item } = await riceWithLots();
    await expectInventoryError(repo.consume(item.id, 0), {
      code: 'VALIDATION',
    });
    await expectInventoryError(repo.consume('nope', 1), { code: 'NOT_FOUND' });
  });

  it('met à jour le calcul d’autonomie', async () => {
    const { db, repo } = await setup();
    const water = await repo.createItem(WATER, { quantity: 30 });
    expect((await getResilienceReport(db, TODAY)).water.days).toBe(10);
    await repo.consume(water.id, 12);
    expect((await getResilienceReport(db, TODAY)).water.days).toBe(6);
  });
});

describe('lots', () => {
  it('corrige un lot, et le supprime à quantité nulle', async () => {
    const { repo } = await setup();
    const item = await repo.createItem(RICE);
    const lot = await repo.addLot(item.id, {
      quantity: 2,
      expirationDate: in_(5),
    });

    expect(await repo.updateLot(lot.id, { quantity: 1.5 })).toMatchObject({
      quantity: 1.5,
      expirationDate: in_(5),
    });
    expect(
      await repo.updateLot(lot.id, { expirationDate: null }),
    ).toMatchObject({
      expirationDate: null,
    });
    expect(await repo.updateLot(lot.id, { quantity: 0 })).toBeNull();
    await expectInventoryError(repo.deleteLot(lot.id), { code: 'NOT_FOUND' });
  });

  it('refuse un lot pour un article inconnu', async () => {
    const { repo } = await setup();
    await expectInventoryError(repo.addLot('nope', { quantity: 1 }), {
      code: 'NOT_FOUND',
    });
  });

  it('jette les périmés, pas les lots qui périment aujourd’hui', async () => {
    const { repo, clock } = await setup();
    const item = await repo.createItem(RICE);
    const old = await repo.addLot(item.id, {
      quantity: 1,
      expirationDate: in_(-3),
    });
    const today = await repo.addLot(item.id, {
      quantity: 1,
      expirationDate: TODAY,
    });
    await repo.addLot(item.id, { quantity: 1 });

    const removed = await repo.discardExpired();
    expect(removed.map(l => l.id)).toEqual([old.id]);
    expect((await repo.getItem(item.id)).lots.map(l => l.id)).toContain(
      today.id,
    );

    clock.today = in_(1);
    expect((await repo.discardExpired()).map(l => l.id)).toEqual([today.id]);
  });
});

describe('identifiants', () => {
  it('génère des UUID v4 uniques', () => {
    const ids = new Set(Array.from({ length: 500 }, () => randomUuid()));
    expect(ids.size).toBe(500);
    for (const id of ids) {
      expect(id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
    }
  });
});

describe('leurre', () => {
  it('remplit un inventaire crédible, différent selon l’installation', async () => {
    const seeded = async (seed: number) => {
      const db = new NodeSqliteDb();
      await prepareDatabase(db);
      await seedDecoyInventory(db, {
        today: TODAY,
        random: new SeededRandom(seed),
      });
      return db;
    };
    const a = await seeded(1);
    const b = await seeded(2);

    expect(await count(a, 'inventory_items')).toBe(9);
    const lotsA = await a.execute(
      'SELECT quantity, expiration_date FROM inventory_lots ORDER BY rowid',
    );
    const lotsB = await b.execute(
      'SELECT quantity, expiration_date FROM inventory_lots ORDER BY rowid',
    );
    expect(lotsA).not.toEqual(lotsB);
    // Rien de périmé, et quelques jours d'autonomie : un foyer ordinaire.
    for (const row of lotsA.rows) {
      if (row.expiration_date !== null) {
        expect(String(row.expiration_date) > TODAY).toBe(true);
      }
    }
    const report = await getResilienceReport(a, TODAY);
    expect(report.days).toBeGreaterThan(0);
    expect(report.days).toBeLessThan(30);
  });
});
