/**
 * Paramètres cryptographiques imposés par le cahier des charges (§1 et §4.1).
 * Toute modification rend les coffres existants illisibles : incrémenter
 * `KEY_SLOT_FORMAT_VERSION` et prévoir une migration.
 */
export interface Argon2Params {
  /** Mémoire en KiB. */
  readonly memoryKiB: number;
  /** Nombre de passes. */
  readonly iterations: number;
  /** Nombre de voies parallèles. */
  readonly parallelism: number;
  /** Longueur de la sortie en octets. */
  readonly hashLength: number;
}

export const ARGON2ID_PARAMS: Argon2Params = Object.freeze({
  memoryKiB: 65_536, // 64 MiB
  iterations: 3,
  parallelism: 2,
  hashLength: 32, // 256 bits
});

/** Taille des sels Argon2id (CSPRNG). */
export const SALT_LENGTH = 16;

/** Taille du secret lié à l'appareil, conservé dans le Keystore / Keychain. */
export const DEVICE_SECRET_LENGTH = 32;

/** Taille de la clé brute SQLCipher (AES-256). */
export const DATABASE_KEY_LENGTH = 32;

/** Étiquette HKDF : sépare cet usage de toute autre dérivation future. */
export const HKDF_INFO = 'resilios/sqlcipher-key/v1';

export const KEY_SLOT_FORMAT_VERSION = 1;

/**
 * Deux compartiments, toujours présents sur chaque installation, aux noms
 * neutres. L'attribution « réel / leurre » est tirée au hasard à
 * l'initialisation et n'est enregistrée nulle part.
 */
export const SLOT_FILE_NAMES = ['rs_store_0.db', 'rs_store_1.db'] as const;
export type SlotIndex = 0 | 1;

export const PIN_MIN_LENGTH = 6;
export const PIN_MAX_LENGTH = 128;
