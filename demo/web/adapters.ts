/**
 * Adaptateurs navigateur pour la démo web. Ils remplacent les modules natifs
 * de l'application (SQLCipher, Keychain, Argon2 natif). Le code métier
 * importé de `src/` est exactement celui de l'application.
 */
import sqlite3InitModule, {
  type Database,
  type Sqlite3Static,
} from '@sqlite.org/sqlite-wasm';
import { argon2idAsync } from '@noble/hashes/argon2';

import type { Argon2Params } from '../../src/crypto/params';
import type {
  Argon2Engine,
  EncryptedDatabaseDriver,
  SecureValueStore,
} from '../../src/crypto/types';
import type { SqlDatabase, SqlRow, SqlValue } from '../../src/db/types';

export async function loadSqlite(wasmBase64: string): Promise<Sqlite3Static> {
  const binary = Uint8Array.from(atob(wasmBase64), c => c.charCodeAt(0));
  const init = sqlite3InitModule as unknown as (
    module: Record<string, unknown>,
  ) => Promise<Sqlite3Static>;
  return init({
    wasmBinary: binary.buffer,
    locateFile: (file: string) => file,
    print: () => undefined,
    printErr: () => undefined,
  });
}

/**
 * Paramètres réduits : Argon2id en JavaScript pur avec 64 MiB prendrait
 * plusieurs secondes par essai. L'application native utilise les paramètres
 * du cahier des charges.
 */
export const DEMO_ARGON2_PARAMS: Argon2Params = {
  memoryKiB: 8192,
  iterations: 3,
  parallelism: 2,
  hashLength: 32,
};

export const jsArgon2: Argon2Engine = {
  argon2id(password, salt, params) {
    return argon2idAsync(password, salt, {
      m: params.memoryKiB,
      t: params.iterations,
      p: params.parallelism,
      dkLen: params.hashLength,
    });
  },
};

export class MemoryStore implements SecureValueStore {
  /** Lisible par le panneau « coulisses » de la démo. */
  value: string | null = null;
  async read() {
    return this.value;
  }
  async write(value: string) {
    this.value = value;
  }
  async clear() {
    this.value = null;
  }
}

interface MemoryFile {
  key: string;
  db: Database;
}

/** Connexion à une base « chiffrée » : vraie base SQLite en mémoire. */
export class BrowserVaultDb implements SqlDatabase {
  closed = false;
  constructor(private readonly file: MemoryFile, readonly fileName: string) {}

  async execute(sql: string, params: SqlValue[] = []) {
    if (this.closed) {
      throw new Error('Connexion fermée');
    }
    const rekey = /^PRAGMA rekey = "(x'[0-9a-f]{64}')"$/.exec(sql);
    if (rekey) {
      this.file.key = rekey[1];
      return { rows: [] };
    }
    const rows = this.file.db.selectObjects(sql, params) as SqlRow[];
    return { rows };
  }

  close() {
    this.closed = true;
  }
}

/**
 * Simule SQLCipher : chaque « fichier » est une base SQLite en mémoire qui
 * ne s'ouvre qu'avec la clé exacte dérivée du code.
 */
export class MemoryDriver implements EncryptedDatabaseDriver<BrowserVaultDb> {
  readonly files = new Map<string, MemoryFile>();
  /** Dernier fichier ouvert avec succès (pour le panneau « coulisses »). */
  lastOpened: string | null = null;

  constructor(private readonly sqlite3: Sqlite3Static) {}

  async create(fileName: string, rawKey: string) {
    this.files.get(fileName)?.db.close();
    const file = { key: rawKey, db: new this.sqlite3.oo1.DB(':memory:') };
    this.files.set(fileName, file);
    return new BrowserVaultDb(file, fileName);
  }

  async openExisting(fileName: string, rawKey: string) {
    const file = this.files.get(fileName);
    if (file === undefined) {
      throw new Error('Fichier introuvable');
    }
    if (file.key !== rawKey) {
      return null;
    }
    this.lastOpened = fileName;
    return new BrowserVaultDb(file, fileName);
  }

  async exists(fileName: string) {
    return this.files.has(fileName);
  }

  async remove(fileName: string) {
    this.files.get(fileName)?.db.close();
    this.files.delete(fileName);
  }
}
