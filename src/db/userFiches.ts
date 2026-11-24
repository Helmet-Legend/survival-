/**
 * Mes fiches : fiches écrites par l'utilisateur, avec ses photos et les
 * pages de PDF qu'il importe (converties en images sur le téléphone). Tout
 * reste dans la base chiffrée ; rien n'est écrit dans la galerie.
 */
import { GUIDE_FOLDERS } from '../content/fiches/fiche';
import {
  fold,
  InventoryError,
  randomUuid,
} from '../inventory/inventoryRepository';
import { withTransaction } from './transaction';
import type { SqlDatabase } from './types';

export const USER_FICHE_TITLE_MAX = 120;
export const USER_FICHE_BODY_MAX = 20000;
export const USER_FICHE_PHOTOS_MAX = 6;
export const USER_FICHE_PDFS_MAX = 3;
/** Pages gardées d'un PDF (les suivantes sont ignorées, et signalées). */
export const USER_FICHE_PDF_PAGES_MAX = 100;
/** Environ 6 Mo d'image : bien au-delà d'une page ou d'une photo réduite. */
const IMAGE_MAX_BASE64_LENGTH = 8_000_000;
const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;

/** Familles où une fiche perso porte un avertissement renforcé. */
const RISKY_FAMILIES: readonly string[] = [
  'Santé',
  'Alimentation',
  'Autonomie en nature',
];

export function isRiskyFamily(family: string | null): boolean {
  return family !== null && RISKY_FAMILIES.includes(family);
}

export interface UserFicheInput {
  title: string;
  /** Une famille des fiches Fenrir, ou null (« Sans famille »). */
  family: string | null;
  body: string;
}

export interface UserFicheSummary {
  id: string;
  title: string;
  family: string | null;
  body: string;
  updatedAt: string;
  photoCount: number;
  pdfCount: number;
}

export interface UserFichePhoto {
  id: string;
  base64: string;
}

export interface UserFichePdf {
  pdfId: string;
  name: string;
  pageCount: number;
}

export interface UserFiche extends UserFicheSummary {
  photos: UserFichePhoto[];
  pdfs: UserFichePdf[];
}

function validate(input: UserFicheInput): UserFicheInput {
  const title = input.title.trim();
  if (title === '') {
    throw new InventoryError('VALIDATION', 'Donnez un titre à la fiche', {
      field: 'title',
    });
  }
  if (title.length > USER_FICHE_TITLE_MAX) {
    throw new InventoryError(
      'VALIDATION',
      `Titre trop long (${USER_FICHE_TITLE_MAX} caractères au plus)`,
      { field: 'title' },
    );
  }
  const body = input.body.trim();
  if (body.length > USER_FICHE_BODY_MAX) {
    throw new InventoryError('VALIDATION', 'Texte trop long', {
      field: 'body',
    });
  }
  const family = input.family;
  if (family !== null && !GUIDE_FOLDERS.includes(family as never)) {
    throw new InventoryError('VALIDATION', 'Famille inconnue', {
      field: 'family',
    });
  }
  return { title, family, body };
}

function cleanImage(base64: string): string {
  const data = base64.replace(/\s/g, '');
  if (data === '' || !BASE64_RE.test(data)) {
    throw new InventoryError('VALIDATION', 'Image illisible', {
      field: 'photo',
    });
  }
  if (data.length > IMAGE_MAX_BASE64_LENGTH) {
    throw new InventoryError('VALIDATION', 'Image trop lourde', {
      field: 'photo',
    });
  }
  return data;
}

export class UserFicheRepository {
  private readonly newId: () => string;

  constructor(
    private readonly db: SqlDatabase,
    options: { newId?: () => string } = {},
  ) {
    this.newId = options.newId ?? randomUuid;
  }

  /** Toutes les fiches, la plus récemment modifiée d'abord. */
  async list(): Promise<UserFicheSummary[]> {
    const { rows } = await this.db.execute(
      `SELECT f.id, f.title, f.family, f.body, f.updated_at,
              (SELECT COUNT(*) FROM user_fiche_images i
                WHERE i.fiche_id = f.id AND i.kind = 'photo') AS photos,
              (SELECT COUNT(DISTINCT i.pdf_id) FROM user_fiche_images i
                WHERE i.fiche_id = f.id AND i.kind = 'pdf') AS pdfs
         FROM user_fiches f
        ORDER BY f.updated_at DESC, f.title`,
    );
    return rows.map(r => ({
      id: String(r.id),
      title: String(r.title),
      family: r.family === null ? null : String(r.family),
      body: String(r.body),
      updatedAt: String(r.updated_at),
      photoCount: Number(r.photos),
      pdfCount: Number(r.pdfs),
    }));
  }

