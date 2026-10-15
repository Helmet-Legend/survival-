/**
 * CSPRNG du système (SecureRandom sur Android, SecRandomCopyBytes sur iOS),
 * exposé par `react-native-get-random-values`. Ce polyfill doit être importé
 * en tout premier dans `index.js`.
 */
import type { RandomSource } from '../types';

interface WebCryptoLike {
  getRandomValues<T extends Uint8Array>(array: T): T;
}

function getCrypto(): WebCryptoLike {
  const candidate = (globalThis as { crypto?: Partial<WebCryptoLike> }).crypto;
  if (typeof candidate?.getRandomValues !== 'function') {
    throw new Error(
      "CSPRNG indisponible : importer 'react-native-get-random-values' au démarrage",
    );
  }
  return candidate as WebCryptoLike;
}

export const systemRandom: RandomSource = {
  bytes(length: number): Uint8Array {
    return getCrypto().getRandomValues(new Uint8Array(length));
  },
};
