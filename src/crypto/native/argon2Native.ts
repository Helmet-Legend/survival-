/**
 * Argon2id natif (argon2kt sur Android, Argon2Swift sur iOS). Les appels
 * passent par un module natif exécuté hors du thread JS et du thread UI : la
 * saisie du PIN reste fluide pendant les ~150-300 ms de dérivation.
 */
import argon2 from 'react-native-argon2';

import { bytesToHex, hexToBytes } from '../bytes';
import type { Argon2Params } from '../params';
import type { Argon2Engine } from '../types';

export const nativeArgon2: Argon2Engine = {
  async argon2id(
    password: string,
    salt: Uint8Array,
    params: Argon2Params,
  ): Promise<Uint8Array> {
    const { rawHash } = await argon2(password, bytesToHex(salt), {
      mode: 'argon2id',
      memory: params.memoryKiB,
      iterations: params.iterations,
      parallelism: params.parallelism,
      hashLength: params.hashLength,
      saltEncoding: 'hex',
    });
    return hexToBytes(rawHash);
  },
};
