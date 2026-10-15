/**
 * Pilote op-sqlite, testé contre une imitation du module natif qui
 * reproduit ses contraintes réelles :
 * - une propriété `encryptionKey` présente mais non textuelle fait échouer
 *   l'ouverture (le natif appelle `asString()` sur la valeur) ;
 * - `failOnCreate` échoue si le fichier n'existe pas ;
 * - lire un fichier avec une autre clé que celle de sa création renvoie
 *   « file is not a database ».
 */
import { opSqliteDriver } from '../../src/crypto/native/opSqliteDriver';

interface FakeFile {
  key: string | null;
}

const mockFiles = new Map<string, FakeFile>();

jest.mock('@op-engineering/op-sqlite', () => ({
  open(params: {
    name: string;
    encryptionKey?: unknown;
    failOnCreate?: boolean;
  }) {
    if ('encryptionKey' in params && typeof params.encryptionKey !== 'string') {
      throw new Error('Value is undefined, expected a String');
    }
    const key = (params.encryptionKey as string | undefined) ?? null;
    let file = mockFiles.get(params.name);
    if (file === undefined) {
      if (params.failOnCreate) {
        throw new Error('unable to open database file');
      }
      file = { key };
      mockFiles.set(params.name, file);
    }
    const opened = file;
    return {
      async execute() {
        if (opened.key !== key) {
          throw new Error(
            '[op-sqlite] statement execution error: file is not a database',
          );
        }
        return { rows: [] };
      },
      close() {},
      delete() {
        mockFiles.delete(params.name);
      },
    };
  },
}));

const KEY_A = `x'${'a'.repeat(64)}'`;
const KEY_B = `x'${'b'.repeat(64)}'`;

beforeEach(() => mockFiles.clear());

describe('opSqliteDriver', () => {
  it('détecte un fichier existant et le supprime', async () => {
    expect(await opSqliteDriver.exists('rs_store_0.db')).toBe(false);
    await opSqliteDriver.create('rs_store_0.db', KEY_A);
    expect(await opSqliteDriver.exists('rs_store_0.db')).toBe(true);

    await opSqliteDriver.remove('rs_store_0.db');
    expect(await opSqliteDriver.exists('rs_store_0.db')).toBe(false);
  });

  it('recrée une base par-dessus un ancien fichier chiffré autrement', async () => {
    // Fichier laissé par une installation ou une tentative précédente.
    await opSqliteDriver.create('rs_store_0.db', KEY_A);
    await expect(
      opSqliteDriver.create('rs_store_0.db', KEY_B),
    ).resolves.toBeDefined();
    expect(
      await opSqliteDriver.openExisting('rs_store_0.db', KEY_B),
    ).not.toBeNull();
    expect(
      await opSqliteDriver.openExisting('rs_store_0.db', KEY_A),
    ).toBeNull();
  });
});
