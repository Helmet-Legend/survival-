/**
 * Sauvegarde chiffrée du coffre ouvert, pour retrouver ses données après la
 * perte, le vol ou la réinitialisation du téléphone.
 *
 *   clé     = Argon2id(mot de passe, sel aléatoire)        — 64 MiB, t=3
 *   fichier = XChaCha20-Poly1305(clé, nonce aléatoire, contenu JSON)
 *
 * Le mot de passe est choisi à l'export, distinct du PIN : la sauvegarde
 * se restaure sur un autre téléphone (sans le secret du Keystore). Rien
 * n'est lisible sans lui, et toute modification du fichier est détectée.
 *
 * Le contenu est celui du coffre ouvert : une sauvegarde faite depuis le
 * code de contrainte ne contient que le coffre leurre. Les fiches guides
 * n'y sont pas : elles sont réinstallées avec l'application.
 */
import { xchacha20poly1305 } from '@noble/ciphers/chacha';
import { utf8ToBytes } from '@noble/hashes/utils';

import { normalizePin } from '../crypto/kdf';
import { ARGON2ID_PARAMS, type Argon2Params } from '../crypto/params';
import type { Argon2Engine, RandomSource } from '../crypto/types';
import { SCHEMA_VERSION } from '../db/schema';
import { withTransaction } from '../db/transaction';
import type { SqlDatabase, SqlRow, SqlValue } from '../db/types';
import { forgetVersionsAfterRestore } from '../sync/store';
import { base64ToBytes, bytesToBase64, utf8ToText } from './base64';

export const BACKUP_FORMAT = 'fenrir-sauvegarde';
export const BACKUP_VERSION = 1;
export const BACKUP_PASSWORD_MIN = 8;
/** Extension proposée pour le fichier. */
export const BACKUP_EXTENSION = 'fenrir';

const SALT_LENGTH = 16;
const NONCE_LENGTH = 24;

/**
 * Bornes des paramètres Argon2 lus dans un fichier, avant tout calcul : un
 * fichier piégé ne peut pas réclamer des gigaoctets de mémoire. Elles
 * laissent une large marge au-dessus des paramètres réels (64 Mio, t = 3).
 */
const KDF_LIMITS = {
  memoryKiB: { min: 8, max: 1024 * 1024 },
  iterations: { min: 1, max: 16 },
  parallelism: { min: 1, max: 16 },
};

export type BackupErrorCode =
  | 'WEAK_PASSWORD'
  | 'WRONG_PASSWORD'
  | 'INVALID_FILE'
  | 'NEWER_VERSION'
  | 'CHECK_FAILED';

export class BackupError extends Error {
  readonly code: BackupErrorCode;
  constructor(code: BackupErrorCode, message: string) {
    super(message);
    this.name = 'BackupError';
    this.code = code;
  }
}

interface Envelope {
  format: typeof BACKUP_FORMAT;
  version: number;
  kdf: {
    alg: 'argon2id';
    memoryKiB: number;
    iterations: number;
    parallelism: number;
    salt: string;
  };
  cipher: 'xchacha20poly1305';
  nonce: string;
  data: string;
}

interface Payload {
  schemaVersion: number;
  createdAt: string;
  tables: Record<string, SqlRow[]>;
}

export interface BackupOptions {
  engine: Argon2Engine;
  random: RandomSource;
  params?: Argon2Params;
  now?: Date;
}

export interface BackupSummary {
  createdAt: string;
  rows: number;
  /** Restauration : lignes de chaque table, recomptées après écriture. */
  counts?: Record<string, number>;
}

/**
 * Ordre d'insertion : parents avant enfants (clés étrangères). Les tables
 * inconnues de cette liste viennent ensuite, dans l'ordre du schéma.
 */
const TABLE_ORDER = [
  'settings',
  'bags',
  'boxes',
  'inventory_items',
  'inventory_lots',
  'stock_movements',
  'weapons',
  'documents',
  'photos',
  'poi_locations',
  'crisis_checklists',
  'crisis_checklist_items',
  'family_plan',
  'preparation_marks',
  'barcode_products',
  'barcode_basket',
];

/**
 * Tables sauvegardées : tout sauf les guides (réinstallés), l'index FTS,
 * les cartes hors ligne (lourdes, re-téléchargeables) et le journal de
 * synchronisation (propre à chaque téléphone).
 */
async function backedUpTables(db: SqlDatabase): Promise<string[]> {
  const { rows } = await db.execute(
    `SELECT name FROM sqlite_master
      WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
        AND name NOT LIKE 'survival_guides%'
        AND name NOT LIKE 'map\\_%' ESCAPE '\\'
        AND name NOT LIKE 'sync\\_%' ESCAPE '\\'`,
  );
  const names = rows.map(r => String(r.name));
  const rank = (name: string) => {
    const i = TABLE_ORDER.indexOf(name);
    return i === -1 ? TABLE_ORDER.length : i;
  };
  return names.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}

