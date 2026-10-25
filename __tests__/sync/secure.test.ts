import { randomBytes } from 'crypto';

import type { RandomSource } from '../../src/crypto/types';
import { prepareDatabase } from '../../src/db/connection';
import { InventoryRepository } from '../../src/inventory';
import {
  applyRemoteChanges,
  completePairing,
  createInvite,
  decodeInvite,
  exportChanges,
  forgetPeer,
  fromBase64Url,
  getDeviceId,
  getPeer,
  initiate,
  listPeers,
  loadIdentity,
  pendingInvite,
  readHello,
  respond,
  SecureError,
  toBase64Url,
} from '../../src/sync';
import { NodeSqliteDb } from '../db/sqlite';

const random: RandomSource = { bytes: n => new Uint8Array(randomBytes(n)) };
const OPTIONS = { weapons: false, photos: true };
/** Ce qui passe réellement sur le réseau : du JSON. */
const wire = <T>(x: T): unknown => JSON.parse(JSON.stringify(x));

async function phone() {
  const db = new NodeSqliteDb();
  await prepareDatabase(db);
  return db;
}

/** Association complète : A affiche le QR code, B le scanne. */
async function pair() {
  const [a, b] = [await phone(), await phone()];
  const { text } = await createInvite(a, OPTIONS, random);
  const invite = decodeInvite(text, Date.now());
  const initiator = initiate({
    device: await getDeviceId(b),
    identity: await loadIdentity(b, random),
    peerIdentity: invite.identity,
    mode: { kind: 'pair', secret: invite.secret },
    random,
  });
  const hello = readHello(wire(initiator.hello));
  const pending = await pendingInvite(a);
  const responder = respond({
    device: await getDeviceId(a),
    identity: await loadIdentity(a, random),
    hello,
    mode: { kind: 'pair', secret: pending!.secret },
    random,
  });
  const { finish, session: sb } = initiator.finish(wire(responder.reply));
  const sa = responder.accept(wire(finish));
  await completePairing(a, sa, pending!.options);
  await completePairing(b, sb, invite.options);
  return { a, b, sa, sb, text };
}

/** Échange suivant, entre téléphones déjà associés (B se connecte à A). */
async function connect(a: NodeSqliteDb, b: NodeSqliteDb) {
  const [idA, idB] = [await getDeviceId(a), await getDeviceId(b)];
  const peerOfB = (await getPeer(b, idA))!;
  const initiator = initiate({
    device: idB,
    identity: await loadIdentity(b, random),
    peerIdentity: peerOfB.identity,
    mode: { kind: 'sync', pairKey: peerOfB.pairKey },
    random,
  });
  const hello = readHello(wire(initiator.hello));
  const known = (await getPeer(a, hello.device))!;
  const responder = respond({
    device: idA,
    identity: await loadIdentity(a, random),
    hello,
    mode: { kind: 'sync', pairKey: known.pairKey },
    expectedIdentity: known.identity,
    random,
  });
  const { finish, session: sb } = initiator.finish(wire(responder.reply));
  return { sa: responder.accept(wire(finish)), sb };
}

const codeOf = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return (e as { code?: string }).code;
  }
  return 'no error';
};

describe('base64 URL', () => {
  it('correspond à l’encodage standard, toutes longueurs', () => {
    for (let n = 0; n < 50; n++) {
      const bytes = random.bytes(n);
      const text = toBase64Url(bytes);
      expect(text).toBe(Buffer.from(bytes).toString('base64url'));
      expect(Array.from(fromBase64Url(text))).toEqual(Array.from(bytes));
    }
    expect(() => fromBase64Url('a+b/')).toThrow();
  });
});

describe('association par QR code', () => {
  it('associe les deux téléphones avec les mêmes clés', async () => {
    const { a, b, sa, sb, text } = await pair();
    expect(text).toMatch(/^FENRIR1\./);
    expect(text.length).toBeLessThan(160);
    const [pa, pb] = [(await listPeers(a))[0], (await listPeers(b))[0]];
    expect(pa.device).toBe(await getDeviceId(b));
    expect(pb.device).toBe(await getDeviceId(a));
    expect(toBase64Url(pa.pairKey)).toBe(toBase64Url(pb.pairKey));
    expect(pa.options).toEqual(OPTIONS);
    expect(pb.options).toEqual(OPTIONS);
    // Invitation à usage unique.
    expect(await pendingInvite(a)).toBeNull();
    expect(sb.open(sa.seal({ bonjour: 'B' }))).toEqual({ bonjour: 'B' });
    expect(sa.open(sb.seal({ bonjour: 'A' }))).toEqual({ bonjour: 'A' });
  });

  it('refuse un QR code expiré ou étranger', async () => {
    const db = await phone();
    const { text, invite } = await createInvite(db, OPTIONS, random, 1000);
    expect(codeOf(() => decodeInvite(text, invite.expires + 1))).toBe(
      'INVITE_EXPIRED',
    );
    expect(await pendingInvite(db, invite.expires + 1)).toBeNull();
    for (const bad of [
      'https://exemple.fr',
      'FENRIR1.zz.a.b.-.1',
      text.replace('FENRIR1', 'FENRIR2'),
      `${text}.extra`,
    ]) {
      expect(codeOf(() => decodeInvite(bad, 0))).toBe('INVALID_INVITE');
    }
  });

  it('refuse un téléphone qui n’a pas lu le QR code', async () => {
    const [a, intruder] = [await phone(), await phone()];
    const { invite } = await createInvite(a, OPTIONS, random);
    const guess = initiate({
      device: await getDeviceId(intruder),
      identity: await loadIdentity(intruder, random),
      peerIdentity: invite.identity, // clé publique : pas secrète
      mode: { kind: 'pair', secret: random.bytes(32) },
      random,
    });
    expect(
      codeOf(() =>
        respond({
          device: invite.device,
          identity: { secretKey: random.bytes(32), publicKey: invite.identity },
          hello: readHello(wire(guess.hello)),
          mode: { kind: 'pair', secret: invite.secret },
          random,
        }),
      ),
    ).toBe('AUTH_FAILED');
  });

  it('détecte un faux téléphone qui répond à la place du vrai', async () => {
    const [a, b] = [await phone(), await phone()];
    const { text } = await createInvite(a, OPTIONS, random);
    const invite = decodeInvite(text, Date.now());
    const initiator = initiate({
      device: await getDeviceId(b),
      identity: await loadIdentity(b, random),
      peerIdentity: invite.identity,
      mode: { kind: 'pair', secret: invite.secret },
      random,
    });
    // Pire cas : un tiers a aperçu le QR code (secret compris), mais n'a
    // pas la clé d'identité secrète de A, qui ne quitte jamais le coffre.
    const fake = respond({
      device: invite.device,
      identity: { secretKey: random.bytes(32), publicKey: invite.identity },
      hello: readHello(wire(initiator.hello)),
      mode: { kind: 'pair', secret: invite.secret },
      random,
    });
    expect(codeOf(() => initiator.finish(wire(fake.reply)))).toBe(
      'AUTH_FAILED',
    );
  });
});

