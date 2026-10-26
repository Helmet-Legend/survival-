/**
 * Photos d'une arme ou d'un document (numéro de série, recto/verso). Elles
 * restent dans la base chiffrée : rien n'est écrit dans la galerie.
 */
import type { SqlDatabase } from '../db/types';
import { InventoryError, randomUuid } from './inventoryRepository';

export type PhotoOwner = 'weapon' | 'document' | 'item';
export type PhotoMime = 'image/jpeg' | 'image/png';

export interface Photo {
  id: string;
  mime: PhotoMime;
  base64: string;
  createdAt: string;
}

/** Environ 6 Mo d'image : bien au-delà d'une photo réduite par l'app. */
export const PHOTO_MAX_BASE64_LENGTH = 8_000_000;
/** Assez pour un recto, un verso et quelques détails. */
export const PHOTOS_PER_OWNER_MAX = 6;
/** Pages d'un document scanné (acte, contrat, dossier médical). */
export const DOCUMENT_PAGES_MAX = 30;

/** Nombre maximal de photos ou de pages pour ce propriétaire. */
export function photoLimit(owner: PhotoOwner): number {
  return owner === 'document' ? DOCUMENT_PAGES_MAX : PHOTOS_PER_OWNER_MAX;
}

const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;

export class PhotoRepository {
  private readonly newId: () => string;

  constructor(
    private readonly db: SqlDatabase,
    options: { newId?: () => string } = {},
  ) {
    this.newId = options.newId ?? randomUuid;
  }

  async list(owner: PhotoOwner, ownerId: string): Promise<Photo[]> {
    const { rows } = await this.db.execute(
      `SELECT id, mime, data_base64, created_at FROM photos
        WHERE owner_type = ? AND owner_id = ?
        ORDER BY created_at, id`,
      [owner, ownerId],
    );
    return rows.map(row => ({
      id: String(row.id),
      mime: row.mime as PhotoMime,
      base64: String(row.data_base64),
      createdAt: String(row.created_at),
    }));
  }

  /** Nombre de photos par propriétaire, sans charger les images. */
  async counts(owner: PhotoOwner): Promise<Map<string, number>> {
    const { rows } = await this.db.execute(
      `SELECT owner_id, COUNT(*) AS n FROM photos
        WHERE owner_type = ? GROUP BY owner_id`,
      [owner],
    );
    return new Map(rows.map(row => [String(row.owner_id), Number(row.n)]));
  }

  async add(
    owner: PhotoOwner,
    ownerId: string,
    base64: string,
    mime: PhotoMime = 'image/jpeg',
  ): Promise<string> {
    const data = base64.replace(/\s/g, '');
    if (data === '' || !BASE64_RE.test(data)) {
      throw new InventoryError('VALIDATION', 'Image illisible', {
        field: 'photo',
      });
    }
    if (data.length > PHOTO_MAX_BASE64_LENGTH) {
      throw new InventoryError('VALIDATION', 'Image trop lourde', {
        field: 'photo',
      });
    }
    const table =
      owner === 'weapon'
        ? 'weapons'
        : owner === 'document'
        ? 'documents'
        : 'inventory_items';
    const { rows } = await this.db.execute(
      `SELECT (SELECT COUNT(*) FROM ${table} WHERE id = ?) AS owner_exists,
              (SELECT COUNT(*) FROM photos
                WHERE owner_type = ? AND owner_id = ?) AS photo_count`,
      [ownerId, owner, ownerId],
    );
    if (Number(rows[0].owner_exists) === 0) {
      throw new InventoryError(
        'NOT_FOUND',
        owner === 'weapon'
          ? 'Arme introuvable'
          : owner === 'document'
          ? 'Document introuvable'
          : 'Article introuvable',
      );
    }
    const limit = photoLimit(owner);
    if (Number(rows[0].photo_count) >= limit) {
      throw new InventoryError(
        'VALIDATION',
        owner === 'document'
          ? `${limit} pages au maximum`
          : `${limit} photos au maximum`,
        { field: 'photo' },
      );
    }
    const id = this.newId();
    await this.db.execute(
      `INSERT INTO photos (id, owner_type, owner_id, mime, data_base64)
       VALUES (?, ?, ?, ?, ?)`,
      [id, owner, ownerId, mime, data],
    );
    return id;
  }

  async remove(id: string): Promise<void> {
    await this.db.execute('DELETE FROM photos WHERE id = ?', [id]);
  }
}