export function checkBackupPassword(password: string): void {
  if (normalizePin(password).length < BACKUP_PASSWORD_MIN) {
    throw new BackupError(
      'WEAK_PASSWORD',
      `Au moins ${BACKUP_PASSWORD_MIN} caractères`,
    );
  }
}

async function deriveKey(
  engine: Argon2Engine,
  password: string,
  salt: Uint8Array,
  params: Argon2Params,
): Promise<Uint8Array> {
  return engine.argon2id(normalizePin(password), salt, {
    ...params,
    hashLength: 32,
  });
}

/** Contenu chiffré du coffre ouvert, prêt à écrire dans un fichier. */
export async function createBackup(
  db: SqlDatabase,
  password: string,
  options: BackupOptions,
): Promise<{ text: string; summary: BackupSummary }> {
  checkBackupPassword(password);
  const params = options.params ?? ARGON2ID_PARAMS;
  const tables: Record<string, SqlRow[]> = {};
  let rows = 0;
  for (const name of await backedUpTables(db)) {
    const result = await db.execute(`SELECT * FROM "${name}"`);
    tables[name] = result.rows;
    rows += result.rows.length;
  }
  const createdAt = (options.now ?? new Date()).toISOString();
  const payload: Payload = { schemaVersion: SCHEMA_VERSION, createdAt, tables };

  const salt = options.random.bytes(SALT_LENGTH);
  const nonce = options.random.bytes(NONCE_LENGTH);
  const key = await deriveKey(options.engine, password, salt, params);
  try {
    const data = xchacha20poly1305(key, nonce).encrypt(
      utf8ToBytes(JSON.stringify(payload)),
    );
    const envelope: Envelope = {
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      kdf: {
        alg: 'argon2id',
        memoryKiB: params.memoryKiB,
        iterations: params.iterations,
        parallelism: params.parallelism,
        salt: bytesToBase64(salt),
      },
      cipher: 'xchacha20poly1305',
      nonce: bytesToBase64(nonce),
      data: bytesToBase64(data),
    };
    return { text: JSON.stringify(envelope), summary: { createdAt, rows } };
  } finally {
    key.fill(0);
  }
}

function parseEnvelope(text: string): Envelope {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new BackupError(
      'INVALID_FILE',
      'Ce fichier n’est pas une sauvegarde Fenrir',
    );
  }
  const e = value as Partial<Envelope> | null;
  if (
    e === null ||
    typeof e !== 'object' ||
    e.format !== BACKUP_FORMAT ||
    e.cipher !== 'xchacha20poly1305' ||
    e.kdf?.alg !== 'argon2id' ||
    typeof e.nonce !== 'string' ||
    typeof e.data !== 'string' ||
    typeof e.kdf.salt !== 'string'
  ) {
    throw new BackupError(
      'INVALID_FILE',
      'Ce fichier n’est pas une sauvegarde Fenrir',
    );
  }
  if (typeof e.version !== 'number' || e.version > BACKUP_VERSION) {
    throw new BackupError(
      'NEWER_VERSION',
      'Sauvegarde faite avec une version plus récente : mettez Fenrir à jour',
    );
  }
  const kdf = e.kdf as Envelope['kdf'];
  const inRange = (n: unknown, limit: { min: number; max: number }) =>
    Number.isInteger(n) &&
    (n as number) >= limit.min &&
    (n as number) <= limit.max;
  if (
    !inRange(kdf.memoryKiB, KDF_LIMITS.memoryKiB) ||
    !inRange(kdf.iterations, KDF_LIMITS.iterations) ||
    !inRange(kdf.parallelism, KDF_LIMITS.parallelism) ||
    decodedLength(kdf.salt) !== SALT_LENGTH ||
    decodedLength(e.nonce) !== NONCE_LENGTH
  ) {
    throw new BackupError(
      'INVALID_FILE',
      'Sauvegarde abîmée : ses paramètres de chiffrement sont invalides',
    );
  }
  return e as Envelope;
}

function decodedLength(text: string): number {
  try {
    return base64ToBytes(text).length;
  } catch {
    return -1;
  }
}

const INCOHERENT = () =>
  new BackupError(
    'INVALID_FILE',
    'Sauvegarde illisible : son contenu est incohérent. Rien n’a été modifié.',
  );

