/**
 * Dérivation de la clé SQLCipher :
 *
 *   ikm = Argon2id(PIN, sel_compartiment)          — coût mémoire 64 MiB, t=3, p=2
 *   clé = HKDF-SHA256(ikm, sel = secret_appareil, info = HKDF_INFO, L = 32)
 *
 * Le secret de l'appareil est conservé dans le Keystore / Keychain. Une copie
 * des fichiers .db et des sels hors du téléphone ne suffit donc pas à
 * attaquer le PIN par force brute.
 */
import { hkdf } from '@noble/hashes/hkdf';
import { sha256 } from '@noble/hashes/sha2';
import { utf8ToBytes } from '@noble/hashes/utils';

import { wipe } from './bytes';
import { CryptoError } from './errors';
import {
  ARGON2ID_PARAMS,
  DATABASE_KEY_LENGTH,
  DEVICE_SECRET_LENGTH,
  HKDF_INFO,
  SALT_LENGTH,
  type Argon2Params,
} from './params';
import type { Argon2Engine } from './types';

const hkdfInfo = utf8ToBytes(HKDF_INFO);

/**
 * Normalisation Unicode : une même phrase de passe saisie sur deux claviers
 * différents (accents composés ou non) doit donner la même clé.
 */
export function normalizePin(pin: string): string {
  return pin.normalize('NFC');
}

export async function deriveDatabaseKey(
  engine: Argon2Engine,
  pin: string,
  salt: Uint8Array,
  deviceSecret: Uint8Array,
  params: Argon2Params = ARGON2ID_PARAMS,
): Promise<Uint8Array> {
  if (salt.length !== SALT_LENGTH) {
    throw new CryptoError('DERIVATION_FAILED', 'Sel de longueur invalide');
  }
  if (deviceSecret.length !== DEVICE_SECRET_LENGTH) {
    throw new CryptoError(
      'DERIVATION_FAILED',
      "Secret d'appareil de longueur invalide",
    );
  }

  let stretched: Uint8Array | undefined;
  try {
    stretched = await engine.argon2id(normalizePin(pin), salt, params);
  } catch (cause) {
    throw new CryptoError(
      'DERIVATION_FAILED',
      'La dérivation de clé a échoué',
      {
        cause,
      },
    );
  }

  try {
    if (stretched.length !== params.hashLength) {
      throw new CryptoError(
        'DERIVATION_FAILED',
        'Sortie Argon2id de longueur inattendue',
      );
    }
    return hkdf(sha256, stretched, deviceSecret, hkdfInfo, DATABASE_KEY_LENGTH);
  } finally {
    wipe(stretched);
  }
}
