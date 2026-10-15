import { FREE_ATTEMPTS, lockoutDelayMs } from '../../src/crypto/attemptLimiter';
import { CryptoError } from '../../src/crypto/errors';
import { SLOT_FILE_NAMES } from '../../src/crypto/params';
import { VaultKeyManager } from '../../src/crypto/VaultKeyManager';
import { parseVaultState } from '../../src/crypto/vaultState';
import {
  FakeClock,
  FakeDriver,
  JsArgon2,
  MemoryStore,
  SeededRandom,
  TEST_ARGON2_PARAMS,
  type FakeDb,
} from './fakes';

const MASTER = '482915';
const DURESS = '730264';
const WRONG = '111112';

function setup(seed = 42) {
  const argon2 = new JsArgon2();
  const store = new MemoryStore();
  const driver = new FakeDriver();
  const clock = new FakeClock();
  const manager = new VaultKeyManager<FakeDb>({
    argon2,
    random: new SeededRandom(seed),
    store,
    driver,
    clock,
    argon2Params: TEST_ARGON2_PARAMS,
  });
  return { argon2, store, driver, clock, manager };
}

async function expectCode(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toMatchObject({ name: 'CryptoError', code });
}

async function rejection(promise: Promise<unknown>): Promise<CryptoError> {
  return promise.then(
    () => {
      throw new Error('La promesse aurait dû échouer');
    },
    (error: CryptoError) => error,
  );
}

/** Initialise et marque chaque base pour savoir laquelle est ouverte ensuite. */
async function initializeMarked(
  ctx: ReturnType<typeof setup>,
  duressPin: string | null = DURESS,
) {
  const { primary, decoy } = await ctx.manager.initialize({
    masterPin: MASTER,
    duressPin: duressPin ?? undefined,
  });
  primary.marker = 'REAL';
  decoy.marker = 'DECOY';
  return { primary, decoy };
}

describe('VaultKeyManager — initialisation', () => {
  it('crée toujours deux bases et un état sans aucune mention du leurre', async () => {
    const ctx = setup();
    await initializeMarked(ctx);

    expect([...ctx.driver.files.keys()].sort()).toEqual([...SLOT_FILE_NAMES]);
    const state = parseVaultState(ctx.store.value!);
    expect(state.slots).toHaveLength(2);
    expect(state.slots[0].salt).not.toEqual(state.slots[1].salt);
    expect(ctx.store.value).not.toMatch(/duress|decoy|master|primary/i);
    expect(await ctx.manager.getStatus()).toEqual({ kind: 'ready' });
  });

  it('crée la seconde base même sans code de contrainte', async () => {
    const ctx = setup();
    const { decoy } = await initializeMarked(ctx, null);

    // Renvoyée ouverte pour recevoir le même schéma que la vraie base.
    expect(decoy.closed).toBe(false);
    expect(ctx.driver.files.size).toBe(2);
    expect(new Set(ctx.driver.createdKeys).size).toBe(2);
  });

  it('tire au hasard le compartiment du code maître', async () => {
    const slots = new Set<number>();
    for (let seed = 1; seed <= 12 && slots.size < 2; seed++) {
      const ctx = setup(seed);
      await initializeMarked(ctx);
      const session = await ctx.manager.unlock(MASTER);
      slots.add(session.slot);
    }
    expect(slots).toEqual(new Set([0, 1]));
  });

  it('refuse des codes identiques, trop courts ou répétitifs', async () => {
    const ctx = setup();
    await expectCode(
      ctx.manager.initialize({ masterPin: MASTER, duressPin: MASTER }),
      'PIN_POLICY',
    );
    await expectCode(
      ctx.manager.initialize({ masterPin: '12345' }),
      'PIN_POLICY',
    );
    await expectCode(
      ctx.manager.initialize({ masterPin: '000000' }),
      'PIN_POLICY',
    );
    expect(ctx.driver.files.size).toBe(0);
  });

  it('refuse une seconde initialisation', async () => {
    const ctx = setup();
    await initializeMarked(ctx);
    await expectCode(
      ctx.manager.initialize({ masterPin: '918273' }),
      'ALREADY_INITIALIZED',
    );
  });

  it("nettoie les fichiers si l'enregistrement de l'état échoue", async () => {
    const ctx = setup();
    ctx.store.failOnWrite = 1;
    await expect(ctx.manager.initialize({ masterPin: MASTER })).rejects.toThrow(
      'keychain write failed',
    );
    expect(ctx.driver.files.size).toBe(0);
    expect(await ctx.manager.getStatus()).toEqual({ kind: 'uninitialized' });
  });

  it('efface un état orphelin quand les bases ont disparu (réinstallation iOS)', async () => {
    const ctx = setup();
    await initializeMarked(ctx);
    ctx.driver.files.clear();

    expect(await ctx.manager.getStatus()).toEqual({ kind: 'uninitialized' });
    expect(ctx.store.value).toBeNull();
    await ctx.manager.initialize({ masterPin: MASTER });
  });

  it('signale une base manquante sur deux', async () => {
    const ctx = setup();
    await initializeMarked(ctx);
    ctx.driver.files.delete(SLOT_FILE_NAMES[0]);
    await expectCode(ctx.manager.unlock(MASTER), 'DATABASE_CORRUPTED');
  });
});

