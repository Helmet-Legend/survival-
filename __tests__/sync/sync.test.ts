import { prepareDatabase } from '../../src/db/connection';
import type { SqlDatabase } from '../../src/db/types';
import {
  ArmoryRepository,
  BagRepository,
  InventoryRepository,
  PhotoRepository,
} from '../../src/inventory';
import {
  loadHousehold,
  saveHousehold,
} from '../../src/resilience/resilienceCalculator';
import {
  applyRemoteChanges,
  countPendingChanges,
  decodeHlc,
  encodeHlc,
  exportChanges,
  getDeviceId,
  getPeerClock,
  mergeSyncData,
  receive,
  rowId,
  SHARED_TABLES,
  SyncError,
  tick,
  type SyncOptions,
  type SyncPayload,
  type SyncRow,
} from '../../src/sync';
import { NodeSqliteDb } from '../db/sqlite';

const TODAY = '2026-10-21';
const NONE: SyncOptions = { weapons: false, photos: false };
const ALL: SyncOptions = { weapons: true, photos: true };
// 1 × 1 pixel PNG.
const PIXEL = 'iVBORw0KGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

async function phone(prefix: string) {
  const db = new NodeSqliteDb();
  await prepareDatabase(db);
  let n = 0;
  const newId = () => `${prefix}-${String(++n).padStart(6, '0')}`;
  const today = () => TODAY;
  return {
    db,
    repo: new InventoryRepository(db, { newId, today }),
    armory: new ArmoryRepository(db, { newId, today }),
    bags: new BagRepository(db, { newId }),
    photos: new PhotoRepository(db, { newId }),
  };
}

/** Un échange complet dans les deux sens, comme le fera le transport. */
async function exchange(
  a: SqlDatabase,
  b: SqlDatabase,
  options: SyncOptions = NONE,
) {
  const [idA, idB] = [await getDeviceId(a), await getDeviceId(b)];
  const pa = await exportChanges(a, options, await getPeerClock(b, idA));
  const pb = await exportChanges(b, options, await getPeerClock(a, idB));
  // Passage par JSON : ce qui transitera réellement.
  const toA = await applyRemoteChanges(a, JSON.parse(JSON.stringify(pb)), {
    ...options,
    sent: pa,
  });
  const toB = await applyRemoteChanges(b, JSON.parse(JSON.stringify(pa)), {
    ...options,
    sent: pb,
  });
  return { toA, toB, pa, pb };
}

async function quantities(repo: InventoryRepository) {
  const items = await repo.listItems();
  return new Map(items.map(i => [i.name, i.totalQuantity]));
}

const pause = () => new Promise(resolve => setTimeout(resolve, 5));

async function count(db: SqlDatabase, table: string) {
  const { rows } = await db.execute(`SELECT count(*) AS n FROM ${table}`);
  return Number(rows[0].n);
}

describe('horloge logique hybride', () => {
  it('avance même si l’horloge du téléphone recule', () => {
    const a = tick(null, 1000, 'a');
    const b = tick(a, 900, 'a');
    expect(encodeHlc(b) > encodeHlc(a)).toBe(true);
    expect(b).toEqual({ wall: 1000, counter: 1, node: 'a' });
  });

  it('se cale sur une horloge reçue plus avancée', () => {
    const local = tick(null, 1000, 'a');
    const after = tick(
      receive(local, { wall: 5000, counter: 3, node: 'b' }, 'a'),
      1200,
      'a',
    );
    expect(after).toEqual({ wall: 5000, counter: 4, node: 'a' });
  });

  it('se relit à l’identique et trie dans l’ordre du temps', () => {
    const h = { wall: 1761000000000, counter: 7, node: '0af3' };
    expect(decodeHlc(encodeHlc(h))).toEqual(h);
    expect(encodeHlc({ ...h, wall: 9 }) < encodeHlc(h)).toBe(true);
    expect(decodeHlc('1:2:x')).toBeNull();
  });
});

