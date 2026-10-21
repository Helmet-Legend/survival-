/**
 * Association des téléphones : identité de ce téléphone, invitation par QR
 * code et téléphones associés. Tout est rangé dans le coffre chiffré
 * (`sync_meta`), jamais dans les sauvegardes.
 */
import { bytesToHex, hexToBytes, isHex } from '../crypto/bytes';
import type { RandomSource } from '../crypto/types';
import { withTransaction } from '../db/transaction';
import type { SqlDatabase } from '../db/types';
import { fromBase64Url, toBase64Url } from './encoding';
import { keyPairFrom, type KeyPair, type SecureSession } from './secure';
import { getDeviceId, type SyncOptions } from './store';

/** Durée de validité d'un QR code d'association. */
export const INVITE_TTL_MS = 5 * 60 * 1000;
const PREFIX = 'FENRIR1';

export type PairingErrorCode =
  | 'INVALID_INVITE'
  | 'INVITE_EXPIRED'
  | 'NO_INVITE';

export class PairingError extends Error {
  constructor(readonly code: PairingErrorCode, message: string) {
    super(message);
    this.name = 'PairingError';
  }
}

/** Contenu du QR code. */
export interface Invite {
  device: string;
  identity: Uint8Array;
  secret: Uint8Array;
  options: SyncOptions;
  expires: number;
}

export interface Peer {
  device: string;
  identity: Uint8Array;
  pairKey: Uint8Array;
  options: SyncOptions;
  pairedAt: string;
}

async function getMeta(db: SqlDatabase, key: string) {
  const { rows } = await db.execute(
    'SELECT value FROM sync_meta WHERE key = ?',
    [key],
  );
  return rows.length > 0 ? String(rows[0].value) : null;
}

