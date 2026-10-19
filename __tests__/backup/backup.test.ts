/// <reference types="node" />
import { randomBytes } from 'node:crypto';

import {
  BackupError,
  createBackup,
  restoreBackup,
} from '../../src/backup/backup';
import {
  base64ToBytes,
  bytesToBase64,
  utf8ToText,
} from '../../src/backup/base64';
import { prepareDatabase } from '../../src/db/connection';
import { MapTileStore } from '../../src/geo/tiles';
import { WaypointRepository } from '../../src/geo/waypoints';
import {
  BagRepository,
  DocumentRepository,
  InventoryRepository,
  PhotoRepository,
} from '../../src/inventory';
import { JsArgon2, TEST_ARGON2_PARAMS } from '../crypto/fakes';
import { NodeSqliteDb } from '../db/sqlite';

const PASSWORD = 'mot de passe solide';
const random = { bytes: (n: number) => new Uint8Array(randomBytes(n)) };

async function freshDb() {
  const db = new NodeSqliteDb();
  await prepareDatabase(db);
  return db;
}

async function filledDb() {
  const db = await freshDb();
  const repo = new InventoryRepository(db);
  const bags = new BagRepository(db);
  const bag = await bags.create({ name: 'Sac de Léa' });
  const riz = await repo.createItem(
    { name: 'Riz', category: 'food', unit: 'kg', caloriesPerUnit: 3600 },
    { quantity: 5, expirationDate: '2030-01-31' },
  );
  await repo.createItem(
    { name: 'Gourde', category: 'water', unit: 'L', bagId: bag.id },
    { quantity: 1 },
  );
  await new DocumentRepository(db).create({
    kind: 'passport',
    title: 'Passeport',
    number: '19FD84920',
  });
  await new PhotoRepository(db).add('item', riz.id, 'AAAA');
  return db;
}

const options = () => ({
  engine: new JsArgon2(),
  random,
  params: TEST_ARGON2_PARAMS,
});

describe('sauvegarde chiffrée', () => {
  it('restaure tout le contenu sur un autre coffre', async () => {
    const source = await filledDb();
    const { text, summary } = await createBackup(source, PASSWORD, options());
    // Rien de lisible dans le fichier.
    expect(text).not.toContain('Riz');
    expect(text).not.toContain('19FD84920');
    expect(summary.rows).toBeGreaterThan(5);

    const target = await freshDb();
    await new InventoryRepository(target).createItem(
      { name: 'À remplacer', category: 'food', unit: 'kg' },
      { quantity: 1 },
    );
    await restoreBackup(target, text, PASSWORD, new JsArgon2());

    const items = await new InventoryRepository(target).listItems();
    expect(items.map(i => i.name)).toEqual(['Gourde', 'Riz']);
    expect(items.find(i => i.name === 'Riz')?.usableQuantity).toBe(5);
    expect((await new BagRepository(target).list())[0]).toMatchObject({
      name: 'Sac de Léa',
      itemCount: 1,
    });
    expect((await new DocumentRepository(target).list())[0].number).toBe(
      '19FD84920',
    );
    const riz = items.find(i => i.name === 'Riz');
    expect(
      await new PhotoRepository(target).list('item', riz?.id ?? ''),
    ).toHaveLength(1);
    expect((await target.execute('PRAGMA foreign_key_check')).rows).toEqual([]);
  });

  it('sauvegarde les points mais pas les cartes hors ligne', async () => {
    const source = await freshDb();
    await new WaypointRepository(source).create({
      label: 'Source',
      type: 'water_source',
      latitude: 45,
      longitude: 6,
    });
    await new MapTileStore(source).putTile(8, 1, 1, 'data:image/png;base64,QQ');
    const { text } = await createBackup(source, PASSWORD, options());

    const target = await freshDb();
    await new MapTileStore(target).putTile(8, 2, 2, 'data:image/png;base64,QQ');
    await restoreBackup(target, text, PASSWORD, new JsArgon2());
    expect((await new WaypointRepository(target).list())[0].label).toBe(
      'Source',
    );
    const tiles = new MapTileStore(target);
    expect(await tiles.hasTile(8, 1, 1)).toBe(false);
    // Les cartes déjà téléchargées sur ce téléphone restent.
    expect(await tiles.hasTile(8, 2, 2)).toBe(true);
  });

  it('refuse un mot de passe faux ou un fichier modifié sans rien changer', async () => {
    const source = await filledDb();
    const { text } = await createBackup(source, PASSWORD, options());
    const target = await freshDb();
    await new InventoryRepository(target).createItem(
      { name: 'Intact', category: 'food', unit: 'kg' },
      { quantity: 1 },
    );

    await expect(
      restoreBackup(target, text, 'pas le bon mot', new JsArgon2()),
    ).rejects.toMatchObject({ code: 'WRONG_PASSWORD' });

    const envelope = JSON.parse(text);
    const data = base64ToBytes(envelope.data);
    data[10] ^= 1;
    envelope.data = bytesToBase64(data);
    await expect(
      restoreBackup(target, JSON.stringify(envelope), PASSWORD, new JsArgon2()),
    ).rejects.toMatchObject({ code: 'WRONG_PASSWORD' });

    await expect(
      restoreBackup(target, '{"hello":1}', PASSWORD, new JsArgon2()),
    ).rejects.toMatchObject({ code: 'INVALID_FILE' });
    await expect(
      restoreBackup(
        target,
        JSON.stringify({ ...envelope, version: 99 }),
        PASSWORD,
        new JsArgon2(),
      ),
    ).rejects.toMatchObject({ code: 'NEWER_VERSION' });

    const items = await new InventoryRepository(target).listItems();
    expect(items.map(i => i.name)).toEqual(['Intact']);
  });

  it('exige un mot de passe d’au moins 8 caractères', async () => {
    const db = await freshDb();
    await expect(createBackup(db, 'court', options())).rejects.toBeInstanceOf(
      BackupError,
    );
  });
});

describe('encodages', () => {
  it('fait l’aller-retour base64 et UTF-8', () => {
    for (const length of [0, 1, 2, 3, 4, 31, 255]) {
      const bytes = new Uint8Array(randomBytes(length));
      expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes);
      expect(bytesToBase64(bytes)).toBe(Buffer.from(bytes).toString('base64'));
    }
    const text = 'Sac de Léa · 🎒 « eau » ½';
    expect(utf8ToText(new Uint8Array(Buffer.from(text, 'utf8')))).toBe(text);
  });
});