describe('mergeSyncData', () => {
  const row = (over: Partial<SyncRow>): SyncRow => ({
    table: 'inventory_items',
    key: 'i1',
    hlc: encodeHlc({ wall: 1, counter: 0, node: 'a' }),
    deleted: false,
    weapon: false,
    base: null,
    data: { id: 'i1', name: 'Eau' },
    ...over,
  });
  const h = (wall: number, node = 'a') => encodeHlc({ wall, counter: 0, node });
  const local = (r: SyncRow) => new Map([[rowId(r.table, r.key), r]]);

  it('garde la modification la plus récente, sans doublon', () => {
    const mine = row({ hlc: h(10), data: { id: 'i1', name: 'Eau' } });
    const theirs = row({
      hlc: h(20, 'b'),
      data: { id: 'i1', name: 'Eau minérale' },
    });
    const plan = mergeSyncData(local(mine), [
      theirs,
      { ...theirs, hlc: h(15, 'b') },
    ]);
    expect(plan.write).toHaveLength(1);
    expect(plan.write[0].data?.name).toBe('Eau minérale');
    expect(mergeSyncData(local(theirs), [mine]).write).toHaveLength(0);
  });

  it('une suppression plus récente l’emporte', () => {
    const plan = mergeSyncData(local(row({ hlc: h(10) })), [
      row({ hlc: h(20, 'b'), deleted: true, data: null }),
    ]);
    expect(plan.remove).toHaveLength(1);
  });

  it('additionne les variations d’un lot depuis la même base', () => {
    const lot = (q: number, hlc: string) =>
      row({
        table: 'inventory_lots',
        key: 'l1',
        hlc,
        base: 30,
        data: { id: 'l1', item_id: 'i1', quantity: q },
      });
    const plan = mergeSyncData(local(lot(28, h(10))), [lot(27, h(20, 'b'))]);
    expect(plan.write[0].data?.quantity).toBe(25);
    expect(plan.write[0].base).toBe(25);
    expect(plan.summed).toBe(1);
  });

  it('un lot vidé d’un côté et entamé de l’autre disparaît', () => {
    const plan = mergeSyncData(
      local(
        row({
          table: 'inventory_lots',
          key: 'l1',
          hlc: h(10),
          base: 5,
          data: { id: 'l1', quantity: 4 },
        }),
      ),
      [
        row({
          table: 'inventory_lots',
          key: 'l1',
          hlc: h(20, 'b'),
          base: 5,
          deleted: true,
          data: null,
        }),
      ],
    );
    expect(plan.write).toHaveLength(0);
    expect(plan.remove).toHaveLength(1);
  });
});

