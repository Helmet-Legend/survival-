import { randomBytes } from 'crypto';

import { createBackup, restoreBackup } from '../../src/backup/backup';

import type { RandomSource } from '../../src/crypto/types';
import { prepareDatabase } from '../../src/db/connection';
import { ArmoryRepository, InventoryRepository } from '../../src/inventory';
import {
  acceptConnection,
  connectToPeer,
  createInvite,
  decodeInvite,
  getDeviceId,
  getPeer,
  joinWithInvite,
  memoryChannelPair,
  mustResendAll,
  splitPayload,
  updatePeerOptions,
  type Channel,
  type ExchangeContext,
} from '../../src/sync';
import { JsArgon2, TEST_ARGON2_PARAMS } from '../crypto/fakes';
import { NodeSqliteDb } from '../db/sqlite';

const random: RandomSource = { bytes: n => new Uint8Array(randomBytes(n)) };

async function phone(prefix: string) {
  const db = new NodeSqliteDb();
  await prepareDatabase(db);
  let n = 0;
  const newId = () => `${prefix}-${++n}`;
  const today = () => '2026-10-21';
  return {
    db,
    ctx: { db, random } as ExchangeContext,
    repo: new InventoryRepository(db, { newId, today }),
    armory: new ArmoryRepository(db, { newId, today }),
  };
}

type Phone = Awaited<ReturnType<typeof phone>>;

async function names(p: Phone) {
  return (await p.repo.listItems()).map(i => i.name).sort();
}

/** Association : A affiche le QR code, B le scanne. */
async function pair(a: Phone, b: Phone, weapons = false) {
  const { text } = await createInvite(
    a.db,
    { weapons, photos: false },
    random,
    Date.now(),
    ['192.168.1.20:41234'],
  );
  const [chA, chB] = memoryChannelPair();
  const [atA, atB] = await Promise.all([
    acceptConnection(a.ctx, chA),
    joinWithInvite(b.ctx, chB, text),
  ]);
  return { atA, atB, text };
}

/** B se reconnecte à A (déjà associés). */
async function sync(a: Phone, b: Phone) {
  const peerOfB = (await getPeer(b.db, await getDeviceId(a.db)))!;
  const [chA, chB] = memoryChannelPair();
  const [atA, atB] = await Promise.all([
    acceptConnection(a.ctx, chA),
    connectToPeer(b.ctx, chB, peerOfB),
  ]);
  return { atA, atB };
}

describe('envoi en plusieurs paquets', () => {
  const row = (key: string, text: string) => ({
    table: 'inventory_items',
    key,
    hlc: '0000000000001:0000:aa',
    deleted: false,
    weapon: false,
    base: null,
    data: { id: key, name: text },
  });
  const payload = (rows: ReturnType<typeof row>[]) => ({
    format: 1,
    device: 'aa',
    clock: '0000000000001:0000:aa',
    rows,
  });

  it('garde un seul paquet quand l’envoi est petit', () => {
    const p = payload([row('1', 'Eau'), row('2', 'Riz')]);
    expect(splitPayload(p)).toEqual([p]);
    expect(splitPayload(payload([]))).toEqual([payload([])]);
  });

  it('découpe un gros envoi sans couper de ligne ni perdre l’en-tête', () => {
    const rows = Array.from({ length: 10 }, (_, i) =>
      row(String(i), 'x'.repeat(100)),
    );
    const parts = splitPayload(payload(rows), 400);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.flatMap(p => p.rows)).toEqual(rows);
    for (const part of parts) {
      expect(part.clock).toBe('0000000000001:0000:aa');
      expect(part.rows.length).toBeGreaterThan(0);
    }
    // Une ligne plus grosse que le budget part seule.
    expect(
      splitPayload(payload([row('big', 'x'.repeat(1000))]), 10),
    ).toHaveLength(1);
  });

  it('réunit deux stocks envoyés en petits paquets', async () => {
    const [a, b] = [await phone('a'), await phone('b')];
    a.ctx.partChars = 300;
    b.ctx.partChars = 300;
    for (let i = 0; i < 25; i++) {
      await a.repo.createItem({
        name: `Conserve ${String(i).padStart(2, '0')}`,
        category: 'food',
        unit: 'unit',
      });
    }
    await b.repo.createItem({ name: 'Lampe', category: 'tool', unit: 'unit' });
    await pair(a, b);
    expect(await names(b)).toEqual(await names(a));
    expect(await names(b)).toHaveLength(26);
    // Un téléphone qui envoie en un seul paquet reste compris.
    b.ctx.partChars = undefined;
    await b.repo.createItem({ name: 'Radio', category: 'tool', unit: 'unit' });
    await sync(a, b);
    expect(await names(a)).toContain('Radio');
  });
});

