/**
 * Partage du foyer sur le réseau local : afficher un QR code et attendre,
 * rejoindre un foyer, puis synchroniser deux téléphones associés.
 *
 * Synchronisation : les deux téléphones écoutent et s'annoncent sous un nom
 * que seuls les téléphones associés reconnaissent (dérivé de la clé
 * d'association). Celui dont l'identifiant est le plus petit se connecte à
 * l'autre ; l'autre attend. Un seul échange à la fois.
 */
import { sha256 } from '@noble/hashes/sha2';
import { bytesToHex, concatBytes, utf8ToBytes } from '@noble/hashes/utils';

import type { SqlDatabase } from '../db/types';
import type { FoundPeer, LocalNetwork } from '../device/net';
import type { Channel } from './channel';
import {
  acceptConnection,
  connectToPeer,
  joinWithInvite,
  type ExchangeContext,
  type ExchangeResult,
} from './exchange';
import { cancelInvite, createInvite, decodeInvite, type Peer } from './pairing';
import { getDeviceId, type SyncOptions } from './store';

/** Temps laissé à l'autre téléphone pour se manifester. */
export const SYNC_WAIT_MS = 60_000;

export class SyncBusyError extends Error {
  constructor() {
    super('Un échange est déjà en cours.');
    this.name = 'SyncBusyError';
  }
}

const busy = new Set<SqlDatabase>();

/** Un seul échange à la fois par coffre (une transaction à la fois). */
async function guarded<T>(
  db: SqlDatabase,
  channel: Channel,
  run: () => Promise<T>,
): Promise<T> {
  try {
    if (busy.has(db)) {
      throw new SyncBusyError();
    }
    busy.add(db);
    try {
      return await run();
    } finally {
      busy.delete(db);
    }
  } finally {
    channel.close();
  }
}

/** Nom annoncé sur le Wi-Fi : reconnaissable des seuls téléphones associés. */
export function serviceName(pairKey: Uint8Array, device: string): string {
  return `fnr-${bytesToHex(
    sha256(concatBytes(pairKey, utf8ToBytes(`|${device}`))),
  ).slice(0, 12)}`;
}

export interface Hosting {
  /** Texte du QR code à afficher. */
  text: string;
  /** Résolu quand l'autre téléphone a rejoint le foyer. */
  done: Promise<ExchangeResult>;
  cancel(): void;
}

/** Téléphone qui a le stock : QR code et attente de l'autre téléphone. */
export async function hostInvite(
  ctx: ExchangeContext,
  net: LocalNetwork,
  options: SyncOptions,
): Promise<Hosting> {
  let settle!: {
    resolve: (r: ExchangeResult) => void;
    reject: (e: unknown) => void;
  };
  const done = new Promise<ExchangeResult>((resolve, reject) => {
    settle = { resolve, reject };
  });
  let finished = false;
  const listener = await net.listen(channel => {
    if (finished) {
      channel.close();
      return;
    }
    guarded(ctx.db, channel, () => acceptConnection(ctx, channel)).then(
      result => {
        finished = true;
        listener.stop();
        settle.resolve(result);
      },
      // Mauvais code ou téléphone étranger : on continue d'attendre.
      () => undefined,
    );
  });
  const addresses = (await net.addresses()).map(a => `${a}:${listener.port}`);
  const now = (ctx.now ?? Date.now)();
  const { text } = await createInvite(
    ctx.db,
    options,
    ctx.random,
    now,
    addresses,
  );
  return {
    text,
    done,
    cancel: () => {
      if (!finished) {
        finished = true;
        listener.stop();
        cancelInvite(ctx.db).catch(() => undefined);
        settle.reject(new Error('Annulé'));
      }
    },
  };
}

/** Téléphone qui rejoint : connexion aux adresses du QR code. */
export async function joinFromInvite(
  ctx: ExchangeContext,
  net: LocalNetwork,
  text: string,
): Promise<ExchangeResult> {
  const invite = decodeInvite(text, (ctx.now ?? Date.now)());
  const addresses = invite.addresses ?? [];
  if (addresses.length === 0) {
    throw new Error('Ce QR code ne contient pas d’adresse réseau.');
  }
  let lastError: unknown = null;
  for (const address of addresses) {
    const i = address.lastIndexOf(':');
    try {
      const channel = await net.connect(
        address.slice(0, i),
        Number(address.slice(i + 1)),
      );
      return await guarded(ctx.db, channel, () =>
        joinWithInvite(ctx, channel, text),
      );
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error &&
    !/connect|injoignable|refused|timed out/i.test(lastError.message)
    ? lastError
    : new Error(
        'Autre téléphone injoignable : les deux doivent être sur le même Wi-Fi (ou le partage de connexion de l’un d’eux).',
      );
}

/**
 * Synchronise avec un téléphone associé : les deux doivent avoir l'écran de
 * partage (ou Fenrir) ouvert sur le même réseau.
 */
export async function syncWithPeer(
  ctx: ExchangeContext,
  net: LocalNetwork,
  peer: Peer,
  waitMs: number = SYNC_WAIT_MS,
): Promise<ExchangeResult> {
  const me = await getDeviceId(ctx.db);
  const iConnect = me < peer.device;
  const expected = serviceName(peer.pairKey, peer.device);
  const cleanups: (() => void)[] = [];

  try {
    return await new Promise<ExchangeResult>((resolve, reject) => {
      let settled = false;
      const finish = (run: () => Promise<ExchangeResult>) => {
        if (settled) {
          return;
        }
        settled = true;
        run().then(resolve, reject);
      };
      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          reject(
            new Error(
              'Autre téléphone introuvable : ouvrez le partage du foyer sur les deux téléphones, sur le même Wi-Fi.',
            ),
          );
        }
      }, waitMs);
      cleanups.push(() => clearTimeout(timer));

      (async () => {
        const listener = await net.listen(channel => {
          if (settled) {
            channel.close();
            return;
          }
          finish(() =>
            guarded(ctx.db, channel, () => acceptConnection(ctx, channel)),
          );
        });
        cleanups.push(listener.stop);
        cleanups.push(
          await net.advertise(serviceName(peer.pairKey, me), listener.port),
        );
        if (iConnect) {
          cleanups.push(
            await net.discover((found: FoundPeer) => {
              if (settled || found.name !== expected) {
                return;
              }
              finish(async () => {
                const channel = await net.connect(found.host, found.port);
                return guarded(ctx.db, channel, () =>
                  connectToPeer(ctx, channel, peer),
                );
              });
            }),
          );
        }
      })().catch(error => {
        if (!settled) {
          settled = true;
          reject(error);
        }
      });
    });
  } finally {
    for (const cleanup of cleanups.reverse()) {
      try {
        cleanup();
      } catch {
        // Déjà arrêté.
      }
    }
  }
}
