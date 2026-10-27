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
import { xchacha20poly1305 } from '@noble/ciphers/chacha';
import { utf8ToBytes } from '@noble/hashes/utils';

import { normalizePin } from '../../src/crypto/kdf';
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
    // Rien de lisible dans le fichier : l'enveloppe ne contient que les
    // paramètres, le contenu n'est qu'un bloc chiffré en base64 (où trois
    // lettres comme « Riz » peuvent apparaître par hasard).
    const { data, ...envelope } = JSON.parse(text) as { data: string };
    expect(JSON.stringify(envelope)).not.toContain('Riz');
    expect(data).toMatch(/^[A-Za-z0-9+/]+=*$/);
    expect(text).not.toContain('Passeport');
    expect(text).not.toContain('19FD84920');
    expect(summary.rows).toBeGreaterThan(5);

    const target = await freshDb();
    await new InventoryRepository(target).createItem(
      { name: 'À remplacer', category: 'food', unit: 'kg' },
      { quantity: 1 },
    );
    const restored = await restoreBackup(
      target,
      text,
      PASSWORD,
      new JsArgon2(),
    );
    // Recomptage après écriture : celui de la source, table par table.
    expect(restored.counts).toMatchObject({
      inventory_items: 2,
      bags: 1,
      documents: 1,
      photos: 1,
    });
    expect(restored.rows).toBe(summary.rows);

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
    data[10] = (data[10] + 1) % 256; // octet chiffré altéré
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

describe('fichier abîmé ou piégé', () => {
  /** Chiffre un contenu quelconque comme le ferait une vraie sauvegarde. */
  async function sealed(content: string): Promise<string> {
    const salt = new Uint8Array(randomBytes(16));
    const nonce = new Uint8Array(randomBytes(24));
    const key = await new JsArgon2().argon2id(normalizePin(PASSWORD), salt, {
      ...TEST_ARGON2_PARAMS,
      hashLength: 32,
    });
    return JSON.stringify({
      format: 'fenrir-sauvegarde',
      version: 1,
      kdf: {
        alg: 'argon2id',
        memoryKiB: TEST_ARGON2_PARAMS.memoryKiB,
        iterations: TEST_ARGON2_PARAMS.iterations,
        parallelism: TEST_ARGON2_PARAMS.parallelism,
        salt: bytesToBase64(salt),
      },
      cipher: 'xchacha20poly1305',
      nonce: bytesToBase64(nonce),
      data: bytesToBase64(
        xchacha20poly1305(key, nonce).encrypt(utf8ToBytes(content)),
      ),
    });
  }

  async function intactTarget() {
    const db = await freshDb();
    await new InventoryRepository(db).createItem(
      { name: 'Intact', category: 'food', unit: 'kg' },
      { quantity: 1 },
    );
    return db;
  }
  const names = async (db: NodeSqliteDb) =>
    (await new InventoryRepository(db).listItems()).map(i => i.name);

  it('refuse des paramètres de chiffrement aberrants sans lancer le calcul', async () => {
    const target = await intactTarget();
    const { text } = await createBackup(await filledDb(), PASSWORD, options());
    const envelope = JSON.parse(text);
    const engine = new JsArgon2();
    for (const kdf of [
      { memoryKiB: 64 * 1024 * 1024 }, // 64 Gio demandés
      { iterations: 1_000_000 },
      { parallelism: 0 },
      { memoryKiB: 'beaucoup' },
      { salt: bytesToBase64(new Uint8Array(3)) },
    ]) {
      await expect(
        restoreBackup(
          target,
          JSON.stringify({ ...envelope, kdf: { ...envelope.kdf, ...kdf } }),
          PASSWORD,
          engine,
        ),
      ).rejects.toMatchObject({ code: 'INVALID_FILE' });
    }
    await expect(
      restoreBackup(
        target,
        JSON.stringify({ ...envelope, nonce: 'AAAA' }),
        PASSWORD,
        engine,
      ),
    ).rejects.toMatchObject({ code: 'INVALID_FILE' });
    expect(engine.calls).toBe(0);
    expect(await names(target)).toEqual(['Intact']);
  });

  it('refuse un contenu déchiffré incohérent sans rien modifier', async () => {
    const target = await intactTarget();
    for (const content of [
      'pas du JSON',
      '[]',
      JSON.stringify({ schemaVersion: 18, createdAt: 'x' }),
      JSON.stringify({ schemaVersion: 18, createdAt: 'x', tables: [] }),
      JSON.stringify({
        schemaVersion: 18,
        createdAt: 'x',
        tables: { inventory_items: {} },
      }),
      JSON.stringify({
        schemaVersion: 18,
        createdAt: 'x',
        tables: { inventory_items: [{ id: 'a', name: { piège: 1 } }] },
      }),
      JSON.stringify({ schemaVersion: 'dix-huit', createdAt: 'x', tables: {} }),
    ]) {
      const error = await restoreBackup(
        target,
        await sealed(content),
        PASSWORD,
        new JsArgon2(),
      ).catch((e: unknown) => e);
      expect(error).toMatchObject({ code: 'INVALID_FILE' });
      expect((error as Error).message).toMatch(/Rien n’a été modifié/);
    }
    expect(await names(target)).toEqual(['Intact']);
  });
});

describe('contrôle après restauration', () => {
  it('annule tout si une table ne contient pas ce qui a été écrit', async () => {
    const { text } = await createBackup(await filledDb(), PASSWORD, options());
    const target = await freshDb();
    await new InventoryRepository(target).createItem(
      { name: 'Intact', category: 'food', unit: 'kg' },
      { quantity: 1 },
    );
    // Un mécanisme imprévu fait disparaître les sacs écrits.
    await target.execute(
      'CREATE TRIGGER t_lost AFTER INSERT ON bags BEGIN DELETE FROM bags WHERE id = NEW.id; END',
    );
    await expect(
      restoreBackup(target, text, PASSWORD, new JsArgon2()),
    ).rejects.toMatchObject({ code: 'CHECK_FAILED' });
    const items = await new InventoryRepository(target).listItems();
    expect(items.map(i => i.name)).toEqual(['Intact']);
  });
});

describe('encodages', () => {
  it('fait l’aller-retour base64 et UTF-8', () => {
    for (const length of [0, 1, 2, 3, 4, 31, 255]) {
      const bytes = new Uint8Array(randomBytes(length));
      expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes);
      expect(bytesToBase64(bytes)).toBe(Buffer.from(bytes).toString('base64'));
    }
    // Gros volumes et bords de blocs (encodage par paquets de 24 576 octets).
    for (const length of [24575, 24576, 24577, 49153, 5_000_000]) {
      const bytes = new Uint8Array(randomBytes(length));
      const encoded = bytesToBase64(bytes);
      expect(encoded).toBe(Buffer.from(bytes).toString('base64'));
      expect(base64ToBytes(encoded)).toEqual(bytes);
    }
    expect(() => base64ToBytes('AB*D')).toThrow('Base64 invalide');
    expect(() => base64ToBytes('AB=D')).toThrow('Base64 invalide');
    expect(() => base64ToBytes('ABCDE')).toThrow('Base64 invalide');
    const text = 'Sac de Léa · 🎒 « eau » ½';
    expect(utf8ToText(new Uint8Array(Buffer.from(text, 'utf8')))).toBe(text);
  });
});
