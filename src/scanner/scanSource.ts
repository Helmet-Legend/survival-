/**
 * Lecteur de codes-barres (module natif Android `ResiliosScanner`) : la
 * caméra et le décodage restent dans le téléphone, sans réseau. En série,
 * chaque lecture est renvoyée, y compris les répétitions d'un même code.
 * Absent sur iOS, dans les tests et l'aperçu web : la saisie manuelle reste.
 */
import { NativeModules, Platform } from 'react-native';

import { whileAway } from '../photo/photoSource';
import { normalizeBarcode } from './barcode';

export interface ScanSource {
  available: boolean;
  /** Codes lus et normalisés, ou null si l'utilisateur a annulé. */
  scan(series: boolean): Promise<string[] | null>;
}

interface NativeScannerModule {
  scan(
    series: boolean,
  ): Promise<Array<{ code: string; format: string }> | null>;
}

export function nativeScanSource(): ScanSource {
  const native =
    Platform.OS === 'android'
      ? (NativeModules.ResiliosScanner as NativeScannerModule | undefined)
      : undefined;
  if (native === undefined) {
    return { available: false, scan: async () => null };
  }
  return {
    available: true,
    scan: async series => {
      const reads = await whileAway(() => native.scan(series));
      if (reads === null) {
        return null;
      }
      return reads
        .map(r => normalizeBarcode(r.code, r.format))
        .filter((c): c is string => c !== null);
    },
  };
}
