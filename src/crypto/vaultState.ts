/**
 * État persistant du coffre, sérialisé en JSON dans le stockage matériel
 * (Keychain / Keystore). Il contient les sels, le secret d'appareil et le
 * compteur d'essais. Il est indispensable mais ne permet pas, seul,
 * d'ouvrir une base.
 */
import { isHex } from './bytes';
import { CryptoError } from './errors';
import {
  DEVICE_SECRET_LENGTH,
  KEY_SLOT_FORMAT_VERSION,
  SALT_LENGTH,
} from './params';

export interface SlotRecord {
  /** Sel Argon2id courant (hex). */
  salt: string;
  /**
   * Sel du nouveau code pendant un changement de PIN : écrit avant
   * `PRAGMA rekey` et confirmé après. Si l'application est interrompue
   * entre les deux, le déverrouillage essaie les deux sels.
   */
  pendingSalt?: string;
}

export interface VaultState {
  v: typeof KEY_SLOT_FORMAT_VERSION;
  deviceSecret: string;
  slots: [SlotRecord, SlotRecord];
  failedAttempts: number;
  lockedUntil: number;
}

function corrupted(detail: string): CryptoError {
  return new CryptoError(
    'STORAGE_CORRUPTED',
    `État du coffre illisible (${detail})`,
  );
}

function parseSlot(value: unknown): SlotRecord {
  if (typeof value !== 'object' || value === null) {
    throw corrupted('compartiment');
  }
  const { salt, pendingSalt } = value as Record<string, unknown>;
  if (typeof salt !== 'string' || !isHex(salt, SALT_LENGTH)) {
    throw corrupted('sel');
  }
  if (pendingSalt === undefined) {
    return { salt };
  }
  if (typeof pendingSalt !== 'string' || !isHex(pendingSalt, SALT_LENGTH)) {
    throw corrupted('sel en attente');
  }
  return { salt, pendingSalt };
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

export function parseVaultState(raw: string): VaultState {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    throw corrupted('JSON');
  }
  if (typeof data !== 'object' || data === null) {
    throw corrupted('racine');
  }
  const record = data as Record<string, unknown>;
  if (record.v !== KEY_SLOT_FORMAT_VERSION) {
    throw corrupted('version');
  }
  if (
    typeof record.deviceSecret !== 'string' ||
    !isHex(record.deviceSecret, DEVICE_SECRET_LENGTH)
  ) {
    throw corrupted("secret d'appareil");
  }
  if (!Array.isArray(record.slots) || record.slots.length !== 2) {
    throw corrupted('compartiments');
  }
  if (
    !isNonNegativeInteger(record.failedAttempts) ||
    !isNonNegativeInteger(record.lockedUntil)
  ) {
    throw corrupted('compteur');
  }
  return {
    v: KEY_SLOT_FORMAT_VERSION,
    deviceSecret: record.deviceSecret,
    slots: [parseSlot(record.slots[0]), parseSlot(record.slots[1])],
    failedAttempts: record.failedAttempts,
    lockedUntil: record.lockedUntil,
  };
}

export function serializeVaultState(state: VaultState): string {
  return JSON.stringify(state);
}
