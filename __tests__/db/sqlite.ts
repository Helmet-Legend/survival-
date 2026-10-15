/// <reference types="node" />
/**
 * Adaptateurs de test sur le vrai moteur SQLite de Node (`node:sqlite`,
 * FTS5 inclus) : le SQL du schéma est exécuté pour de vrai, seule la couche
 * de chiffrement SQLCipher est simulée.
 */
import type { DatabaseSync as DatabaseSyncType } from 'node:sqlite';

import type { EncryptedDatabaseDriver } from '../../src/crypto/types';
import type { SqlDatabase, SqlRow, SqlValue } from '../../src/db/types';

// `process.getBuiltinModule` contourne le résolveur de Jest, qui ne connaît
// pas encore le module `node:sqlite`.
const { DatabaseSync } = process.getBuiltinModule(
  'node:sqlite',
) as typeof import('node:sqlite');

export class NodeSqliteDb implements SqlDatabase {
  readonly raw: DatabaseSyncType;

  constructor(raw?: DatabaseSyncType) {
    this.raw = raw ?? new DatabaseSync(':memory:');
  }

  async execute(sql: string, params: SqlValue[] = []) {
    const rows = this.raw.prepare(sql).all(...params) as SqlRow[];
    return { rows: rows.map(row => ({ ...row })) };
  }
}

interface StoredFile {
  key: string;
  sqlite: DatabaseSyncType;
}

/** Connexion « chiffrée » : vraie base SQLite, clé vérifiée par le pilote. */
export class SqliteVaultDb extends NodeSqliteDb {
  closed = false;

  constructor(private readonly file: StoredFile) {
    super(file.sqlite);
  }

  async execute(sql: string, params: SqlValue[] = []) {
    if (this.closed) {
      throw new Error('Connexion fermée');
    }
    const rekey = /^PRAGMA rekey = "(x'[0-9a-f]{64}')"$/.exec(sql);
    if (rekey) {
      this.file.key = rekey[1];
      return { rows: [] };
    }
    return super.execute(sql, params);
  }

  close(): void {
    this.closed = true;
  }
}

export class SqliteFakeDriver
  implements EncryptedDatabaseDriver<SqliteVaultDb>
{
  readonly files = new Map<string, StoredFile>();

  async create(fileName: string, rawKey: string) {
    const file = { key: rawKey, sqlite: new DatabaseSync(':memory:') };
    this.files.set(fileName, file);
    return new SqliteVaultDb(file);
  }

  async openExisting(fileName: string, rawKey: string) {
    const file = this.files.get(fileName);
    if (file === undefined) {
      throw new Error('ENOENT');
    }
    return file.key === rawKey ? new SqliteVaultDb(file) : null;
  }

  async exists(fileName: string) {
    return this.files.has(fileName);
  }

  async remove(fileName: string) {
    this.files.delete(fileName);
  }
}
