import { randomBytes } from 'crypto';

import type { RandomSource } from '../../src/crypto/types';
import { prepareDatabase } from '../../src/db/connection';
import { InventoryRepository } from '../../src/inventory';
import {
  getDeviceId,
  hostInvite,
  joinFromInvite,
  lastSyncedAt,
  listPeers,
  serviceName,
  syncWithPeer,
  type ExchangeContext,
} from '../../src/sync';
import { NodeSqliteDb } from '../db/sqlite';
import { FakeWifi } from './fakeNetwork';

const random: RandomSource = { bytes: n => new Uint8Array(randomBytes(n)) };
const OPTIONS = { weapons: false, photos: false };

async function phone(prefix: string) {
  const db = new NodeSqliteDb();
  await prepareDatabase(db);
  let n = 0;
  return {
    db,
    ctx: { db, random } as ExchangeContext,
    repo: new InventoryRepository(db, {
      newId: () => `${prefix}-${++n}`,
      today: () => '2026-10-21',
    }),
  };
}

describe('partage du foyer sur le Wi-Fi', () => {
  it('associe par QR code puis se resynchronise par découverte', async () => {
    const wifi = new FakeWifi();
    const [a, b] = [await phone('a'), await phone('b')];
    const [netA, netB] = [
      wifi.phone('192.168.1.20'),
      wifi.phone('192.168.1.21'),
    ];
    const water = await a.repo.createItem(
      { name: 'Eau', category: 'water', unit: 'L' },
      { quantity: 30 },
    );

    // A affiche le QR code ; B le « scanne » (texte) et se connecte.
    const hosting = await hostInvite(a.ctx, netA, OPTIONS);
    expect(hosting.text).toMatch(/^FENRIR1\./);
    const [joined, hosted] = await Promise.all([
      joinFromInvite(b.ctx, netB, hosting.text),
      hosting.done,
    ]);
    expect(joined.paired && hosted.paired).toBe(true);
    expect((await b.repo.listItems()).map(i => i.name)).toEqual(['Eau']);

    // Ensuite : les deux ouvrent le partage, ils se trouvent tout seuls.
    await a.repo.consume(water.id, 2);
    await b.repo.consume(water.id, 3);
    const [peerOfA] = await listPeers(a.db);
    const [peerOfB] = await listPeers(b.db);
    const [ra, rb] = await Promise.all([
      syncWithPeer(a.ctx, netA, peerOfA, 2000),
      syncWithPeer(b.ctx, netB, peerOfB, 2000),
    ]);
    expect(ra.peer.device).toBe(await getDeviceId(b.db));
    expect(rb.peer.device).toBe(await getDeviceId(a.db));
    for (const p of [a, b]) {
      expect((await p.repo.listItems())[0].totalQuantity).toBe(25);
    }
    expect(await lastSyncedAt(a.db, peerOfA.device)).toMatch(/^\d{4}-/);
  });

  it('annonce un nom qui ne révèle ni l’application ni le téléphone', async () => {
    const key = new Uint8Array(32).fill(7);
    const name = serviceName(key, 'abcdef0123456789');
    expect(name).toMatch(/^fnr-[0-9a-f]{12}$/);
    expect(name).not.toContain('abcdef');
    expect(serviceName(key, 'autre')).not.toBe(name);
  });

  it('prévient si l’autre téléphone reste introuvable', async () => {
    const wifi = new FakeWifi();
    const [a, b] = [await phone('a'), await phone('b')];
    const hosting = await hostInvite(a.ctx, wifi.phone('10.0.0.1'), OPTIONS);
    await Promise.all([
      joinFromInvite(b.ctx, wifi.phone('10.0.0.2'), hosting.text),
      hosting.done,
    ]);
    const [peer] = await listPeers(a.db);
    await expect(
      syncWithPeer(a.ctx, new FakeWifi().phone('10.0.0.1'), peer, 50),
    ).rejects.toThrow(/introuvable/);
  });

  it('refuse un QR code dont le téléphone est injoignable', async () => {
    const wifi = new FakeWifi();
    const [a, b] = [await phone('a'), await phone('b')];
    const hosting = await hostInvite(a.ctx, wifi.phone('10.0.0.1'), OPTIONS);
    hosting.cancel();
    await expect(hosting.done).rejects.toThrow();
    await expect(
      joinFromInvite(b.ctx, wifi.phone('10.0.0.2'), hosting.text),
    ).rejects.toThrow(/injoignable/);
  });
});