describe('échange entre deux téléphones', () => {
  it('associe par QR code et réunit les deux stocks', async () => {
    const [a, b] = [await phone('a'), await phone('b')];
    await a.repo.createItem(
      { name: 'Eau', category: 'water', unit: 'L' },
      { quantity: 30 },
    );
    await b.repo.createItem({ name: 'Lampe', category: 'tool', unit: 'unit' });

    const { atA, atB, text } = await pair(a, b);
    expect(decodeInvite(text, Date.now()).addresses).toEqual([
      '192.168.1.20:41234',
    ]);
    expect(atA.paired && atB.paired).toBe(true);
    expect(atA.peer.device).toBe(await getDeviceId(b.db));
    expect(atB.peer.device).toBe(await getDeviceId(a.db));
    expect(await names(a)).toEqual(['Eau', 'Lampe']);
    expect(await names(b)).toEqual(['Eau', 'Lampe']);
  });

  it('se resynchronise ensuite sans QR code', async () => {
    const [a, b] = [await phone('a'), await phone('b')];
    const water = await a.repo.createItem(
      { name: 'Eau', category: 'water', unit: 'L' },
      { quantity: 30 },
    );
    await pair(a, b);
    await a.repo.consume(water.id, 2);
    await b.repo.consume(water.id, 3);
    const { atA, atB } = await sync(a, b);
    expect(atA.paired || atB.paired).toBe(false);
    for (const p of [a, b]) {
      expect((await p.repo.listItems())[0].totalQuantity).toBe(25);
    }
    // Rien de neuf : l'échange suivant n'envoie que l'essentiel.
    const again = await sync(a, b);
    expect(again.atA.received.written + again.atB.received.written).toBe(0);
  });

  it('ne partage l’armement que si les deux téléphones l’acceptent', async () => {
    const [a, b] = [await phone('a'), await phone('b')];
    await a.armory.createWeapon({
      model: 'Carabine',
      kind: 'rifle',
      caliber: '.22 LR',
    });
    // Armement proposé dans le QR code : partagé dès l'association.
    await pair(a, b, true);
    expect((await b.armory.listWeapons()).length).toBe(1);

    const [a2, b2] = [await phone('c'), await phone('d')];
    await a2.armory.createWeapon({
      model: 'Fusil',
      kind: 'shotgun',
      caliber: '12/70',
    });
    await pair(a2, b2, false);
    expect((await b2.armory.listWeapons()).length).toBe(0);
    // Les deux l'activent : envoi complet, l'arme arrive.
    await updatePeerOptions(a2.db, await getDeviceId(b2.db), {
      weapons: true,
      photos: false,
    });
    await updatePeerOptions(b2.db, await getDeviceId(a2.db), {
      weapons: true,
      photos: false,
    });
    const { atB } = await sync(a2, b2);
    expect(atB.options.weapons).toBe(true);
    expect((await b2.armory.listWeapons()).length).toBe(1);
  });

  it('refuse un téléphone inconnu et une association sans QR code', async () => {
    const [a, b] = [await phone('a'), await phone('b')];
    await pair(a, b);
    const stranger = await phone('x');
    const fakePeer = {
      ...(await getPeer(b.db, await getDeviceId(a.db)))!,
    };
    const attempt = async (run: (ch: Channel) => Promise<unknown>) => {
      const [chA, chX] = memoryChannelPair();
      const accepted = acceptConnection(a.ctx, chA).catch(e => {
        chA.close();
        return e;
      });
      const other = run(chX).catch(e => e);
      return Promise.all([accepted, other]);
    };

    // Un autre téléphone qui se ferait passer pour B (sans ses clés).
    const [refused] = await attempt(ch =>
      connectToPeer(stranger.ctx, ch, fakePeer),
    );
    expect(refused.code).toBe('AUTH_FAILED');

    // Association alors qu'aucun QR code n'est affiché sur A.
    const { text } = await createInvite(
      stranger.db,
      { weapons: false, photos: false },
      random,
    );
    const forged = text.replace(text.split('.')[1], await getDeviceId(a.db));
    const [noInvite] = await attempt(ch =>
      joinWithInvite(stranger.ctx, ch, forged),
    );
    expect(noInvite.code).toBe('NO_INVITE');
  });
});

