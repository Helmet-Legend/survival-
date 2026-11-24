/**
 * Bibliothèque : PDF gardés entiers (guides, livres), sans limite de pages.
 *
 * Le fichier est rangé dans le coffre chiffré en morceaux base64
 * (`library_chunks`). Pour le lire, il est reconstitué le temps de la
 * lecture dans une session PDF du téléphone, qui dessine une page à la
 * fois : jamais tout le livre en mémoire.
 */
import {
  fold,
  InventoryError,
  randomUuid,
} from '../inventory/inventoryRepository';
import type { OpenedPdf, PdfFiles } from '../photo/photoSource';
import { withTransaction } from './transaction';
import type { SqlDatabase } from './types';

/** Taille maximale d'un livre : bien au-delà d'un guide de 400 pages. */
export const LIBRARY_MAX_BYTES = 60 * 1024 * 1024;
/** Morceau rangé par ligne (octets du fichier). */
export const LIBRARY_CHUNK_BYTES = 512 * 1024;
export const LIBRARY_TITLE_MAX = 200;

export interface LibraryBook {
  id: string;
  title: string;
  fileName: string;
  bytes: number;
  pageCount: number;
  /** Dernière page lue (0 = première). */
  lastPage: number;
  updatedAt: string;
}

/** Avancement : octets copiés sur le total. */
export type CopyProgress = (done: number, total: number) => void;

/** Titre lisible tiré du nom du fichier (« guide_survie-urbaine.pdf »). */
export function titleFromFileName(fileName: string): string {
  const base = fileName
    .replace(/\.pdf$/i, '')
    .replace(/[_]+/g, ' ')
    .trim();
  return (base || 'Document').slice(0, LIBRARY_TITLE_MAX);
}

function cleanTitle(title: string): string {
  const t = title.trim();
  if (t === '') {
    throw new InventoryError('VALIDATION', 'Donnez un titre au livre', {
      field: 'title',
    });
  }
  return t.slice(0, LIBRARY_TITLE_MAX);
}

export class LibraryRepository {
  private readonly newId: () => string;

  constructor(
    private readonly db: SqlDatabase,
    options: { newId?: () => string } = {},
  ) {
    this.newId = options.newId ?? randomUuid;
  }

  /** Livres, le plus récemment lu ou ajouté d'abord. */
  async list(): Promise<LibraryBook[]> {
    const { rows } = await this.db.execute(
      `SELECT id, title, file_name, bytes, page_count, last_page, updated_at
         FROM library_books ORDER BY updated_at DESC, title`,
    );
    return rows.map(r => ({
      id: String(r.id),
      title: String(r.title),
      fileName: String(r.file_name),
      bytes: Number(r.bytes),
      pageCount: Number(r.page_count),
      lastPage: Number(r.last_page),
      updatedAt: String(r.updated_at),
    }));
  }

  async get(id: string): Promise<LibraryBook | null> {
    return (await this.list()).find(b => b.id === id) ?? null;
  }

  /** Livres dont le titre contient tous les mots (sans accents). */
  async search(query: string): Promise<LibraryBook[]> {
    const words = fold(query).split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      return [];
    }
    return (await this.list()).filter(b => {
      const hay = fold(`${b.title}\n${b.fileName}`);
      return words.every(w => hay.includes(w));
    });
  }

  /** Place prise par toute la bibliothèque, en octets. */
  async totalBytes(): Promise<number> {
    const { rows } = await this.db.execute(
      'SELECT COALESCE(SUM(bytes), 0) AS n FROM library_books',
    );
    return Number(rows[0].n);
  }

  /**
   * Range dans le coffre un PDF ouvert (`files.open`), morceau par
   * morceau. La session reste ouverte : l'appelant la ferme.
   */
  async add(
    files: PdfFiles,
    opened: OpenedPdf,
    onProgress?: CopyProgress,
  ): Promise<string> {
    if (opened.bytes > LIBRARY_MAX_BYTES) {
      throw new InventoryError(
        'VALIDATION',
        `PDF trop lourd (${Math.round(
          LIBRARY_MAX_BYTES / (1024 * 1024),
        )} Mo au plus)`,
        { field: 'pdf' },
      );
    }
    if (!(opened.pageCount > 0)) {
      throw new InventoryError('VALIDATION', 'PDF sans page lisible', {
        field: 'pdf',
      });
    }
    const id = this.newId();
    const name = opened.name.trim().slice(0, 200) || 'document.pdf';
    await withTransaction(this.db, async () => {
      await this.db.execute(
        `INSERT INTO library_books (id, title, file_name, bytes, page_count)
         VALUES (?, ?, ?, ?, ?)`,
        [id, titleFromFileName(name), name, opened.bytes, opened.pageCount],
      );
      let offset = 0;
      for (let seq = 0; offset < opened.bytes; seq++) {
        const chunk = await files.read(
          opened.token,
          offset,
          LIBRARY_CHUNK_BYTES,
        );
        if (chunk === '') {
          break;
        }
        await this.db.execute(
          `INSERT INTO library_chunks (book_id, seq, data_base64)
           VALUES (?, ?, ?)`,
          [id, seq, chunk],
        );
        offset += LIBRARY_CHUNK_BYTES;
        onProgress?.(Math.min(offset, opened.bytes), opened.bytes);
      }
    });
    return id;
  }

  /**
   * Reconstitue le livre dans une session PDF pour le lire. Renvoie le
   * jeton et le nombre de pages ; l'appelant ferme la session.
   */
  async open(
    files: PdfFiles,
    id: string,
    onProgress?: CopyProgress,
  ): Promise<{ token: string; pageCount: number }> {
    const book = await this.get(id);
    if (book === null) {
      throw new InventoryError('NOT_FOUND', 'Livre introuvable');
    }
    const { rows } = await this.db.execute(
      'SELECT COUNT(*) AS n FROM library_chunks WHERE book_id = ?',
      [id],
    );
    const count = Number(rows[0].n);
    const token = await files.begin();
    try {
      // Un morceau à la fois : la mémoire reste faible même pour un gros livre.
      for (let seq = 0; seq < count; seq++) {
        const chunk = await this.db.execute(
          'SELECT data_base64 FROM library_chunks WHERE book_id = ? AND seq = ?',
          [id, seq],
        );
        if (chunk.rows.length === 0) {
          throw new InventoryError('VALIDATION', 'Livre incomplet');
        }
        await files.append(token, String(chunk.rows[0].data_base64));
        onProgress?.(seq + 1, count);
      }
      const { pageCount } = await files.load(token);
      return { token, pageCount };
    } catch (e) {
      await files.close(token).catch(() => undefined);
      throw e;
    }
  }

  async rename(id: string, title: string): Promise<void> {
    await this.db.execute('UPDATE library_books SET title = ? WHERE id = ?', [
      cleanTitle(title),
      id,
    ]);
  }

  async setLastPage(id: string, page: number): Promise<void> {
    await this.db.execute(
      'UPDATE library_books SET last_page = ? WHERE id = ?',
      [Math.max(0, Math.floor(page)), id],
    );
  }

  async remove(id: string): Promise<void> {
    await withTransaction(this.db, async () => {
      await this.db.execute('DELETE FROM library_chunks WHERE book_id = ?', [
        id,
      ]);
      await this.db.execute('DELETE FROM library_books WHERE id = ?', [id]);
    });
  }
}
