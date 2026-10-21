/**
 * Déroulé d'un échange entre deux téléphones, sur un canal déjà ouvert :
 *
 * 1. Poignée de main (en clair, mais sans secret) : association par QR code
 *    la première fois, reconnaissance des clés ensuite.
 * 2. Tout le reste est chiffré : options de partage, puis envoi des
 *    modifications dans les deux sens, fusion, accusés de réception.
 *
 * Le partage retenu est l'intersection des options des deux téléphones :
 * l'armement ou les photos ne passent que si les deux l'acceptent.
 */
import type { RandomSource } from '../crypto/types';
import type { SqlDatabase } from '../db/types';
import type { Channel } from './channel';
import {
  completePairing,
  decodeInvite,
  getPeer,
  loadIdentity,
  pendingInvite,
  PairingError,
  type Peer,
} from './pairing';
import {
  initiate,
  readHello,
  respond,
  SecureError,
  type SecureSession,
} from './secure';
import {
  applyRemoteChanges,
  exportChanges,
  getDeviceId,
  getPeerClock,
  type SyncOptions,
  type SyncPayload,
  type SyncReport,
} from './store';

/** Délais : poignée de main courte, envoi complet (photos) plus long. */
const HANDSHAKE_MS = 30_000;
const TRANSFER_MS = 180_000;

export interface ExchangeResult {
  peer: Peer;
  /** Première association avec ce téléphone. */
  paired: boolean;
  /** Ce qui a été reçu et appliqué ici. */
  received: SyncReport;
  /** Lignes envoyées à l'autre téléphone. */
  sent: number;
  /** Partage retenu pour cet échange. */
  options: SyncOptions;
}

export interface ExchangeContext {
  db: SqlDatabase;
  random: RandomSource;
  now?: () => number;
}

async function receiveJson(channel: Channel, timeoutMs: number) {
  const text = await channel.receive(timeoutMs);
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new SecureError('INVALID_MESSAGE', 'Message illisible');
  }
}

const sendJson = (channel: Channel, value: unknown) =>
  channel.send(JSON.stringify(value));

/** Message chiffré suivant, du type attendu. */
async function receiveSealed(
  channel: Channel,
  session: SecureSession,
  type: string,
  timeoutMs: number,
): Promise<Record<string, unknown>> {
  const frame = await receiveJson(channel, timeoutMs);
  const sealed = (frame as { f?: unknown })?.f;
  if (typeof sealed !== 'string') {
    throw new SecureError('INVALID_MESSAGE', 'Message non chiffré');
  }
  const message = session.open(sealed) as Record<string, unknown> | null;
  if (message?.t === 'error') {
    throw new SecureError(
      'INVALID_MESSAGE',
      `L’autre téléphone a interrompu l’échange : ${String(message.message)}`,
    );
  }
  if (message?.t !== type) {
    throw new SecureError('INVALID_MESSAGE', 'Message inattendu');
  }
  return message;
}

const sendSealed = (
  channel: Channel,
  session: SecureSession,
  message: Record<string, unknown>,
) => sendJson(channel, { f: session.seal(message) });

function readOptions(value: unknown): SyncOptions {
  const o = value as Partial<SyncOptions> | null;
  return { weapons: o?.weapons === true, photos: o?.photos === true };
}

async function lastOptions(
  db: SqlDatabase,
  device: string,
): Promise<SyncOptions | null> {
  const { rows } = await db.execute(
    'SELECT value FROM sync_meta WHERE key = ?',
    [`peer_options:${device}`],
  );
  if (rows.length === 0) {
    return null;
  }
  try {
    return readOptions(JSON.parse(String(rows[0].value)));
  } catch {
    return null;
  }
}

