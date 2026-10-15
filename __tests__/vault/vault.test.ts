import { VaultKeyManager } from '../../src/crypto/VaultKeyManager';
import { searchGuides, SCHEMA_VERSION } from '../../src/db';
import { getSchemaVersion } from '../../src/db/migrate';
import { createVault, openVault, type VaultContent } from '../../src/vault';
import {
  SeededRandom,
  JsArgon2,
  MemoryStore,
  TEST_ARGON2_PARAMS,
} from '../crypto/fakes';
import { SqliteFakeDriver, SqliteVaultDb } from '../db/sqlite';

const MASTER = '482915';
const DURESS = '730264';

const content: VaultContent = {
  guides: [
    {
      slug: 'garrot',
      title: 'Poser un garrot',
      category: 'secourisme',
      body: 'Hémorragie massive : garrot au-dessus de la plaie.',
    },
  ],
};

function setup() {
  const driver = new SqliteFakeDriver();
  const manager = new VaultKeyManager<SqliteVaultDb>({
    argon2: new JsArgon2(),
    random: new SeededRandom(7),
    store: new MemoryStore(),
    driver,
    argon2Params: TEST_ARGON2_PARAMS,
  });
  return { driver, manager };
}

async function schemaOf(db: SqliteVaultDb) {
  const { rows } = await db.execute(
    'SELECT type, name, sql FROM sqlite_master ORDER BY type, name',
  );
  return rows;
}

describe('vault', () => {
  it.each([
    ['avec code de contrainte', DURESS],
    ['sans code de contrainte', undefined],
  ])(
    'donne aux deux bases le même schéma et les mêmes fiches (%s)',
    async (_, duressPin) => {
      const { driver, manager } = setup();
      const primary = await createVault(manager, content, {
        masterPin: MASTER,
        duressPin,
      });

      primary.close();
      const [a, b] = [...driver.files.values()].map(
        file => new SqliteVaultDb(file),
      );
      expect(await schemaOf(a)).toEqual(await schemaOf(b));
      expect(await getSchemaVersion(a)).toBe(SCHEMA_VERSION);
      expect(await getSchemaVersion(b)).toBe(SCHEMA_VERSION);
      expect(await searchGuides(a, 'garrot')).toHaveLength(1);
      expect(await searchGuides(b, 'garrot')).toHaveLength(1);
    },
  );

  it('ferme la base factice et renvoie la vraie base ouverte', async () => {
    const { manager } = setup();
    const seedDecoy = jest.fn(
      async (db: { execute: SqliteVaultDb['execute'] }) => {
        await db.execute(
          "INSERT INTO inventory_items (id, name, category, unit) VALUES ('d1', 'Piles AA', 'energy', 'unit')",
        );
      },
    );

    const primary = await createVault(
      manager,
      { ...content, seedDecoy },
      {
        masterPin: MASTER,
        duressPin: DURESS,
      },
    );
    expect(primary.closed).toBe(false);
    expect(seedDecoy).toHaveBeenCalledTimes(1);

    const real = await openVault(manager, content, MASTER);
    const decoy = await openVault(manager, content, DURESS);
    const count = async (db: SqliteVaultDb) =>
      (await db.execute('SELECT count(*) AS n FROM inventory_items')).rows[0].n;
    expect(await count(real)).toBe(0);
    expect(await count(decoy)).toBe(1);
  });

  it("n'appelle pas seedDecoy sans code de contrainte", async () => {
    const { manager } = setup();
    const seedDecoy = jest.fn(async () => undefined);
    await createVault(
      manager,
      { ...content, seedDecoy },
      { masterPin: MASTER },
    );
    expect(seedDecoy).not.toHaveBeenCalled();
  });

  it('active les clés étrangères à chaque ouverture', async () => {
    const { manager } = setup();
    (await createVault(manager, content, { masterPin: MASTER })).close();
    const db = await openVault(manager, content, MASTER);
    expect((await db.execute('PRAGMA foreign_keys')).rows[0].foreign_keys).toBe(
      1,
    );
  });

  it('propage une erreur de code sans rien ouvrir', async () => {
    const { manager } = setup();
    (await createVault(manager, content, { masterPin: MASTER })).close();
    await expect(openVault(manager, content, '999999')).rejects.toMatchObject({
      code: 'INVALID_PIN',
    });
  });
});
