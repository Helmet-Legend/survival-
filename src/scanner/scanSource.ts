/**
 * Lecteur de codes-barres et de Data Matrix (module natif Android
 * `ResiliosScanner`) : la
 * caméra et le décodage restent dans le téléphone, sans réseau. En série,
 * chaque lecture est renvoyée, y compris les répétitions d'un même code.
 * Absent sur iOS, dans les tests et l'aperçu web : la saisie manuelle reste.
 */
import { NativeModules, Platform } from 'react-native';

import { whileAway } from '../photo/photoSource';
import { readFromScanner, type ScanRead } from './barcode';

export interface ScanSource {
  available: boolean;
  /** Lectures normalisées, ou null si l'utilisateur a annulé. */
  scan(series: boolean): Promise<ScanRead[] | null>;
  /** Texte d'un QR code (association du partage du foyer), ou null. */
  scanQr?(): Promise<string | null>;
}

interface NativeScannerModule {
  scan(
    series: boolean,
  ): Promise<Array<{ code: string; format: string }> | null>;
  scanQr?(): Promise<Array<{ code: string; format: string }> | null>;
}

export function nativeScanSource(): ScanSource {
  const native =
    Platform.OS === 'android' || Platform.OS === 'ios'
      ? (NativeModules.ResiliosScanner as NativeScannerModule | undefined)
      : undefined;
  if (native === undefined) {
    return { available: false, scan: async () => null };
  }
  const scanQr = native.scanQr;
  return {
    available: true,
    ...(scanQr
      ? {
          scanQr: async () => {
            const reads = await whileAway(() => scanQr());
            return reads?.[0]?.code ?? null;
          },
        }
      : {}),
    scan: async series => {
      const reads = await whileAway(() => native.scan(series));
      if (reads === null) {
        return null;
      }
      return reads
        .map(r => readFromScanner(r.code, r.format))
        .filter((r): r is ScanRead => r !== null);
    },
  };
}
