/**
 * Position GPS à la demande (module natif Android `ResiliosLocation`).
 * Absente sur iOS, dans les tests et l'aperçu web.
 */
import * as ReactNative from 'react-native';
import { NativeModules, Platform } from 'react-native';

export interface Position {
  latitude: number;
  longitude: number;
  /** Précision en mètres, ou null si inconnue. */
  accuracy: number | null;
  /** Dernière position connue plutôt qu'une mesure fraîche. */
  stale: boolean;
}

export interface LocationSource {
  available: boolean;
  /** Demande l'autorisation si besoin, puis une seule mesure. */
  getPosition(): Promise<Position>;
}

interface NativeLocationModule {
  getPosition(timeoutMs: number): Promise<{
    latitude: number;
    longitude: number;
    accuracy: number;
    stale: boolean;
  }>;
}

/**
 * Attente maximale d'une mesure fraîche ; au-delà, la dernière position
 * connue est rendue (marquée « ancienne ») si le téléphone en a une.
 */
const TIMEOUT_MS = 30_000;

export function nativeLocation(): LocationSource {
  const native =
    Platform.OS === 'android' || Platform.OS === 'ios'
      ? (NativeModules.ResiliosLocation as NativeLocationModule | undefined)
      : undefined;
  if (native === undefined) {
    return {
      available: false,
      getPosition: async () => {
        throw new Error('Localisation indisponible sur cet appareil');
      },
    };
  }
  return {
    available: true,
    getPosition: async () => {
      // Accès par l'espace de noms : absent de react-native-web (aperçu).
      const { PermissionsAndroid } = ReactNative;
      const result = await PermissionsAndroid.request(
        'android.permission.ACCESS_FINE_LOCATION',
      );
      if (result !== PermissionsAndroid.RESULTS.GRANTED) {
        throw new Error(
          'Localisation refusée : autorisez-la pour Fenrir dans les réglages Android.',
        );
      }
      const fix = await native.getPosition(TIMEOUT_MS);
      return {
        latitude: fix.latitude,
        longitude: fix.longitude,
        accuracy: fix.accuracy >= 0 ? fix.accuracy : null,
        stale: fix.stale,
      };
    },
  };
}
