/**
 * Import d'un PDF comme pages d'un document : les pages sont converties en
 * images sur le téléphone (voir `photoSource.pickPdf`), puis rangées comme
 * des pages scannées. Ce module dit ce qui a été gardé.
 */
import type { ImportedPdf } from './photoSource';

export interface PdfImportResult {
  /** Pages à enregistrer, dans l'ordre. */
  pages: string[];
  /** Message à afficher (pages ignorées, PDF vide), ou null. */
  notice: string | null;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n > 1 ? 's' : ''}`;
}

/**
 * Garde au plus `room` pages du PDF et explique ce qui manque : PDF sans
 * page lisible, pages au-delà de la place restante.
 */
export function pdfPagesToKeep(
  pdf: ImportedPdf,
  room: number,
): PdfImportResult {
  if (pdf.pages.length === 0) {
    return { pages: [], notice: 'Aucune page lisible dans ce PDF.' };
  }
  const pages = pdf.pages.slice(0, Math.max(0, room));
  const total = Math.max(pdf.pageCount, pdf.pages.length);
  if (pages.length < total) {
    return {
      pages,
      notice:
        pages.length === 0
          ? 'Plus de place pour de nouvelles pages.'
          : `${plural(pages.length, 'page')} sur ${total} importée${
              pages.length > 1 ? 's' : ''
            } : la limite du document est atteinte.`,
    };
  }
  return { pages, notice: null };
}

/** Taille approximative des images, en octets (base64 → binaire). */
export function imagesBytes(pages: readonly string[]): number {
  return pages.reduce((sum, p) => sum + Math.floor((p.length * 3) / 4), 0);
}

/** « 850 Ko », « 24 Mo », « 1,2 Go ». */
export function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) {
    return `${Math.max(1, Math.round(bytes / 1024))} Ko`;
  }
  if (bytes < 1024 * 1024 * 1024) {
    const mo = bytes / (1024 * 1024);
    return `${(mo < 10 ? Math.round(mo * 10) / 10 : Math.round(mo))
      .toString()
      .replace('.', ',')} Mo`;
  }
  const go = Math.round((bytes / (1024 * 1024 * 1024)) * 10) / 10;
  return `${go.toString().replace('.', ',')} Go`;
}

/** « 40 pages importées · 9,8 Mo dans le coffre ». */
export function importSummary(pages: readonly string[]): string {
  return `${plural(pages.length, 'page')} importée${
    pages.length > 1 ? 's' : ''
  } · ${formatBytes(imagesBytes(pages))} dans le coffre`;
}

/** Libellé d'un bouton pendant la conversion. */
export function conversionLabel(
  progress: { done: number; total: number } | null,
  idle: string,
): string {
  if (progress === null) {
    return idle;
  }
  return progress.total > 0
    ? `Conversion : page ${progress.done} / ${progress.total}…`
    : 'Conversion…';
}
