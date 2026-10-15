/**
 * Stockage de l'état du coffre dans le Keychain iOS / le Keystore Android.
 *
 * - `WHEN_UNLOCKED_THIS_DEVICE_ONLY` : jamais synchronisé ni inclus dans les
 *   sauvegardes, illisible quand l'appareil est verrouillé.
 * - Android : stockage adossé au matériel (TEE/StrongBox) quand il existe,
 *   sinon repli logiciel (appareils anciens).
 */
import * as Keychain from 'react-native-keychain';

import type { SecureValueStore } from '../types';

const SERVICE = 'resilios.vault';
const ACCOUNT = 'state';

export function createKeychainStore(
  service: string = SERVICE,
): SecureValueStore {
  const base = {
    service,
    accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    cloudSync: false,
  } as const;

  return {
    async read(): Promise<string | null> {
      const result = await Keychain.getGenericPassword({ service });
      return result === false ? null : result.password;
    },

    async write(value: string): Promise<void> {
      try {
        await Keychain.setGenericPassword(ACCOUNT, value, {
          ...base,
          securityLevel: Keychain.SECURITY_LEVEL.SECURE_HARDWARE,
        });
      } catch {
        // Pas d'enclave matérielle : on accepte le Keystore logiciel.
        await Keychain.setGenericPassword(ACCOUNT, value, {
          ...base,
          securityLevel: Keychain.SECURITY_LEVEL.ANY,
        });
      }
    },

    async clear(): Promise<void> {
      await Keychain.resetGenericPassword({ service });
    },
  };
}
