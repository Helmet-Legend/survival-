/**
 * Rappels de péremption du téléphone (module natif Android
 * `ResiliosReminders`). Absent sur iOS, dans les tests et l'aperçu web.
 */
import * as ReactNative from 'react-native';
import { NativeModules, Platform } from 'react-native';

import type { ReminderScheduler } from '../resilience/reminders';

interface NativeRemindersModule {
  schedule(times: number[]): Promise<number>;
  cancelAll(): Promise<void>;
}

export function nativeReminders(): ReminderScheduler {
  const native =
    Platform.OS === 'android' || Platform.OS === 'ios'
      ? (NativeModules.ResiliosReminders as NativeRemindersModule | undefined)
      : undefined;
  if (native === undefined) {
    return {
      available: false,
      requestPermission: async () => false,
      schedule: async () => undefined,
      cancelAll: async () => undefined,
    };
  }
  return {
    available: true,
    requestPermission: async () => {
      // Avant Android 13, les notifications sont autorisées par défaut.
      if (typeof Platform.Version !== 'number' || Platform.Version < 33) {
        return true;
      }
      // Accès par l'espace de noms : absent de react-native-web (aperçu).
      const { PermissionsAndroid } = ReactNative;
      const result = await PermissionsAndroid.request(
        'android.permission.POST_NOTIFICATIONS',
      );
      return result === PermissionsAndroid.RESULTS.GRANTED;
    },
    schedule: async times => {
      await native.schedule([...times]);
    },
    cancelAll: () => native.cancelAll(),
  };
}