/** Contenu déchiffré : forme attendue, sinon refus avant toute écriture. */
function parsePayload(text: string): Payload {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw INCOHERENT();
  }
  const p = value as Partial<Payload> | null;
  if (
    p === null ||
    typeof p !== 'object' ||
    !Number.isInteger(p.schemaVersion) ||
    (p.schemaVersion as number) < 1 ||
    typeof p.createdAt !== 'string' ||
    typeof p.tables !== 'object' ||
    p.tables === null ||
    Array.isArray(p.tables)
  ) {
    throw INCOHERENT();
  }
  for (const rows of Object.values(p.tables)) {
    if (!Array.isArray(rows)) {
      throw INCOHERENT();
    }
    for (const row of rows) {
      if (row === null || typeof row !== 'object' || Array.isArray(row)) {
        throw INCOHERENT();
      }
      for (const cell of Object.values(row)) {
        if (
          cell !== null &&
          typeof cell !== 'string' &&
          !(typeof cell === 'number' && Number.isFinite(cell))
        ) {
          throw INCOHERENT();
        }
      }
    }
  }
  return p as Payload;
}

/** Déchiffre une sauvegarde sans rien modifier (mot de passe faux : erreur). */
async function decrypt(
  text: string,
  password: string,
  engine: Argon2Engine,
): Promise<Payload> {
  const envelope = parseEnvelope(text);
  const { kdf } = envelope;
  const key = await deriveKey(engine, password, base64ToBytes(kdf.salt), {
    memoryKiB: kdf.memoryKiB,
    iterations: kdf.iterations,
    parallelism: kdf.parallelism,
    hashLength: 32,
  });
  let plain: Uint8Array;
  try {
    plain = xchacha20poly1305(key, base64ToBytes(envelope.nonce)).decrypt(
      base64ToBytes(envelope.data),
    );
  } catch {
    throw new BackupError(
      'WRONG_PASSWORD',
      'Mot de passe incorrect, ou fichier abîmé',
    );
  } finally {
    key.fill(0);
  }
  const payload = parsePayload(utf8ToText(plain));
  if (payload.schemaVersion > SCHEMA_VERSION) {
    throw new BackupError(
      'NEWER_VERSION',
      'Sauvegarde faite avec une version plus récente : mettez Fenrir à jour',
    );
  }
  return payload;
}

/**
 * Remplace tout le contenu du coffre ouvert par celui de la sauvegarde, en
 * une seule transaction : en cas d'erreur, rien n'est changé. Les colonnes
 * absentes d'une ancienne sauvegarde prennent leur valeur par défaut.
 */
export async function restoreBackup(
  db: SqlDatabase,
  text: string,
  password: string,
  engine: Argon2Engine,
): Promise<BackupSummary> {
  const payload = await decrypt(text, password, engine);
  const tables = await backedUpTables(db);
  let rows = 0;
  const counts: Record<string, number> = {};
  await withTransaction(db, async () => {
    // Les clés étrangères sont vérifiées à la validation, pas ligne à ligne.
    await db.execute('PRAGMA defer_foreign_keys = ON');
    // Le remplacement n'est pas une suite de modifications à partager : le
    // suivi de synchronisation est recréé à la fin.
    await db.execute(
      "INSERT OR REPLACE INTO sync_meta (key, value) VALUES ('applying', '1')",
    );
    for (const name of [...tables].reverse()) {
      await db.execute(`DELETE FROM "${name}"`);
    }
    for (const name of tables) {
      counts[name] = 0;
      const source = payload.tables[name] ?? [];
      if (source.length === 0) {
        continue;
      }
      const { rows: info } = await db.execute(`PRAGMA table_info("${name}")`);
      const known = new Set(info.map(c => String(c.name)));
      for (const row of source) {
        const columns = Object.keys(row).filter(c => known.has(c));
        if (columns.length === 0) {
          continue;
        }
        await db.execute(
          `INSERT INTO "${name}" (${columns.map(c => `"${c}"`).join(', ')})
           VALUES (${columns.map(() => '?').join(', ')})`,
          columns.map(c => row[c] as SqlValue),
        );
        rows++;
        counts[name]++;
      }
    }
    await checkRestored(db, counts);
    await forgetVersionsAfterRestore(db);
    await db.execute("DELETE FROM sync_meta WHERE key = 'applying'");
  });
  return { createdAt: payload.createdAt, rows, counts };
}

/**
 * Contrôle avant validation : chaque table contient exactement les lignes
 * écrites, et aucun lien ne pointe dans le vide. Sinon tout est annulé.
 */
async function checkRestored(
  db: SqlDatabase,
  expected: Record<string, number>,
): Promise<void> {
  for (const [name, count] of Object.entries(expected)) {
    const { rows } = await db.execute(`SELECT count(*) AS n FROM "${name}"`);
    if (Number(rows[0].n) !== count) {
      throw new BackupError(
        'CHECK_FAILED',
        'Contrôle après restauration échoué : rien n’a été modifié.',
      );
    }
  }
  const { rows: broken } = await db.execute('PRAGMA foreign_key_check');
  if (broken.length > 0) {
    throw new BackupError(
      'CHECK_FAILED',
      'Sauvegarde incomplète : des éléments y renvoient à des fiches absentes. Rien n’a été modifié.',
    );
  }
}