describe('restauration d’une sauvegarde sur un téléphone associé', () => {
  const PASSWORD = 'sauvegarde du foyer';
  const backup = (p: Phone) =>
    createBackup(p.db, PASSWORD, {
      engine: new JsArgon2(),
      random,
      params: TEST_ARGON2_PARAMS,
    });
  const restore = (p: Phone, text: string) =>
    restoreBackup(p.db, text, PASSWORD, new JsArgon2());
  const quantities = async (p: Phone) =>
    Object.fromEntries(
      (await p.repo.listItems()).map(i => [i.name, i.totalQuantity]),
    );

  it('n’efface ni ne remplace ce que l’autre téléphone a de plus récent', async () => {
    const a = await phone('a');
    const b = await phone('b');
    const riz = await a.repo.createItem(
      { name: 'Riz', category: 'food', unit: 'kg', caloriesPerUnit: 3600 },
      { quantity: 5 },
    );
    await pair(a, b);
    const { text } = await backup(a);

    // Après la sauvegarde, B ajoute du thon et mange 2 kg de riz ; A le
    // reçoit, puis restaure l'ancienne sauvegarde.
    await b.repo.createItem(
      { name: 'Thon', category: 'food', unit: 'unit', caloriesPerUnit: 200 },
      { quantity: 4 },
    );
    await b.repo.consume(riz.id, 2);
    await sync(a, b);
    await restore(a, text);
    expect(await quantities(a)).toEqual({ Riz: 5 });

    await sync(a, b);
    const expected = { Riz: 3, Thon: 4 };
    expect(await quantities(b)).toEqual(expected);
    expect(await quantities(a)).toEqual(expected);

    // L'envoi complet n'a lieu qu'une fois ; ensuite, échanges habituels.
    expect(await mustResendAll(a.db, await getDeviceId(b.db))).toBe(false);
    await b.repo.consume(riz.id, 1);
    await sync(a, b);
    expect(await quantities(a)).toEqual({ Riz: 2, Thon: 4 });
  });

  it('partage ce que seule la sauvegarde contient', async () => {
    const a = await phone('a');
    const b = await phone('b');
    await a.repo.createItem(
      { name: 'Riz', category: 'food', unit: 'kg', caloriesPerUnit: 3600 },
      { quantity: 5 },
    );
    await pair(a, b);
    // Les bougies, jamais partagées, sont perdues sur A puis retrouvées
    // par la restauration.
    const bougies = await a.repo.createItem(
      { name: 'Bougies', category: 'tool', unit: 'unit' },
      { quantity: 10 },
    );
    const { text } = await backup(a);
    await a.repo.deleteItem(bougies.id);
    await restore(a, text);

    await sync(a, b);
    const expected = { Riz: 5, Bougies: 10 };
    expect(await quantities(b)).toEqual(expected);
    expect(await quantities(a)).toEqual(expected);
  });
});
