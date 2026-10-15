import type { DB } from '@op-engineering/op-sqlite';

import { nativeArgon2 } from './native/argon2Native';
import { createKeychainStore } from './native/keychainStore';
import { opSqliteDriver } from './native/opSqliteDriver';
import { systemRandom } from './native/random';
import { VaultKeyManager } from './VaultKeyManager';

export { CryptoError, isCryptoError, type CryptoErrorCode } from './errors';
export { ARGON2ID_PARAMS } from './params';
export type {
  InitializeResult,
  VaultSession,
  VaultStatus,
} from './VaultKeyManager';
export { VaultKeyManager };

/** Instance de production branchée sur les modules natifs. */
export function createVaultKeyManager(): VaultKeyManager<DB> {
  return new VaultKeyManager<DB>({
    argon2: nativeArgon2,
    random: systemRandom,
    store: createKeychainStore(),
    driver: opSqliteDriver,
  });
}