describe('synchronisation entre deux téléphones', () => {
  it('chaque table partagée a ses triggers de synchronisation', async () => {
    const { db } = await phone('a');
    const { rows } = await db.execute(
      "SELECT name FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'trg_sync_%'",
    );
    const names = new Set(rows.map(r => String(r.name)));
    for (const t of SHARED_TABLES) {
      for (const s of ['ai', 'au', 'ad']) {
        expect(names).toContain(`trg_sync_${t.name}_${s}`);
      }
    }
  });

  it('les deux téléphones ont des identifiants différents', async () => {
    const [a, b] = [await phone('a'), await phone('b')];
    expect(await getDeviceId(a.db)).not.toBe(await getDeviceId(b.db));
  });

  it('envoie le stock, le foyer et les sacs sans créer de doublon', async () => {
    const [a, b] = [await phone('a'), await phone('b')];
    const bag = await a.bags.create({ name: 'Sac de Rémi' });
    await a.repo.createItem(
      { name: 'Eau', category: 'water', unit: 'L' },
      { quantity: 30 },
    );
    await a.repo.createItem(
      {
        name: 'Riz',
        category: 'food',
        unit: 'kg',
        caloriesPerUnit: 3600,
        bagId: bag.id,
      },
      { quantity: 2, expirationDate: '2028-03-01' },
    );
    await saveHousehold(a.db, {
      members: 3,
      waterLitersPerPersonDay: 3,
      kcalPerPersonDay: 2000,
    });

    await exchange(a.db, b.db);
    expect(await quantities(b.repo)).toEqual(
      new Map([
        ['Eau', 30],
        ['Riz', 2],
      ]),
    );
    expect((await loadHousehold(b.db)).members).toBe(3);
    expect((await b.bags.list()).map(x => x.name)).toEqual(['Sac de Rémi']);

    const again = await exchange(a.db, b.db);
    expect(again.toB.written + again.toA.written).toBe(0);
    expect(await count(b.db, 'inventory_items')).toBe(2);
    expect(await count(b.db, 'inventory_lots')).toBe(2);
    expect(await countPendingChanges(a.db)).toBe(0);
  });

  it('additionne les consommations faites des deux côtés', async () => {
    const [a, b] = [await phone('a'), await phone('b')];
    const water = await a.repo.createItem(
      { name: 'Eau', category: 'water', unit: 'L' },
      { quantity: 30 },
    );
    await exchange(a.db, b.db);

    await a.repo.consume(water.id, 2);
    await b.repo.consume(water.id, 3);
    const { toA, toB } = await exchange(a.db, b.db);
    expect(toA.summed + toB.summed).toBe(2);
    expect((await quantities(a.repo)).get('Eau')).toBe(25);
    expect((await quantities(b.repo)).get('Eau')).toBe(25);
    // L'historique garde les deux sorties, sur chaque téléphone.
    expect(await b.repo.listMovements({ itemId: water.id })).toHaveLength(3);

    // Puis d'un seul côté, puis encore des deux : la base suit.
    await a.repo.consume(water.id, 1);
    await exchange(a.db, b.db);
    expect((await quantities(b.repo)).get('Eau')).toBe(24);
    await a.repo.consume(water.id, 4);
    await b.repo.consume(water.id, 5);
    await exchange(a.db, b.db);
    expect((await quantities(a.repo)).get('Eau')).toBe(15);
    expect((await quantities(b.repo)).get('Eau')).toBe(15);
  });

  it('la dernière modification d’une fiche l’emporte', async () => {
    const [a, b] = [await phone('a'), await phone('b')];
    const item = await a.repo.createItem({
      name: 'Lampe',
      category: 'tool',
      unit: 'unit',
    });
    await exchange(a.db, b.db);
    await a.repo.updateItem(item.id, { ...item, location: 'Cave' });
    await pause();
    await b.repo.updateItem(item.id, { ...item, location: 'Garage' });
    await exchange(a.db, b.db);
    expect((await a.repo.getItem(item.id)).item.location).toBe('Garage');
    expect((await b.repo.getItem(item.id)).item.location).toBe('Garage');
  });

  it('propage les suppressions sans que l’article revienne', async () => {
    const [a, b] = [await phone('a'), await phone('b')];
    const item = await a.repo.createItem(
      {
        name: 'Conserves',
        category: 'food',
        unit: 'unit',
        caloriesPerUnit: 300,
      },
      { quantity: 6 },
    );
    await exchange(a.db, b.db);
    await a.repo.deleteItem(item.id);
    await exchange(a.db, b.db);
    expect(await count(b.db, 'inventory_items')).toBe(0);
    expect(await count(b.db, 'inventory_lots')).toBe(0);
    await exchange(a.db, b.db);
    expect(await count(a.db, 'inventory_items')).toBe(0);
    expect(await count(b.db, 'inventory_items')).toBe(0);
  });

  it('garde une modification faite pendant l’échange', async () => {
    const [a, b] = [await phone('a'), await phone('b')];
    const item = await a.repo.createItem(
      { name: 'Piles', category: 'power', unit: 'unit' },
      { quantity: 10 },
    );
    const pa = await exportChanges(a.db, NONE);
    const pb = await exportChanges(b.db, NONE);
    await a.repo.consume(item.id, 4); // pendant le transfert
    await applyRemoteChanges(a.db, pb, { ...NONE, sent: pa });
    await applyRemoteChanges(b.db, pa, { ...NONE, sent: pb });
    expect((await quantities(b.repo)).get('Piles')).toBe(10);
    await exchange(a.db, b.db);
    expect((await quantities(b.repo)).get('Piles')).toBe(6);
    expect((await quantities(a.repo)).get('Piles')).toBe(6);
  });

  it('ne partage l’armement et les photos que sur option', async () => {
    const [a, b] = [await phone('a'), await phone('b')];
    const rifle = await a.armory.createWeapon({
      model: 'Carabine',
      kind: 'rifle',
      caliber: '.22 LR',
      serialNumber: 'SN-123',
    });
    await a.repo.createItem(
      { name: 'Balles', category: 'weapon', unit: 'unit', caliber: '.22 LR' },
      { quantity: 50 },
    );
    const knife = await a.repo.createItem({
      name: 'Couteau',
      category: 'tool',
      unit: 'unit',
    });
    await a.photos.add('item', knife.id, PIXEL, 'image/png');
    await a.photos.add('weapon', rifle.id, PIXEL, 'image/png');

    const { pa } = await exchange(a.db, b.db, NONE);
    expect(JSON.stringify(pa)).not.toContain('SN-123');
    expect(JSON.stringify(pa)).not.toContain('Balles');
    expect(await count(b.db, 'weapons')).toBe(0);
    expect(await count(b.db, 'photos')).toBe(0);
    expect((await quantities(b.repo)).has('Couteau')).toBe(true);

    // Élargir le partage : envoi complet (les lignes écartées étaient
    // antérieures au dernier relevé).
    const photos = { weapons: false, photos: true };
    await applyRemoteChanges(b.db, await exportChanges(a.db, photos), photos);
    expect(await count(b.db, 'photos')).toBe(1); // celle du couteau
    expect(await count(b.db, 'weapons')).toBe(0);

    await applyRemoteChanges(b.db, await exportChanges(a.db, ALL), ALL);
    expect(await count(b.db, 'weapons')).toBe(1);
    expect(await count(b.db, 'photos')).toBe(2);
    expect((await quantities(b.repo)).get('Balles')).toBe(50);
  });

  it('annule tout si une ligne reçue est refusée par la base', async () => {
    const [a, b] = [await phone('a'), await phone('b')];
    await a.repo.createItem(
      { name: 'Eau', category: 'water', unit: 'L' },
      { quantity: 30 },
    );
    const pa = await exportChanges(a.db, NONE);
    const broken: SyncPayload = {
      ...pa,
      rows: pa.rows.map(r =>
        r.table === 'inventory_lots' && r.data
          ? { ...r, data: { ...r.data, quantity: -5 } }
          : r,
      ),
    };
    await expect(applyRemoteChanges(b.db, broken, NONE)).rejects.toThrow();
    expect(await count(b.db, 'inventory_items')).toBe(0);
    const { rows } = await b.db.execute(
      "SELECT count(*) AS n FROM sync_meta WHERE key = 'applying'",
    );
    expect(Number(rows[0].n)).toBe(0);
    // Après l'échec, un envoi correct passe normalement.
    await applyRemoteChanges(b.db, pa, NONE);
    expect((await quantities(b.repo)).get('Eau')).toBe(30);
  });

  it('refuse un envoi mal formé ou venu du futur', async () => {
    const [a, b] = [await phone('a'), await phone('b')];
    await a.repo.createItem({ name: 'Eau', category: 'water', unit: 'L' });
    const pa = await exportChanges(a.db, NONE);
    const attempt = (payload: unknown) =>
      applyRemoteChanges(b.db, payload, NONE).catch(e => e);

    const injected = {
      ...pa,
      rows: [
        {
          ...pa.rows.find(r => r.table === 'inventory_items'),
          data: { 'id) VALUES (1); DROP TABLE settings; --': 'x' },
        },
      ],
    };
    expect((await attempt(injected)).code).toBe('INVALID_PAYLOAD');
    expect(
      (await attempt({ ...pa, rows: [{ ...pa.rows[0], table: 'sync_meta' }] }))
        .code,
    ).toBe('INVALID_PAYLOAD');
    expect((await attempt({ ...pa, format: 2 })).code).toBe(
      'UNSUPPORTED_FORMAT',
    );
    const future = encodeHlc({
      wall: Date.now() + 3 * 86400000,
      counter: 0,
      node: pa.device,
    });
    const fromFuture = await attempt({ ...pa, clock: future });
    expect(fromFuture).toBeInstanceOf(SyncError);
    expect(fromFuture.code).toBe('CLOCK_AHEAD');
    expect((await attempt(pa)).code).toBeUndefined();
  });

  it('reste rapide avec plusieurs milliers d’articles', async () => {
    const [a, b] = [await phone('a'), await phone('b')];
    const ids: string[] = [];
    for (let i = 0; i < 3000; i++) {
      const item = await a.repo.createItem(
        {
          name: `Article ${i}`,
          category: 'food',
          unit: 'unit',
          caloriesPerUnit: 100,
        },
        { quantity: 10 },
      );
      ids.push(item.id);
    }
    const started = Date.now();
    await exchange(a.db, b.db);
    const first = Date.now() - started;
    expect(await count(b.db, 'inventory_items')).toBe(3000);
    expect(await count(b.db, 'inventory_lots')).toBe(3000);

    for (let i = 0; i < 200; i++) {
      await a.repo.consume(ids[i], 1);
      await b.repo.consume(ids[i], 2);
    }
    await exchange(a.db, b.db);
    const [qa, qb] = [await quantities(a.repo), await quantities(b.repo)];
    expect(qa.get('Article 0')).toBe(7);
    expect(qb.get('Article 199')).toBe(7);
    expect(qb.get('Article 200')).toBe(10);
    expect(qa).toEqual(qb);
    expect(first).toBeLessThan(15000);
  }, 60000);
});

describe('composition du foyer partagée', () => {
  it('envoie le nombre d’enfants et de bébés', async () => {
    const [a, b] = [await phone('a'), await phone('b')];
    await saveHousehold(a.db, {
      members: 4,
      waterLitersPerPersonDay: 3,
      kcalPerPersonDay: 2000,
      children: 2,
      babies: 1,
    });
    await exchange(a.db, b.db);
    const h = await loadHousehold(b.db);
    expect([h.members, h.children, h.babies]).toEqual([4, 2, 1]);
  });
});
