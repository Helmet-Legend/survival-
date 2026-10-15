import { prepareDatabase } from '../../src/db/connection';
import {
  getSchemaVersion,
  migrate,
  MigrationError,
} from '../../src/db/migrate';
import { MIGRATIONS, SCHEMA_VERSION } from '../../src/db/schema';
import { NodeSqliteDb } from './sqlite';

async function freshDb() {
  const db = new NodeSqliteDb();
  await prepareDatabase(db);
  return db;
}

async function names(db: NodeSqliteDb, type: string) {
  const { rows } = await db.execute(
    "SELECT name FROM sqlite_master WHERE type = ? AND name NOT LIKE 'sqlite_%' ORDER BY name",
    [type],
  );
  return rows.map(row => row.name);
}

describe('migrations', () => {
  it('crée le schéma complet sur une base vide', async () => {
    const db = new NodeSqliteDb();
    expect(await prepareDatabase(db)).toEqual({ from: 0, to: SCHEMA_VERSION });
    expect(await getSchemaVersion(db)).toBe(SCHEMA_VERSION);
    expect(await names(db, 'table')).toEqual(
      expect.arrayContaining([
        'crisis_checklist_items',
        'crisis_checklists',
        'inventory_items',
        'inventory_lots',
        'poi_locations',
        'settings',
        'survival_guides',
        'survival_guides_fts',
      ]),
    );
  });

  it('est idempotente', async () => {
    const db = await freshDb();
    expect(await migrate(db)).toEqual({
      from: SCHEMA_VERSION,
      to: SCHEMA_VERSION,
    });
  });

  it('refuse une base créée par une version plus récente', async () => {
    const db = new NodeSqliteDb();
    await db.execute('PRAGMA user_version = 99');
    await expect(migrate(db)).rejects.toMatchObject({
      code: 'DATABASE_TOO_NEW',
      version: 99,
    });
  });

  it('annule entièrement une migration en échec', async () => {
    const db = await freshDb();
    const broken = [
      ...MIGRATIONS,
      {
        version: SCHEMA_VERSION + 1,
        name: 'cassée',
        statements: [
          'CREATE TABLE partial (x INTEGER) STRICT',
          'SELECT * FROM nope',
        ],
      },
    ];

    const error = await migrate(db, broken).catch(e => e);
    expect(error).toBeInstanceOf(MigrationError);
    expect(error).toMatchObject({
      code: 'MIGRATION_FAILED',
      version: SCHEMA_VERSION + 1,
    });
    expect(await getSchemaVersion(db)).toBe(SCHEMA_VERSION);
    expect(await names(db, 'table')).not.toContain('partial');
  });

  it('détecte une liste de migrations incohérente', async () => {
    const db = new NodeSqliteDb();
    await expect(
      migrate(db, [{ version: 2, name: 'trou', statements: [] }]),
    ).rejects.toMatchObject({ code: 'INVALID_MIGRATIONS' });
  });

  it('active les clés étrangères sur la connexion', async () => {
    const db = await freshDb();
    const { rows } = await db.execute('PRAGMA foreign_keys');
    expect(rows[0].foreign_keys).toBe(1);
  });
});

