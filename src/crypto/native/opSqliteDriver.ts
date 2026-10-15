/**
 * Pilote SQLCipher basé sur op-sqlite (compilé avec `"op-sqlite": {
 * "sqlcipher": true }` dans package.json). op-sqlite transmet
 * `encryptionKey` à `sqlite3_key_v2` ; au format `x'…'`, SQLCipher utilise la
 * clé brute sans PBKDF2 interne, ce qui équivaut à `PRAGMA key = "x'…'"`.
 */
import { open, type DB } from '@op-engineering/op-sqlite';

import type { EncryptedDatabaseDriver } from '../types';

/**
 * SQLCipher ne vérifie la clé qu'à la première lecture d'une page : une
 * requête sur sqlite_master échoue (SQLITE_NOTADB) si la clé est fausse.
 */
const KEY_CHECK_SQL = 'SELECT count(*) FROM sqlite_master';

/**
 * Ouvre un fichier existant sans le lire (aucune clé n'est nécessaire pour
 * le supprimer ou vérifier sa présence).
 *
 * Attention : op-sqlite lit `encryptionKey` dès que la propriété existe,
 * même à `undefined`, et échoue alors. La propriété est donc omise.
 */
function tryOpenExisting(name: string): DB | null {
  try {
    return open({ name, failOnCreate: true });
  } catch {
    return null;
  }
}

export const opSqliteDriver: EncryptedDatabaseDriver<DB> = {
  async create(fileName, rawKey) {
    tryOpenExisting(fileName)?.delete();
    const db = open({ name: fileName, encryptionKey: rawKey });
    try {
      // Force l'écriture de l'en-tête chiffré.
      await db.execute('PRAGMA user_version = 0');
      await db.execute(KEY_CHECK_SQL);
      return db;
    } catch (error) {
      db.close();
      throw error;
    }
  },

  async openExisting(fileName, rawKey) {
    const db = open({
      name: fileName,
      encryptionKey: rawKey,
      failOnCreate: true,
    });
    try {
      await db.execute(KEY_CHECK_SQL);
      return db;
    } catch {
      db.close();
      return null;
    }
  },

  async exists(fileName) {
    const db = tryOpenExisting(fileName);
    if (db === null) {
      return false;
    }
    db.close();
    return true;
  },

  async remove(fileName) {
    tryOpenExisting(fileName)?.delete();
  },
};
