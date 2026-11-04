/**
 * Batterie du téléphone (module natif `ResiliosBattery`) : niveau en
 * pourcentage et état de charge, lus à la demande. Rien n'est envoyé et
 * aucune durée restante n'est estimée. Absent dans les tests et l'aperçu
 * web : la ligne de l'accueil est alors masquée.
 */
import { NativeModules, Platform } from 'react-native';

export interface BatteryStatus {
  /** Niveau de 0 à 100. */
  level: number;
  charging: boolean;
}

export interface BatterySource {
  available: boolean;
  /** État actuel, ou null s'il n'est pas lisible. */
  read(): Promise<BatteryStatus | null>;
}

export const NO_BATTERY: BatterySource = {
  available: false,
  read: async () => null,
};

interface NativeBatteryModule {
  getStatus(): Promise<{ level: number; charging: boolean } | null>;
}

export function nativeBattery(): BatterySource {
  const native =
    Platform.OS === 'android' || Platform.OS === 'ios'
      ? (NativeModules.ResiliosBattery as NativeBatteryModule | undefined)
      : undefined;
  if (native === undefined) {
    return NO_BATTERY;
  }
  return {
    available: true,
    read: async () => {
      const status = await native.getStatus();
      if (
        status === null ||
        typeof status.level !== 'number' ||
        !(status.level >= 0)
      ) {
        return null;
      }
      return {
        level: Math.min(100, Math.round(status.level)),
        charging: status.charging === true,
      };
    },
  };
}

export type BatteryTone = 'charging' | 'low' | 'medium' | 'ok';

/** Sous 20 % : faible ; sous 50 % : à recharger bientôt. */
export function batteryTone(status: BatteryStatus): BatteryTone {
  if (status.charging) {
    return 'charging';
  }
  if (status.level < 20) {
    return 'low';
  }
  return status.level < 50 ? 'medium' : 'ok';
}

export const BATTERY_STATE: Record<BatteryTone, string> = {
  charging: 'En charge',
  low: 'Faible : économisez la batterie',
  medium: 'À recharger bientôt',
  ok: 'Sur batterie',
};