async function saveOptions(
  db: SqlDatabase,
  device: string,
  options: SyncOptions,
) {
  await db.execute(
    `INSERT INTO sync_meta (key, value) VALUES (?, ?)
     ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
    [`peer_options:${device}`, JSON.stringify(options)],
  );
}

/** Échange chiffré des modifications, une fois les clés établies. */
async function transfer(
  ctx: ExchangeContext,
  channel: Channel,
  session: SecureSession,
  peer: Peer,
  paired: boolean,
): Promise<ExchangeResult> {
  const { db } = ctx;
  const now = ctx.now ?? Date.now;
  try {
    await sendSealed(channel, session, { t: 'options', options: peer.options });
    const theirs = readOptions(
      (await receiveSealed(channel, session, 'options', HANDSHAKE_MS)).options,
    );
    const options: SyncOptions = {
      weapons: peer.options.weapons && theirs.weapons,
      photos: peer.options.photos && theirs.photos,
    };
    // Partage élargi depuis le dernier échange : tout renvoyer, les lignes
    // écartées jusque-là étant antérieures au dernier relevé.
    const last = await lastOptions(db, peer.device);
    const widened =
      last === null ||
      (options.weapons && !last.weapons) ||
      (options.photos && !last.photos);
    await sendSealed(channel, session, {
      t: 'want',
      since: widened ? null : await getPeerClock(db, peer.device),
    });
    const want = await receiveSealed(channel, session, 'want', HANDSHAKE_MS);
    const since = typeof want.since === 'string' ? want.since : null;

    const sent: SyncPayload = await exportChanges(db, options, since, now());
    await sendSealed(channel, session, { t: 'changes', payload: sent });
    const incoming = await receiveSealed(
      channel,
      session,
      'changes',
      TRANSFER_MS,
    );
    let received: SyncReport;
    try {
      received = await applyRemoteChanges(db, incoming.payload, {
        ...options,
        sent,
        now: now(),
      });
    } catch (error) {
      await sendSealed(channel, session, {
        t: 'error',
        message: error instanceof Error ? error.message : 'Erreur',
      }).catch(() => undefined);
      throw error;
    }
    await sendSealed(channel, session, { t: 'ack', written: received.written });
    await receiveSealed(channel, session, 'ack', TRANSFER_MS);
    await saveOptions(db, peer.device, options);
    await db.execute(
      `INSERT INTO sync_meta (key, value) VALUES (?, ?)
       ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
      [`peer_synced_at:${peer.device}`, new Date(now()).toISOString()],
    );
    return { peer, paired, received, sent: sent.rows.length, options };
  } finally {
    session.close();
  }
}

/** Téléphone qui scanne le QR code : association puis premier échange. */
export async function joinWithInvite(
  ctx: ExchangeContext,
  channel: Channel,
  inviteText: string,
): Promise<ExchangeResult> {
  const { db, random } = ctx;
  const now = ctx.now ?? Date.now;
  const invite = decodeInvite(inviteText, now());
  const initiator = initiate({
    device: await getDeviceId(db),
    identity: await loadIdentity(db, random),
    peerIdentity: invite.identity,
    mode: { kind: 'pair', secret: invite.secret },
    random,
  });
  await sendJson(channel, initiator.hello);
  const { finish, session } = initiator.finish(
    await receiveJson(channel, HANDSHAKE_MS),
  );
  if (session.peer.device !== invite.device) {
    session.close();
    throw new SecureError('AUTH_FAILED', 'Ce n’est pas le téléphone attendu.');
  }
  await sendJson(channel, finish);
  const peer = await completePairing(db, session, invite.options);
  return transfer(ctx, channel, session, peer, true);
}

/** Téléphone déjà associé qui se connecte à l'autre. */
export async function connectToPeer(
  ctx: ExchangeContext,
  channel: Channel,
  peer: Peer,
): Promise<ExchangeResult> {
  const { db, random } = ctx;
  const initiator = initiate({
    device: await getDeviceId(db),
    identity: await loadIdentity(db, random),
    peerIdentity: peer.identity,
    mode: { kind: 'sync', pairKey: peer.pairKey },
    random,
  });
  await sendJson(channel, initiator.hello);
  const { finish, session } = initiator.finish(
    await receiveJson(channel, HANDSHAKE_MS),
  );
  await sendJson(channel, finish);
  return transfer(ctx, channel, session, peer, false);
}

/**
 * Téléphone qui attend : accepte l'association en cours (QR code affiché)
 * ou un téléphone déjà associé. Refuse tout autre appareil.
 */
export async function acceptConnection(
  ctx: ExchangeContext,
  channel: Channel,
): Promise<ExchangeResult> {
  const { db, random } = ctx;
  const now = ctx.now ?? Date.now;
  const hello = readHello(await receiveJson(channel, HANDSHAKE_MS));
  const device = await getDeviceId(db);
  const identity = await loadIdentity(db, random);

  if (hello.mode === 'pair') {
    const invite = await pendingInvite(db, now());
    if (!invite) {
      throw new PairingError(
        'NO_INVITE',
        'Aucun QR code en cours : affichez-en un sur ce téléphone.',
      );
    }
    const responder = respond({
      device,
      identity,
      hello,
      mode: { kind: 'pair', secret: invite.secret },
      random,
    });
    await sendJson(channel, responder.reply);
    const session = responder.accept(await receiveJson(channel, HANDSHAKE_MS));
    const peer = await completePairing(db, session, invite.options);
    return transfer(ctx, channel, session, peer, true);
  }

  const known = await getPeer(db, hello.device);
  if (!known) {
    throw new SecureError('AUTH_FAILED', 'Téléphone inconnu.');
  }
  const responder = respond({
    device,
    identity,
    hello,
    mode: { kind: 'sync', pairKey: known.pairKey },
    expectedIdentity: known.identity,
    random,
  });
  await sendJson(channel, responder.reply);
  const session = responder.accept(await receiveJson(channel, HANDSHAKE_MS));
  return transfer(ctx, channel, session, known, false);
}
