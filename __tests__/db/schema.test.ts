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
      { key: 'target_days', value: '14' },
      { key: 'water_liters_per_person_day', value: '3' },
    ]);
  });

  it.each([
    ['catégorie inconnue', { category: 'vehicle' }],
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

describe('migration 2 (réapprovisionnement)', () => {
  it('met à niveau une base v1 existante sans perdre de données', async () => {
    const db = new NodeSqliteDb();
    await db.execute('PRAGMA foreign_keys = ON');
    await migrate(db, MIGRATIONS.slice(0, 1));
    await db.execute(
      `INSERT INTO inventory_items (id, name, category, unit) VALUES ('f1', 'Filtre', 'tool', 'unit')`,
    );
    await db.execute(
      "UPDATE settings SET value = '4' WHERE key = 'household_members'",
    );

    expect(await migrate(db)).toEqual({ from: 1, to: SCHEMA_VERSION });

    const { rows } = await db.execute(
      "SELECT name, min_stock, alert_days FROM inventory_items WHERE id = 'f1'",
    );
    expect(rows).toEqual([
      { name: 'Filtre', min_stock: null, alert_days: null },
    ]);
    const settings = await db.execute(
      "SELECT key, value FROM settings WHERE key IN ('household_members', 'target_days') ORDER BY key",
    );
    expect(settings.rows).toEqual([
      { key: 'household_members', value: '4' },
      { key: 'target_days', value: '14' },
    ]);
  });

  it('borne les nouveaux champs', async () => {
    const db = await freshDb();
    const insert = (minStock: number | null, alertDays: number | null) =>
      db.execute(
        `INSERT INTO inventory_items (id, name, category, unit, min_stock, alert_days)
         VALUES (?, 'x', 'tool', 'unit', ?, ?)`,
        [`i-${minStock}-${alertDays}`, minStock, alertDays],
      );
    await insert(2, 180);
    await expect(insert(-1, null)).rejects.toThrow(/constraint/i);
    await expect(insert(null, 0)).rejects.toThrow(/constraint/i);
    await expect(insert(null, 4000)).rejects.toThrow(/constraint/i);
  });
});

describe('migration 3 (armes et munitions)', () => {
  async function v2WithStock() {
    const db = new NodeSqliteDb();
    await db.execute('PRAGMA foreign_keys = ON');
    await migrate(db, MIGRATIONS.slice(0, 2));
    await db.execute(
      `INSERT INTO inventory_items (id, name, category, unit, calories_per_unit,
         location, is_critical, notes, created_at, updated_at, min_stock, alert_days)
       VALUES ('r1', 'Riz', 'food', 'kg', 3600, 'Cellier', 1, 'sac',
         '2026-01-02T03:04:05.000Z', '2026-01-02T03:04:05.000Z', 5, 120)`,
    );
    await db.execute(
      `INSERT INTO inventory_lots (id, item_id, quantity, acquired_at, expiration_date,
         created_at, updated_at)
       VALUES ('l1', 'r1', 10, '2026-01-02', '2027-06-30',
         '2026-01-02T03:04:05.000Z', '2026-01-02T03:04:05.000Z')`,
    );
    return db;
  }

  it('conserve les articles et leurs lots', async () => {
    const db = await v2WithStock();
    expect(await migrate(db)).toEqual({ from: 2, to: SCHEMA_VERSION });

    const items = await db.execute('SELECT * FROM inventory_items');
    expect(items.rows).toEqual([
      {
        id: 'r1',
        name: 'Riz',
        category: 'food',
        unit: 'kg',
        calories_per_unit: 3600,
        location: 'Cellier',
        is_critical: 1,
        notes: 'sac',
        created_at: '2026-01-02T03:04:05.000Z',
        updated_at: '2026-01-02T03:04:05.000Z',
        min_stock: 5,
        alert_days: 120,
        caliber: null,
        package_size: null,
        subtype: null,
        attributes: null,
      },
    ]);
    const lots = await db.execute('SELECT * FROM inventory_lots');
    expect(lots.rows).toEqual([
      {
        id: 'l1',
        item_id: 'r1',
        quantity: 10,
        acquired_at: '2026-01-02',
        expiration_date: '2027-06-30',
        created_at: '2026-01-02T03:04:05.000Z',
        updated_at: '2026-01-02T03:04:05.000Z',
      },
    ]);
    expect(await names(db, 'table')).not.toContain('inventory_lots_backup');
    expect(await names(db, 'table')).not.toContain('inventory_items_new');
    expect(await names(db, 'table')).toContain('weapons');
  });

  it('réserve le calibre aux munitions et valide les armes', async () => {
    const db = await v2WithStock();
    await migrate(db);
    await db.execute(
      `INSERT INTO inventory_items (id, name, category, unit, caliber)
       VALUES ('m1', 'Cartouches', 'weapon', 'unit', '12/70')`,
    );
    await expect(
      db.execute(
        `INSERT INTO inventory_items (id, name, category, unit, caliber)
         VALUES ('x1', 'Riz', 'food', 'kg', '12/70')`,
      ),
    ).rejects.toThrow(/constraint/i);
    await expect(
      db.execute(
        `INSERT INTO inventory_items (id, name, category, unit, caliber)
         VALUES ('x2', 'Cartouches', 'weapon', 'unit', '  ')`,
      ),
    ).rejects.toThrow(/constraint/i);

    await db.execute(
      `INSERT INTO weapons (id, model, kind, caliber)
       VALUES ('w1', 'Browning B525', 'shotgun', '12/70')`,
    );
    await expect(
      db.execute(
        `INSERT INTO weapons (id, model, kind, caliber)
         VALUES ('w2', 'X', 'cannon', '12/70')`,
      ),
    ).rejects.toThrow(/constraint/i);
    await expect(
      db.execute(
        `INSERT INTO weapons (id, model, kind, caliber)
         VALUES ('w3', 'X', 'rifle', '')`,
      ),
    ).rejects.toThrow(/constraint/i);
    expect(await names(db, 'trigger')).toContain('trg_weapons_touch');
  });

  it('accepte la catégorie armes et garde toutes les contraintes', async () => {
    const db = await v2WithStock();
    await migrate(db);
    await db.execute(
      `INSERT INTO inventory_items (id, name, category, unit)
       VALUES ('m1', 'Cartouches 12/70', 'weapon', 'unit')`,
    );
    await expect(
      db.execute(
        `INSERT INTO inventory_items (id, name, category, unit)
         VALUES ('x1', 'x', 'vehicle', 'unit')`,
      ),
    ).rejects.toThrow(/constraint/i);
    await expect(
      db.execute(
        `INSERT INTO inventory_items (id, name, category, unit)
         VALUES ('x2', 'Eau', 'water', 'kg')`,
      ),
    ).rejects.toThrow(/constraint/i);
    await expect(
      db.execute(
        `INSERT INTO inventory_lots (id, item_id, quantity, acquired_at)
         VALUES ('x3', 'absent', 1, '2026-01-01')`,
      ),
    ).rejects.toThrow(/constraint/i);

    // Suppression en cascade et horodatage automatique toujours actifs.
    await db.execute(
      "UPDATE inventory_items SET name = 'Riz long' WHERE id = 'r1'",
    );
    const touched = await db.execute(
      "SELECT updated_at FROM inventory_items WHERE id = 'r1'",
    );
    expect(touched.rows[0].updated_at).not.toBe('2026-01-02T03:04:05.000Z');
    await db.execute("DELETE FROM inventory_items WHERE id = 'r1'");
    expect((await db.execute('SELECT * FROM inventory_lots')).rows).toEqual([]);

    expect(await names(db, 'index')).toEqual(
      expect.arrayContaining([
        'idx_inventory_items_category',
        'idx_inventory_lots_consumption',
        'idx_inventory_lots_expiration',
      ]),
    );
    expect(await names(db, 'trigger')).toEqual(
      expect.arrayContaining([
        'trg_inventory_items_touch',
        'trg_inventory_lots_touch',
      ]),
    );
  });
});

describe('migration 4 (conditionnement)', () => {
  it('ajoute la contenance sans toucher aux articles existants', async () => {
    const db = new NodeSqliteDb();
    await db.execute('PRAGMA foreign_keys = ON');
    await migrate(db, MIGRATIONS.slice(0, 3));
    await db.execute(
      `INSERT INTO inventory_items (id, name, category, unit)
       VALUES ('e1', 'Eau', 'water', 'L')`,
    );
    expect(await migrate(db)).toEqual({ from: 3, to: SCHEMA_VERSION });

    const { rows } = await db.execute(
      "SELECT name, package_size FROM inventory_items WHERE id = 'e1'",
    );
    expect(rows).toEqual([{ name: 'Eau', package_size: null }]);
    await db.execute(
      "UPDATE inventory_items SET package_size = 10 WHERE id = 'e1'",
    );
    for (const bad of [0, -5]) {
      await expect(
        db.execute(
          "UPDATE inventory_items SET package_size = ? WHERE id = 'e1'",
          [bad],
        ),
      ).rejects.toThrow(/constraint/i);
    }
  });
});

describe('migration 6 (type d’article)', () => {
  it('ajoute un type facultatif borné', async () => {
    const db = new NodeSqliteDb();
    await migrate(db, MIGRATIONS.slice(0, 5));
    await db.execute(
      `INSERT INTO inventory_items (id, name, category, unit)
       VALUES ('c1', 'Cassoulet', 'food', 'unit')`,
    );
    expect(await migrate(db)).toEqual({ from: 5, to: SCHEMA_VERSION });
    await db.execute(
      "UPDATE inventory_items SET subtype = 'canned' WHERE id = 'c1'",
    );
    await expect(
      db.execute("UPDATE inventory_items SET subtype = '' WHERE id = 'c1'"),
    ).rejects.toThrow(/constraint/i);
  });
});

describe('migration 7 (fiches détaillées)', () => {
  it('garde les photos, autorise celles des articles et nettoie à la suppression', async () => {
    const db = new NodeSqliteDb();
    await db.execute('PRAGMA foreign_keys = ON');
    await migrate(db, MIGRATIONS.slice(0, 6));
    await db.execute(
      `INSERT INTO weapons (id, model, kind, caliber) VALUES ('w1', 'Glock', 'handgun', '9x19')`,
    );
    await db.execute(
      `INSERT INTO photos (id, owner_type, owner_id, data_base64) VALUES ('p1', 'weapon', 'w1', 'AAAA')`,
    );
    expect(await migrate(db)).toEqual({ from: 6, to: SCHEMA_VERSION });

    expect((await db.execute('SELECT id FROM photos')).rows).toEqual([
      { id: 'p1' },
    ]);
    await db.execute(
      `INSERT INTO inventory_items (id, name, category, unit, attributes)
       VALUES ('i1', 'Tente', 'energy', 'unit', '{"condition":"good"}')`,
    );
    await db.execute(
      `INSERT INTO photos (id, owner_type, owner_id, data_base64) VALUES ('p2', 'item', 'i1', 'AAAA')`,
    );
    await expect(
      db.execute(
        "UPDATE inventory_items SET attributes = 'pas du json' WHERE id = 'i1'",
      ),
    ).rejects.toThrow(/constraint/i);

    await db.execute("DELETE FROM inventory_items WHERE id = 'i1'");
    await db.execute("DELETE FROM weapons WHERE id = 'w1'");
    expect((await db.execute('SELECT id FROM photos')).rows).toEqual([]);
  });
});

describe('migration 8 (catégorie énergie)', () => {
  it('déplace l’énergie du matériel sans perdre lots ni photos', async () => {
    const db = new NodeSqliteDb();
    await db.execute('PRAGMA foreign_keys = ON');
    await migrate(db, MIGRATIONS.slice(0, 7));
    const item = (id: string, name: string, subtype: string) =>
      db.execute(
        `INSERT INTO inventory_items (id, name, category, unit, subtype, attributes)
         VALUES (?, ?, 'energy', 'unit', ?, '{"condition":"good"}')`,
        [id, name, subtype],
      );
    await item('a', 'Piles AA', 'energy');
    await item('b', 'Batterie externe 20 000 mAh', 'energy');
    await item('c', 'Tente', 'shelter');
    await item('d', 'Cartouche', 'gas');
    await item('e', 'Réserve', 'energy');
    await db.execute(
      `INSERT INTO inventory_lots (id, item_id, quantity, acquired_at, expiration_date)
       VALUES ('l1', 'a', 4, '2026-01-01', '2030-01-01'),
              ('l2', 'c', 1, '2026-01-01', NULL)`,
    );
    await db.execute(
      `INSERT INTO photos (id, owner_type, owner_id, data_base64) VALUES ('p1', 'item', 'a', 'AAAA')`,
    );

    expect(await migrate(db)).toEqual({ from: 7, to: SCHEMA_VERSION });

    const { rows } = await db.execute(
      'SELECT id, category, subtype, attributes FROM inventory_items ORDER BY id',
    );
    expect(rows).toEqual([
      {
        id: 'a',
        category: 'power',
        subtype: 'battery',
        attributes: '{"condition":"good"}',
      },
      {
        id: 'b',
        category: 'power',
        subtype: 'powerbank',
        attributes: '{"condition":"good"}',
      },
      {
        id: 'c',
        category: 'energy',
        subtype: 'shelter',
        attributes: '{"condition":"good"}',
      },
      {
        id: 'd',
        category: 'power',
        subtype: 'gas',
        attributes: '{"condition":"good"}',
      },
      {
        id: 'e',
        category: 'power',
        subtype: 'other',
        attributes: '{"condition":"good"}',
      },
    ]);
    expect(
      (
        await db.execute(
          'SELECT id, item_id, quantity FROM inventory_lots ORDER BY id',
        )
      ).rows,
    ).toEqual([
      { id: 'l1', item_id: 'a', quantity: 4 },
      { id: 'l2', item_id: 'c', quantity: 1 },
    ]);

    // Contraintes, cascade et nettoyage des photos toujours en place.
    await expect(
      db.execute(
        `INSERT INTO inventory_items (id, name, category, unit) VALUES ('x', 'X', 'nope', 'unit')`,
      ),
    ).rejects.toThrow(/constraint/i);
    await db.execute("DELETE FROM inventory_items WHERE id = 'a'");
    expect((await db.execute('SELECT id FROM inventory_lots')).rows).toEqual([
      { id: 'l2' },
    ]);
    expect((await db.execute('SELECT id FROM photos')).rows).toEqual([]);
    expect((await db.execute('PRAGMA foreign_key_check')).rows).toEqual([]);
  });
});
