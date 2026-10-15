/**
 * Documents importants (carte d'identité, passeport, permis, carte Vitale,
 * mutuelle…) : numéro, titulaire, date d'expiration et photos, pour les
 * retrouver ou les faire refaire en cas de perte ou de vol.
 */
import type { SqlDatabase, SqlRow } from '../db/types';
import { daysBetween, isIsoDate, localToday } from '../lib/dates';
import { InventoryError, randomUuid } from './inventoryRepository';

export const DOCUMENT_KINDS = [
  'id_card',
  'passport',
  'driving_licence',
  'health_card',
  'insurance',
  'other',
] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

export interface DocumentInput {
  kind: DocumentKind;
  title: string;
  holder?: string | null;
  number?: string | null;
  /** `AAAA-MM-JJ` ou null. */
  expiresAt?: string | null;
  notes?: string | null;
}

export interface StoredDocument {
  id: string;
  kind: DocumentKind;
  title: string;
  holder: string | null;
  number: string | null;
  expiresAt: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DocumentSummary extends StoredDocument {
  /** Jours avant expiration (négatif si expiré), null sans date. */
  daysLeft: number | null;
}

/** En dessous, le document est signalé « à renouveler ». */
export const DOCUMENT_RENEW_DAYS = 90;

function invalid(field: string, message: string): InventoryError {
  return new InventoryError('VALIDATION', message, { field });
}

function text(
  value: string | null | undefined,
  field: string,
  max: number,
): string | null {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (trimmed.length > max) {
    throw invalid(field, `${max} caractères au maximum`);
  }
  return trimmed === '' ? null : trimmed;
}

function validate(input: DocumentInput) {
  if (!DOCUMENT_KINDS.includes(input.kind)) {
    throw invalid('kind', 'Type de document inconnu');
  }
  const title = text(input.title, 'title', 120);
  if (title === null) {
    throw invalid('title', 'Champ obligatoire');
  }
  const expiresAt = text(input.expiresAt, 'expiresAt', 10);
  if (expiresAt !== null && !isIsoDate(expiresAt)) {
    throw invalid('expiresAt', 'Date invalide (format AAAA-MM-JJ attendu)');
  }
  return {
    kind: input.kind,
    title,
    holder: text(input.holder, 'holder', 120),
    number: text(input.number, 'number', 60),
    expiresAt,
    notes: text(input.notes, 'notes', 500),
  };
}

function toDocument(row: SqlRow): StoredDocument {
  const optional = (value: unknown) => (value === null ? null : String(value));
  return {
    id: String(row.id),
    kind: row.kind as DocumentKind,
    title: String(row.title),
    holder: optional(row.holder),
    number: optional(row.number),
    expiresAt: optional(row.expires_at),
    notes: optional(row.notes),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export class DocumentRepository {
  private readonly newId: () => string;
  private readonly today: () => string;

  constructor(
    private readonly db: SqlDatabase,
    options: { newId?: () => string; today?: () => string } = {},
  ) {
    this.newId = options.newId ?? randomUuid;
    this.today = options.today ?? (() => localToday());
  }

  /** Les plus proches de l'expiration d'abord, puis sans date, par titre. */
  async list(): Promise<DocumentSummary[]> {
    const { rows } = await this.db.execute(
      `SELECT * FROM documents
        ORDER BY expires_at IS NULL, expires_at, title COLLATE NOCASE`,
    );
    const today = this.today();
    return rows.map(row => {
      const doc = toDocument(row);
      return {
        ...doc,
        daysLeft:
          doc.expiresAt === null ? null : daysBetween(today, doc.expiresAt),
      };
    });
  }

  async create(input: DocumentInput): Promise<StoredDocument> {
    const doc = validate(input);
    const id = this.newId();
    await this.db.execute(
      `INSERT INTO documents (id, kind, title, holder, number, expires_at, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        doc.kind,
        doc.title,
        doc.holder,
        doc.number,
        doc.expiresAt,
        doc.notes,
      ],
    );
    return this.require(id);
  }

  async update(id: string, input: DocumentInput): Promise<StoredDocument> {
    await this.require(id);
    const doc = validate(input);
    await this.db.execute(
      `UPDATE documents
          SET kind = ?, title = ?, holder = ?, number = ?, expires_at = ?,
              notes = ?
        WHERE id = ?`,
      [
        doc.kind,
        doc.title,
        doc.holder,
        doc.number,
        doc.expiresAt,
        doc.notes,
        id,
      ],
    );
    return this.require(id);
  }

  /** Supprime le document et ses photos. */
  async remove(id: string): Promise<void> {
    await this.require(id);
    await this.db.execute('DELETE FROM documents WHERE id = ?', [id]);
  }

  private async require(id: string): Promise<StoredDocument> {
    const { rows } = await this.db.execute(
      'SELECT * FROM documents WHERE id = ?',
      [id],
    );
    if (rows.length === 0) {
      throw new InventoryError('NOT_FOUND', 'Document introuvable');
    }
    return toDocument(rows[0]);
  }
}