describe('VaultKeyManager — déverrouillage', () => {
  it('ouvre la vraie base avec le code maître', async () => {
    const ctx = setup();
    await initializeMarked(ctx);
    const session = await ctx.manager.unlock(MASTER);
    expect(session.db.marker).toBe('REAL');
  });

  it('ouvre la base factice avec le code de contrainte, sans distinction visible', async () => {
    const ctx = setup();
    await initializeMarked(ctx);
    const master = await ctx.manager.unlock(MASTER);
    const duress = await ctx.manager.unlock(DURESS);

    expect(duress.db.marker).toBe('DECOY');
    expect(duress.slot).not.toBe(master.slot);
    // Même forme de résultat : rien n'indique le mode sous contrainte.
    expect(Object.keys(duress).sort()).toEqual(Object.keys(master).sort());
  });

  it('refuse un code inconnu', async () => {
    const ctx = setup();
    await initializeMarked(ctx);
    await expectCode(ctx.manager.unlock(WRONG), 'INVALID_PIN');
  });

  it('accepte une saisie Unicode composée ou décomposée', async () => {
    const ctx = setup();
    const composed = 'Forêt-noire-42';
    await ctx.manager.initialize({ masterPin: composed });
    const session = await ctx.manager.unlock(composed.normalize('NFD'));
    expect(session.db.fileName).toMatch(/^rs_store_[01]\.db$/);
  });

  it.each([
    ['maître', MASTER],
    ['contrainte', DURESS],
    ['faux', WRONG],
  ])('effectue le même travail quel que soit le code (%s)', async (_, pin) => {
    const ctx = setup();
    await initializeMarked(ctx);
    ctx.argon2.calls = 0;
    ctx.driver.openAttempts = [];

    await ctx.manager.unlock(pin).catch(() => undefined);

    expect(ctx.argon2.calls).toBe(2);
    expect([...ctx.driver.openAttempts].sort()).toEqual([...SLOT_FILE_NAMES]);
  });

  it("n'ouvre rien quand le code de contrainte n'est pas configuré", async () => {
    const ctx = setup();
    await initializeMarked(ctx, null);
    await expectCode(ctx.manager.unlock(DURESS), 'INVALID_PIN');
  });

  it("remonte un échec de dérivation et compte quand même l'essai", async () => {
    const ctx = setup();
    await initializeMarked(ctx);
    ctx.argon2.failNext = true;

    await expectCode(ctx.manager.unlock(MASTER), 'DERIVATION_FAILED');
    expect(parseVaultState(ctx.store.value!).failedAttempts).toBe(1);
  });

  it('signale un état illisible', async () => {
    const ctx = setup();
    await initializeMarked(ctx);
    ctx.store.value = '{"v":1';
    await expectCode(ctx.manager.unlock(MASTER), 'STORAGE_CORRUPTED');
  });

  it('refuse avant initialisation', async () => {
    const ctx = setup();
    await expectCode(ctx.manager.unlock(MASTER), 'NOT_INITIALIZED');
  });
});