  /** Fiches dont le titre ou le texte contient tous les mots (sans accents). */
  async search(query: string): Promise<UserFicheSummary[]> {
    const words = fold(query).split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      return [];
    }
    return (await this.list()).filter(f => {
      const hay = fold(`${f.title}\n${f.body}`);
      return words.every(w => hay.includes(w));
    });
  }

  /** Première photo de chaque fiche (vignettes de la liste). */
  async thumbnails(): Promise<Map<string, string>> {
    const { rows } = await this.db.execute(
      `SELECT fiche_id, data_base64 FROM user_fiche_images i
        WHERE kind = 'photo'
          AND id = (SELECT id FROM user_fiche_images j
                     WHERE j.fiche_id = i.fiche_id AND j.kind = 'photo'
                     ORDER BY rowid LIMIT 1)`,
    );
    return new Map(rows.map(r => [String(r.fiche_id), String(r.data_base64)]));
  }

  async get(id: string): Promise<UserFiche | null> {
    const summary = (await this.list()).find(f => f.id === id);
    if (summary === undefined) {
      return null;
    }
    const photos = await this.db.execute(
      `SELECT id, data_base64 FROM user_fiche_images
        WHERE fiche_id = ? AND kind = 'photo' ORDER BY rowid`,
      [id],
    );
    const pdfs = await this.db.execute(
      `SELECT pdf_id, pdf_name, COUNT(*) AS pages, MIN(rowid) AS added
         FROM user_fiche_images
        WHERE fiche_id = ? AND kind = 'pdf'
        GROUP BY pdf_id, pdf_name ORDER BY added`,
      [id],
    );
    return {
      ...summary,
      photos: photos.rows.map(r => ({
        id: String(r.id),
        base64: String(r.data_base64),
      })),
      pdfs: pdfs.rows.map(r => ({
        pdfId: String(r.pdf_id),
        name: String(r.pdf_name),
        pageCount: Number(r.pages),
      })),
    };
  }

  /** Pages d'un PDF joint, dans l'ordre. */
  async pdfPages(ficheId: string, pdfId: string): Promise<string[]> {
    const { rows } = await this.db.execute(
      `SELECT data_base64 FROM user_fiche_images
        WHERE fiche_id = ? AND kind = 'pdf' AND pdf_id = ? ORDER BY page`,
      [ficheId, pdfId],
    );
    return rows.map(r => String(r.data_base64));
  }

  async create(input: UserFicheInput): Promise<string> {
    const { title, family, body } = validate(input);
    const id = this.newId();
    await this.db.execute(
      'INSERT INTO user_fiches (id, title, family, body) VALUES (?, ?, ?, ?)',
      [id, title, family, body],
    );
    return id;
  }

  async update(id: string, input: UserFicheInput): Promise<void> {
    const { title, family, body } = validate(input);
    await this.exists(id);
    await this.db.execute(
      'UPDATE user_fiches SET title = ?, family = ?, body = ? WHERE id = ?',
      [title, family, body, id],
    );
  }

  async remove(id: string): Promise<void> {
    await withTransaction(this.db, async () => {
      await this.db.execute(
        'DELETE FROM user_fiche_images WHERE fiche_id = ?',
        [id],
      );
      await this.db.execute('DELETE FROM user_fiches WHERE id = ?', [id]);
    });
  }

  private async touch(ficheId: string): Promise<void> {
    await this.db.execute(
      `UPDATE user_fiches SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE id = ?`,
      [ficheId],
    );
  }

  private async exists(ficheId: string): Promise<void> {
    const { rows } = await this.db.execute(
      'SELECT COUNT(*) AS n FROM user_fiches WHERE id = ?',
      [ficheId],
    );
    if (Number(rows[0].n) === 0) {
      throw new InventoryError('NOT_FOUND', 'Fiche introuvable');
    }
  }

  async addPhoto(ficheId: string, base64: string): Promise<string> {
    const data = cleanImage(base64);
    await this.exists(ficheId);
    const { rows } = await this.db.execute(
      `SELECT COUNT(*) AS n FROM user_fiche_images
        WHERE fiche_id = ? AND kind = 'photo'`,
      [ficheId],
    );
    if (Number(rows[0].n) >= USER_FICHE_PHOTOS_MAX) {
      throw new InventoryError(
        'VALIDATION',
        `${USER_FICHE_PHOTOS_MAX} photos au maximum`,
        { field: 'photo' },
      );
    }
    const id = this.newId();
    await this.db.execute(
      `INSERT INTO user_fiche_images (id, fiche_id, kind, data_base64)
       VALUES (?, ?, 'photo', ?)`,
      [id, ficheId, data],
    );
    await this.touch(ficheId);
    return id;
  }

  async removePhoto(ficheId: string, photoId: string): Promise<void> {
    await this.db.execute(
      `DELETE FROM user_fiche_images
        WHERE id = ? AND fiche_id = ? AND kind = 'photo'`,
      [photoId, ficheId],
    );
    await this.touch(ficheId);
  }

  /** Joint un PDF déjà converti en images (une par page). */
  async addPdf(
    ficheId: string,
    name: string,
    pages: readonly string[],
  ): Promise<string> {
    if (pages.length === 0) {
      throw new InventoryError('VALIDATION', 'PDF sans page lisible', {
        field: 'pdf',
      });
    }
    const data = pages.slice(0, USER_FICHE_PDF_PAGES_MAX).map(cleanImage);
    const label = name.trim().slice(0, 200) || 'document.pdf';
    await this.exists(ficheId);
    const { rows } = await this.db.execute(
      `SELECT COUNT(DISTINCT pdf_id) AS n FROM user_fiche_images
        WHERE fiche_id = ? AND kind = 'pdf'`,
      [ficheId],
    );
    if (Number(rows[0].n) >= USER_FICHE_PDFS_MAX) {
      throw new InventoryError(
        'VALIDATION',
        `${USER_FICHE_PDFS_MAX} PDF au maximum par fiche`,
        { field: 'pdf' },
      );
    }
    const pdfId = this.newId();
    await withTransaction(this.db, async () => {
      for (const [page, base64] of data.entries()) {
        await this.db.execute(
          `INSERT INTO user_fiche_images
             (id, fiche_id, kind, pdf_id, pdf_name, page, data_base64)
           VALUES (?, ?, 'pdf', ?, ?, ?, ?)`,
          [this.newId(), ficheId, pdfId, label, page, base64],
        );
      }
    });
    await this.touch(ficheId);
    return pdfId;
  }

  async removePdf(ficheId: string, pdfId: string): Promise<void> {
    await this.db.execute(
      `DELETE FROM user_fiche_images
        WHERE fiche_id = ? AND kind = 'pdf' AND pdf_id = ?`,
      [ficheId, pdfId],
    );
    await this.touch(ficheId);
  }
}
