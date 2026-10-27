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
  clearResendAll,
  exportChanges,
  getDeviceId,
  getPeerClock,
  mustResendAll,
  type SyncOptions,
  type SyncPayload,
  type SyncReport,
} from './store';

/** Délais : poignée de main courte, envoi complet (photos) plus long. */
const HANDSHAKE_MS = 30_000;
const TRANSFER_MS = 180_000;

/**
 * Taille visée d'un paquet de modifications (JSON, en caractères). Une fois
 * chiffré et encodé, il reste bien sous la limite de 64 Mo par message du
 * réseau, même avec beaucoup de pages de documents.
 */
export const PART_CHARS = 8_000_000;
/** Garde-fou : nombre de paquets annoncé accepté. */
const MAX_PARTS = 10_000;

/**
 * Découpe un envoi en paquets d'environ `budget` caractères, sans couper une
 * ligne. Chaque paquet garde l'en-tête (format, appareil, horloge).
 */
export function splitPayload(
  payload: SyncPayload,
  budget: number = PART_CHARS,
): SyncPayload[] {
  const parts: SyncPayload[] = [];
  let rows: SyncPayload['rows'] = [];
  let size = 0;
  for (const row of payload.rows) {
    const length = JSON.stringify(row).length;
    if (rows.length > 0 && size + length > budget) {
      parts.push({ ...payload, rows });
      rows = [];
      size = 0;
    }
    rows.push(row);
    size += length;
  }
  parts.push({ ...payload, rows });
  return parts;
}

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
  /** Taille des paquets envoyés (tests). */
  partChars?: number;
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

/**
 * Modifications de l'autre téléphone, en un ou plusieurs paquets, remises
 * en un seul envoi (validé ensuite comme un tout).
 */
async function receiveChanges(
  channel: Channel,
  session: SecureSession,
): Promise<unknown> {
  const first = await receiveSealed(channel, session, 'changes', TRANSFER_MS);
  const total = first.parts === undefined ? 1 : Number(first.parts);
  if (!Number.isInteger(total) || total < 1 || total > MAX_PARTS) {
    throw new SecureError('INVALID_MESSAGE', 'Envoi découpé invalide');
  }
  if (total === 1) {
    return first.payload;
  }
  const head = first.payload as { rows?: unknown } | null;
  const rows: unknown[] = Array.isArray(head?.rows) ? [...head.rows] : [];
  for (let i = 1; i < total; i++) {
    const next = await receiveSealed(channel, session, 'changes', TRANSFER_MS);
    const part = next.payload as { rows?: unknown } | null;
    if (next.part !== i || !Array.isArray(part?.rows)) {
      throw new SecureError('INVALID_MESSAGE', 'Paquet manquant ou désordonné');
    }
    rows.push(...part.rows);
  }
  return { ...(first.payload as object), rows };
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
    // Après une restauration de sauvegarde ici : tout renvoyer.
    const resend = await mustResendAll(db, peer.device);
    const since = !resend && typeof want.since === 'string' ? want.since : null;

    const sent: SyncPayload = await exportChanges(db, options, since, now());
    // Un seul paquet : message identique à celui des versions précédentes.
    const parts = splitPayload(sent, ctx.partChars);
    for (const [i, part] of parts.entries()) {
      await sendSealed(
        channel,
        session,
        parts.length === 1
          ? { t: 'changes', payload: part }
          : { t: 'changes', payload: part, part: i, parts: parts.length },
      );
    }
    const incoming = await receiveChanges(channel, session);
    let received: SyncReport;
    try {
      received = await applyRemoteChanges(db, incoming, {
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
    if (resend) {
      await clearResendAll(db, peer.device);
    }
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
