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