describe('échanges chiffrés', () => {
  it('se reconnectent sans QR code et chiffrent les données de stock', async () => {
    const { a, b } = await pair();
    const repo = new InventoryRepository(a);
    await repo.createItem(
      { name: 'Eau minérale', category: 'water', unit: 'L' },
      { quantity: 30 },
    );
    const { sa, sb } = await connect(a, b);
    const frame = sa.seal(await exportChanges(a, OPTIONS));
    // Le nom complet en clair ne doit pas apparaître. Un mot court (« Eau »)
    // peut sortir par hasard d'un chiffré aléatoire : on cherche le nom entier.
    expect(frame).not.toContain('Eau minérale');
    const bytes = Buffer.from(fromBase64Url(frame));
    expect(bytes.toString('utf8')).not.toContain('Eau minérale');
    expect(bytes.toString('latin1')).not.toContain('Eau min');
    const report = await applyRemoteChanges(b, sb.open(frame), OPTIONS);
    expect(report.written).toBeGreaterThan(0);
    const items = await new InventoryRepository(b).listItems();
    expect(items.map(i => i.name)).toEqual(['Eau minérale']);
  });

  it('refuse un message modifié, rejoué ou dans le désordre', async () => {
    const { sa, sb } = await pair();
    const first = sa.seal({ n: 1 });
    const second = sa.seal({ n: 2 });
    const bytes = fromBase64Url(first);
    bytes[3] = (bytes[3] + 1) % 256; // octet chiffré altéré
    expect(codeOf(() => sb.open(toBase64Url(bytes)))).toBe('TAMPERED');
    expect(codeOf(() => sb.open(second))).toBe('TAMPERED'); // désordre
    expect(sb.open(first)).toEqual({ n: 1 });
    expect(codeOf(() => sb.open(first))).toBe('TAMPERED'); // rejeu
    expect(sb.open(second)).toEqual({ n: 2 });
    // Un message d'un sens ne peut pas être renvoyé dans l'autre.
    const back = sb.seal({ n: 3 });
    expect(codeOf(() => sb.open(back))).toBe('TAMPERED');
  });

  it('chaque échange a ses propres clés', async () => {
    const { a, b } = await pair();
    const one = await connect(a, b);
    const two = await connect(a, b);
    const frame = one.sa.seal({ secret: 1 });
    expect(codeOf(() => two.sb.open(frame))).toBe('TAMPERED');
    expect(one.sb.open(frame)).toEqual({ secret: 1 });
  });

  it('refuse un téléphone inconnu ou dissocié', async () => {
    const { a, b } = await pair();
    const stranger = await phone();
    const strangerIdentity = await loadIdentity(stranger, random);
    const hello = initiate({
      device: await getDeviceId(stranger),
      identity: strangerIdentity,
      peerIdentity: (await loadIdentity(a, random)).publicKey,
      mode: { kind: 'sync', pairKey: random.bytes(32) },
      random,
    }).hello;
    expect(
      codeOf(() =>
        respond({
          device: 'a1',
          identity: {
            secretKey: random.bytes(32),
            publicKey: random.bytes(32),
          },
          hello: readHello(wire(hello)),
          mode: { kind: 'sync', pairKey: random.bytes(32) },
          expectedIdentity: undefined,
          random,
        }),
      ),
    ).toBe('AUTH_FAILED');

    await forgetPeer(a, await getDeviceId(b));
    expect(await getPeer(a, await getDeviceId(b))).toBeNull();
    await expect(connect(a, b)).rejects.toThrow();
  });

  it('refuse les messages mal formés', () => {
    expect(codeOf(() => readHello({ v: 'autre' }))).toBe('INVALID_MESSAGE');
    expect(
      codeOf(() =>
        readHello({
          v: 'fenrir-sync-1',
          mode: 'sync',
          device: 'ab',
          id: 'x',
          eph: 'y',
        }),
      ),
    ).toBe('INVALID_MESSAGE');
    expect(new SecureError('TAMPERED', 'x')).toBeInstanceOf(Error);
  });
});