describe('VaultKeyManager — limitation des essais', () => {
  it(`bloque après ${FREE_ATTEMPTS} échecs puis double le délai`, async () => {
    const ctx = setup();
    await initializeMarked(ctx);

    for (let i = 1; i < FREE_ATTEMPTS; i++) {
      await expectCode(ctx.manager.unlock(WRONG), 'INVALID_PIN');
    }
    const fifth = await rejection(ctx.manager.unlock(WRONG));
    expect(fifth).toMatchObject({ code: 'INVALID_PIN' });
    expect(fifth.retryAt).toBe(
      ctx.clock.current + lockoutDelayMs(FREE_ATTEMPTS),
    );

    // Même le bon code est refusé pendant le blocage.
    await expectCode(ctx.manager.unlock(MASTER), 'LOCKED_OUT');
    expect(await ctx.manager.getStatus()).toMatchObject({ kind: 'locked' });

    ctx.clock.current = fifth.retryAt!;
    const sixth = await rejection(ctx.manager.unlock(WRONG));
    expect(sixth.retryAt! - ctx.clock.current).toBe(
      2 * lockoutDelayMs(FREE_ATTEMPTS),
    );
  });

  it('remet le compteur à zéro après un succès (y compris code de contrainte)', async () => {
    const ctx = setup();
    await initializeMarked(ctx);
    await expectCode(ctx.manager.unlock(WRONG), 'INVALID_PIN');
    await ctx.manager.unlock(DURESS);

    const state = parseVaultState(ctx.store.value!);
    expect(state.failedAttempts).toBe(0);
    expect(state.lockedUntil).toBe(0);
  });

  it('plafonne le délai', () => {
    expect(lockoutDelayMs(0)).toBe(0);
    expect(lockoutDelayMs(FREE_ATTEMPTS - 1)).toBe(0);
    expect(lockoutDelayMs(10_000)).toBe(60 * 60 * 1000);
  });
});

describe('VaultKeyManager — changement de code', () => {
  const NEW = '905317';

  it('rechiffre la base : seul le nouveau code fonctionne', async () => {
    const ctx = setup();
    await initializeMarked(ctx);

    const session = await ctx.manager.changePin(MASTER, NEW);
    expect(session.db.marker).toBe('REAL');

    await expectCode(ctx.manager.unlock(MASTER), 'INVALID_PIN');
    expect((await ctx.manager.unlock(NEW)).db.marker).toBe('REAL');
    expect((await ctx.manager.unlock(DURESS)).db.marker).toBe('DECOY');
    expect(
      parseVaultState(ctx.store.value!).slots.every(s => !s.pendingSalt),
    ).toBe(true);
  });

  it("refuse un nouveau code qui ouvrirait déjà l'autre compartiment", async () => {
    const ctx = setup();
    await initializeMarked(ctx);
    await expectCode(ctx.manager.changePin(MASTER, DURESS), 'PIN_POLICY');
    expect((await ctx.manager.unlock(MASTER)).db.marker).toBe('REAL');
  });

  it('refuse avec un code actuel faux', async () => {
    const ctx = setup();
    await initializeMarked(ctx);
    await expectCode(ctx.manager.changePin(WRONG, NEW), 'INVALID_PIN');
  });

  it('récupère un changement interrompu APRÈS le rekey', async () => {
    const ctx = setup();
    await initializeMarked(ctx);
    // Écritures pendant changePin : compteur, succès du déverrouillage,
    // sel en attente, validation. On fait échouer la validation.
    ctx.store.failOnWrite = ctx.store.writes + 4;

    await expect(ctx.manager.changePin(MASTER, NEW)).rejects.toThrow(
      'keychain write failed',
    );

    expect((await ctx.manager.unlock(NEW)).db.marker).toBe('REAL');
    expect(
      parseVaultState(ctx.store.value!).slots.every(s => !s.pendingSalt),
    ).toBe(true);
    await expectCode(ctx.manager.unlock(MASTER), 'INVALID_PIN');
  });

  it('récupère un changement interrompu AVANT le rekey', async () => {
    const ctx = setup();
    await initializeMarked(ctx);
    const original = ctx.driver.openExisting.bind(ctx.driver);
    jest.spyOn(ctx.driver, 'openExisting').mockImplementation(async (f, k) => {
      const db = await original(f, k);
      if (db) {
        db.failRekey = true;
      }
      return db;
    });

    await expect(ctx.manager.changePin(MASTER, NEW)).rejects.toThrow(
      'rekey failed',
    );
    jest.restoreAllMocks();

    expect((await ctx.manager.unlock(MASTER)).db.marker).toBe('REAL');
    await expectCode(ctx.manager.unlock(NEW), 'INVALID_PIN');
  });
});

describe('VaultKeyManager — destruction', () => {
  it("efface les deux bases et l'état", async () => {
    const ctx = setup();
    await initializeMarked(ctx);
    await ctx.manager.destroy();
    expect(ctx.driver.files.size).toBe(0);
    expect(await ctx.manager.getStatus()).toEqual({ kind: 'uninitialized' });
  });
});