describe('contraintes du schéma', () => {
  const insertItem = (
    db: NodeSqliteDb,
    overrides: Record<string, unknown> = {},
  ) => {
    const item = {
      id: 'item-1',
      name: 'Eau de source',
      category: 'water',
      unit: 'L',
      calories_per_unit: null,
      is_critical: 1,
      ...overrides,
    };
    return db.execute(
      `INSERT INTO inventory_items (id, name, category, unit, calories_per_unit, is_critical)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        item.id,
        item.name,
        item.category,
        item.unit,
        item.calories_per_unit,
        item.is_critical,
      ] as Array<string | number | null>,
    );
  };
  const insertLot = (
    db: NodeSqliteDb,
    id: string,
    expiration: string | null,
    quantity: number | string = 6,
  ) =>
    db.execute(
      `INSERT INTO inventory_lots (id, item_id, quantity, acquired_at, expiration_date)
       VALUES (?, 'item-1', ?, '2026-01-10', ?)`,
      [id, quantity, expiration],
    );

  it('insère les réglages par défaut du foyer', async () => {
    const db = await freshDb();
    const { rows } = await db.execute(
      'SELECT key, value FROM settings ORDER BY key',
    );
    expect(rows).toEqual([
      { key: 'household_members', value: '1' },
      { key: 'kcal_per_person_day', value: '2000' },
      { key: 'water_liters_per_person_day', value: '3' },
    ]);
  });

  it.each([
    ['catégorie inconnue', { category: 'weapon' }],
    ['unité inconnue', { unit: 'gallon' }],
    ['eau sans unité de volume', { unit: 'kg' }],
    ['booléen hors 0/1', { is_critical: 2 }],
    ['nom vide', { name: '   ' }],
    [
      'calories négatives',
      { category: 'food', unit: 'g', calories_per_unit: -5 },
    ],
  ])('rejette un article invalide : %s', async (_, overrides) => {
    const db = await freshDb();
    await expect(insertItem(db, overrides)).rejects.toThrow(/constraint/i);
  });

  it.each([
    ['date inexistante', '2026-02-30'],
    ['format non ISO', '30/01/2026'],
    ['date incomplète', '2026-1-5'],
  ])('rejette une date de péremption invalide : %s', async (_, date) => {
    const db = await freshDb();
    await insertItem(db);
    await expect(insertLot(db, 'lot-1', date)).rejects.toThrow(/constraint/i);
  });

  it('rejette une quantité non numérique (table STRICT)', async () => {
    const db = await freshDb();
    await insertItem(db);
    await expect(insertLot(db, 'lot-1', null, 'six')).rejects.toThrow();
  });

  it('supprime les lots avec leur article (ON DELETE CASCADE)', async () => {
    const db = await freshDb();
    await insertItem(db);
    await insertLot(db, 'lot-1', '2026-12-31');
    await db.execute("DELETE FROM inventory_items WHERE id = 'item-1'");
    const { rows } = await db.execute(
      'SELECT count(*) AS n FROM inventory_lots',
    );
    expect(rows[0].n).toBe(0);
  });

  it('refuse un lot pour un article inexistant', async () => {
    const db = await freshDb();
    await expect(insertLot(db, 'lot-1', null)).rejects.toThrow(/FOREIGN KEY/);
  });

  it('met à jour updated_at automatiquement', async () => {
    const db = await freshDb();
    await insertItem(db);
    await db.execute(
      "UPDATE inventory_items SET updated_at = '2000-01-01T00:00:00.000Z'",
    );
    await db.execute("UPDATE inventory_items SET name = 'Eau minérale'");
    const { rows } = await db.execute('SELECT updated_at FROM inventory_items');
    expect(rows[0].updated_at).not.toBe('2000-01-01T00:00:00.000Z');
    expect(rows[0].updated_at).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
    );
  });

  it("utilise l'index partiel pour les alertes de péremption", async () => {
    const db = await freshDb();
    const { rows } = await db.execute(
      `EXPLAIN QUERY PLAN
       SELECT id FROM inventory_lots
        WHERE expiration_date IS NOT NULL AND quantity > 0
          AND expiration_date <= date('now', '+90 days')`,
    );
    expect(rows.map(r => String(r.detail)).join('\n')).toContain(
      'idx_inventory_lots_expiration',
    );
  });

  it('valide les coordonnées et le type de POI', async () => {
    const db = await freshDb();
    const insert = (lat: number, type: string) =>
      db.execute(
        `INSERT INTO poi_locations (id, label, latitude, longitude, type)
         VALUES (?, 'Source', ?, 2.35, ?)`,
        [`poi-${lat}-${type}`, lat, type],
      );
    await insert(48.85, 'water_source');
    await expect(insert(91, 'water_source')).rejects.toThrow(/constraint/i);
    await expect(insert(48.85, 'bunker')).rejects.toThrow(/constraint/i);
  });

  it('ordonne les éléments de checklist et interdit les positions en double', async () => {
    const db = await freshDb();
    await db.execute(
      "INSERT INTO crisis_checklists (id, title, scenario) VALUES ('c1', 'Évacuation', 'flood')",
    );
    const add = (id: string, position: number) =>
      db.execute(
        `INSERT INTO crisis_checklist_items (id, checklist_id, position, label)
         VALUES (?, 'c1', ?, 'Papiers')`,
        [id, position],
      );
    await add('i1', 0);
    await expect(add('i2', 0)).rejects.toThrow(/UNIQUE/);
  });
});