async function setMeta(db: SqlDatabase, key: string, value: string) {
  await db.execute(
    `INSERT INTO sync_meta (key, value) VALUES (?, ?)
     ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
    [key, value],
  );
}

// --- Identité -------------------------------------------------------------

/** Clé d'identité de ce téléphone, créée au premier besoin. */
export async function loadIdentity(
  db: SqlDatabase,
  random: RandomSource,
): Promise<KeyPair> {
  const stored = await getMeta(db, 'identity');
  if (stored !== null && isHex(stored, 32)) {
    return keyPairFrom(hexToBytes(stored));
  }
  const secretKey = random.bytes(32);
  await setMeta(db, 'identity', bytesToHex(secretKey));
  return keyPairFrom(secretKey);
}

// --- Invitation (QR code) -------------------------------------------------

function flags(o: SyncOptions): string {
  return `${o.weapons ? 'w' : ''}${o.photos ? 'p' : ''}` || '-';
}

export function encodeInvite(invite: Invite): string {
  return [
    PREFIX,
    invite.device,
    toBase64Url(invite.identity),
    toBase64Url(invite.secret),
    flags(invite.options),
    invite.expires.toString(36),
  ].join('.');
}

/** Lecture d'un QR code scanné ; refuse tout autre contenu. */
export function decodeInvite(text: string, now: number): Invite {
  const parts = text.trim().split('.');
  const invalid = () =>
    new PairingError(
      'INVALID_INVITE',
      'Ce QR code n’est pas un code d’association Fenrir.',
    );
  if (parts.length !== 6 || parts[0] !== PREFIX) {
    throw invalid();
  }
  const [, device, id, secret, opts, expires] = parts;
  let identity: Uint8Array;
  let key: Uint8Array;
  try {
    identity = fromBase64Url(id);
    key = fromBase64Url(secret);
  } catch {
    throw invalid();
  }
  const expiry = parseInt(expires, 36);
  if (
    !/^[0-9a-f]{1,32}$/.test(device) ||
    identity.length !== 32 ||
    key.length !== 32 ||
    !/^(-|w|p|wp)$/.test(opts) ||
    !Number.isFinite(expiry)
  ) {
    throw invalid();
  }
  if (expiry < now) {
    throw new PairingError(
      'INVITE_EXPIRED',
      'QR code expiré : affichez-en un nouveau sur l’autre téléphone.',
    );
  }
  return {
    device,
    identity,
    secret: key,
    options: { weapons: opts.includes('w'), photos: opts.includes('p') },
    expires: expiry,
  };
}

/**
 * Nouveau QR code d'association, valable 5 minutes et une seule fois. Il
 * remplace le précédent.
 */
export async function createInvite(
  db: SqlDatabase,
  options: SyncOptions,
  random: RandomSource,
  now: number = Date.now(),
): Promise<{ text: string; invite: Invite }> {
  const identity = await loadIdentity(db, random);
  const invite: Invite = {
    device: await getDeviceId(db),
    identity: identity.publicKey,
    secret: random.bytes(32),
    options,
    expires: now + INVITE_TTL_MS,
  };
  await setMeta(
    db,
    'invite',
    JSON.stringify({
      secret: bytesToHex(invite.secret),
      options,
      expires: invite.expires,
    }),
  );
  return { text: encodeInvite(invite), invite };
}

/** Invitation en cours (côté qui affiche le QR code), si encore valable. */
export async function pendingInvite(
  db: SqlDatabase,
  now: number = Date.now(),
): Promise<{ secret: Uint8Array; options: SyncOptions } | null> {
  const text = await getMeta(db, 'invite');
  if (text === null) {
    return null;
  }
  try {
    const stored = JSON.parse(text) as {
      secret: string;
      options: SyncOptions;
      expires: number;
    };
    if (stored.expires < now || !isHex(stored.secret, 32)) {
      return null;
    }
    return {
      secret: hexToBytes(stored.secret),
      options: {
        weapons: stored.options?.weapons === true,
        photos: stored.options?.photos === true,
      },
    };
  } catch {
    return null;
  }
}

export async function cancelInvite(db: SqlDatabase): Promise<void> {
  await db.execute("DELETE FROM sync_meta WHERE key = 'invite'");
}

// --- Téléphones associés --------------------------------------------------

interface StoredPeer {
  identity: string;
  pairKey: string;
  options: SyncOptions;
  pairedAt: string;
}

function toPeer(device: string, s: StoredPeer): Peer | null {
  if (!isHex(s.identity, 32) || !isHex(s.pairKey, 32)) {
    return null;
  }
  return {
    device,
    identity: hexToBytes(s.identity),
    pairKey: hexToBytes(s.pairKey),
    options: {
      weapons: s.options?.weapons === true,
      photos: s.options?.photos === true,
    },
    pairedAt: s.pairedAt,
  };
}

export async function getPeer(
  db: SqlDatabase,
  device: string,
): Promise<Peer | null> {
  const text = await getMeta(db, `peer:${device}`);
  if (text === null) {
    return null;
  }
  try {
    return toPeer(device, JSON.parse(text) as StoredPeer);
  } catch {
    return null;
  }
}

export async function listPeers(db: SqlDatabase): Promise<Peer[]> {
  const { rows } = await db.execute(
    "SELECT key, value FROM sync_meta WHERE key LIKE 'peer:%' ORDER BY key",
  );
  const peers: Peer[] = [];
  for (const row of rows) {
    try {
      const peer = toPeer(
        String(row.key).slice('peer:'.length),
        JSON.parse(String(row.value)) as StoredPeer,
      );
      if (peer) {
        peers.push(peer);
      }
    } catch {
      // Entrée illisible : ignorée.
    }
  }
  return peers;
}

async function savePeer(db: SqlDatabase, peer: Peer): Promise<void> {
  const stored: StoredPeer = {
    identity: bytesToHex(peer.identity),
    pairKey: bytesToHex(peer.pairKey),
    options: peer.options,
    pairedAt: peer.pairedAt,
  };
  await setMeta(db, `peer:${peer.device}`, JSON.stringify(stored));
}

/**
 * Enregistre le téléphone associé à l'issue d'une association réussie.
 * Côté QR code, l'invitation est consommée (usage unique).
 */
export async function completePairing(
  db: SqlDatabase,
  session: SecureSession,
  options: SyncOptions,
  now: Date = new Date(),
): Promise<Peer> {
  const peer: Peer = {
    device: session.peer.device,
    identity: session.peer.identity,
    pairKey: session.pairKey,
    options,
    pairedAt: now.toISOString(),
  };
  await withTransaction(db, async () => {
    await savePeer(db, peer);
    await cancelInvite(db);
  });
  return peer;
}

/** Options de partage modifiées (s'appliquent au prochain échange). */
export async function updatePeerOptions(
  db: SqlDatabase,
  device: string,
  options: SyncOptions,
): Promise<void> {
  const peer = await getPeer(db, device);
  if (peer) {
    await savePeer(db, { ...peer, options });
  }
}

/**
 * Dissociation : la clé d'association est oubliée, plus rien ne peut être
 * échangé avec ce téléphone. Chacun garde sa copie du stock.
 */
export async function forgetPeer(
  db: SqlDatabase,
  device: string,
): Promise<void> {
  await db.execute('DELETE FROM sync_meta WHERE key IN (?, ?)', [
    `peer:${device}`,
    `peer_clock:${device}`,
  ]);
}
