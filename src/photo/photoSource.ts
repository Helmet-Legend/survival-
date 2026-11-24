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

/** Avancement d'une conversion : `done` pages sur `total`. */
export type PdfProgress = (done: number, total: number) => void;

/** PDF ouvert le temps d'une session (module natif `ResiliosPdf`). */
export interface OpenedPdf {
  token: string;
  name: string;
  pageCount: number;
  /** Taille du fichier, en octets. */
  bytes: number;
}

/**
 * Sessions PDF : le fichier reste sur le téléphone le temps de l'import ou
 * de la lecture, et les pages sont dessinées à la demande, quelques-unes à
 * la fois.
 */
export interface PdfFiles {
  /** PDF choisi dans les fichiers du téléphone, ou null si annulé. */
  open(): Promise<OpenedPdf | null>;
  /** Session vide, remplie avec `append` puis ouverte avec `load`. */
  begin(): Promise<string>;
  append(token: string, base64: string): Promise<void>;
  load(token: string): Promise<{ pageCount: number }>;
  render(
    token: string,
    from: number,
    count: number,
    maxSide: number,
  ): Promise<string[]>;
  /** Octets du fichier, en base64. */
  read(token: string, offset: number, length: number): Promise<string>;
  close(token: string): Promise<void>;
}

/** Pages converties à la fois : jamais tout un PDF en mémoire. */
export const PDF_BATCH = 10;
/** Côté des pages : net pour les premières, plus léger ensuite. */
export const PDF_SIDE_SHARP = 1800;
export const PDF_SIDE_LIGHT = 1400;
/** Au-delà de cette page, la résolution plus légère s'applique. */
export const PDF_SHARP_PAGES = 30;

/** Convertit les `maxPages` premières pages d'un PDF ouvert, par paquets. */
export async function convertPdfPages(
  files: PdfFiles,
  opened: OpenedPdf,
  maxPages: number,
  onProgress?: PdfProgress,
): Promise<ImportedPdf> {
  const total = Math.min(opened.pageCount, Math.max(0, maxPages));
  const pages: string[] = [];
  onProgress?.(0, total);
  for (let from = 0; from < total; from += PDF_BATCH) {
    const side = from < PDF_SHARP_PAGES ? PDF_SIDE_SHARP : PDF_SIDE_LIGHT;
    const batch = await files.render(
      opened.token,
      from,
      Math.min(PDF_BATCH, total - from),
      side,
    );
    pages.push(...batch);
    onProgress?.(Math.min(total, from + PDF_BATCH), total);
  }
  return { name: opened.name, pageCount: opened.pageCount, pages };
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
  pickPdf?(
    maxPages: number,
    onProgress?: PdfProgress,
  ): Promise<ImportedPdf | null>;
  /** Sessions PDF (Bibliothèque, import par paquets). */
  pdf?: PdfFiles;
}

interface NativePdfModule {
  openPdf(): Promise<OpenedPdf | null>;
  beginPdf(): Promise<string>;
  appendPdf(token: string, base64: string): Promise<void>;
  loadPdf(token: string): Promise<{ pageCount: number }>;
  renderPdfPages(
    token: string,
    from: number,
    count: number,
    maxSide: number,
  ): Promise<string[]>;
  readPdf(token: string, offset: number, length: number): Promise<string>;
  closePdf(token: string): Promise<void>;
}

export function nativePdfFiles(): PdfFiles | undefined {
  const native =
    Platform.OS === 'android' || Platform.OS === 'ios'
      ? (NativeModules.ResiliosPdf as NativePdfModule | undefined)
      : undefined;
  if (native === undefined) {
    return undefined;
  }
  return {
    open: () => whileAway(() => native.openPdf()),
    begin: () => native.beginPdf(),
    append: (token, base64) => native.appendPdf(token, base64),
    load: token => native.loadPdf(token),
    render: (token, from, count, maxSide) =>
      native.renderPdfPages(token, from, count, maxSide),
    read: (token, offset, length) => native.readPdf(token, offset, length),
    close: token => native.closePdf(token),
  };
}

/** Choix d'un PDF puis conversion par paquets, fichier refermé ensuite. */
export function pickPdfWith(files: PdfFiles) {
  return async (
    maxPages: number,
    onProgress?: PdfProgress,
  ): Promise<ImportedPdf | null> => {
    const opened = await files.open();
    if (opened === null) {
      return null;
    }
    try {
      return await convertPdfPages(files, opened, maxPages, onProgress);
    } finally {
      await files.close(opened.token).catch(() => undefined);
    }
  };
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
  const pdf = nativePdfFiles();
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
    // Sessions PDF : conversion par paquets, sans limite de mémoire ;
    // à défaut (ancienne version native), conversion d'un seul tenant.
    ...(pdf !== undefined
      ? { pdf, pickPdf: pickPdfWith(pdf) }
      : pickPdf !== undefined
      ? {
          pickPdf: (maxPages: number) =>
            whileAway(() => pickPdf.call(native, maxPages)),
        }
      : {}),
  };
}
