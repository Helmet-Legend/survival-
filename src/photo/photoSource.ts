/**
 * Prise ou choix d'une photo (module natif `ResiliosPhoto`). Les fonctions
 * renvoient l'image en JPEG base64, ou null si l'utilisateur a annulé.
 * Absent dans les tests et l'aperçu web.
 */
import { NativeModules, Platform } from 'react-native';

/** PDF importé : ses pages converties en JPEG base64 sur le téléphone. */
export interface ImportedPdf {
  name: string;
  /** Pages du fichier (peut dépasser `pages.length` si le PDF est long). */
  pageCount: number;
  pages: string[];
}

export interface PhotoSource {
  available: boolean;
  take(): Promise<string | null>;
  pick(): Promise<string | null>;
  /**
   * Scanner de documents du téléphone (Google Play sur Android, Apple sur
   * iPhone) : une image par page, au plus `maxPages`, ou null si annulé.
   * Absent sans ce scanner (téléphone sans services Google).
   */
  scan?(maxPages: number): Promise<string[] | null>;
  /**
   * PDF choisi dans les fichiers du téléphone, au plus `maxPages` pages,
   * ou null si annulé. Absent dans les tests et l'aperçu web.
   */
  pickPdf?(maxPages: number): Promise<ImportedPdf | null>;
}

interface NativePhotoModule {
  takePhoto(): Promise<string | null>;
  pickPhoto(): Promise<string | null>;
  scanDocument?(maxPages: number): Promise<string[] | null>;
  pickPdf?(maxPages: number): Promise<ImportedPdf | null>;
  canScanDocuments?: boolean;
  getConstants?(): { canScanDocuments?: boolean };
}

let away = 0;

/**
 * L'appareil photo et la galerie passent l'application en arrière-plan,
 * ce qui verrouille normalement le coffre et ferait perdre la photo. Le
 * verrouillage automatique est suspendu pendant ces seules opérations.
 */
export async function whileAway<T>(task: () => Promise<T>): Promise<T> {
  away++;
  try {
    return await task();
  } finally {
    away--;
  }
}

export function isAwayForPhoto(): boolean {
  return away > 0;
}

export function nativePhotoSource(): PhotoSource {
  const native =
    Platform.OS === 'android' || Platform.OS === 'ios'
      ? (NativeModules.ResiliosPhoto as NativePhotoModule | undefined)
      : undefined;
  if (native === undefined) {
    return {
      available: false,
      take: async () => null,
      pick: async () => null,
    };
  }
  const scanDocument = native.scanDocument;
  const pickPdf = native.pickPdf;
  const canScan =
    scanDocument !== undefined &&
    (native.canScanDocuments ??
      native.getConstants?.().canScanDocuments ??
      false);
  return {
    available: true,
    take: () => whileAway(() => native.takePhoto()),
    pick: () => whileAway(() => native.pickPhoto()),
    ...(canScan
      ? {
          scan: (maxPages: number) =>
            whileAway(() => scanDocument.call(native, maxPages)),
        }
      : {}),
    ...(pickPdf !== undefined
      ? {
          pickPdf: (maxPages: number) =>
            whileAway(() => pickPdf.call(native, maxPages)),
        }
      : {}),
  };
}
