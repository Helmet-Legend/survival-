/**
 * Gestion des deux compartiments chiffrés et du mode sous contrainte.
 *
 * Principe de déni plausible :
 * - Chaque installation possède TOUJOURS deux bases (`SLOT_FILE_NAMES`) et
 *   deux sels, que le code de contrainte soit configuré ou non. Sans code de
 *   contrainte, la seconde base est chiffrée avec une clé aléatoire jetée.
 * - L'attribution « réel / leurre » est tirée au hasard à l'initialisation
 *   et n'est enregistrée nulle part. À l'exécution, le module ne sait pas
 *   quelle base est le leurre : il ouvre simplement celle que le code
 *   déverrouille.
 * - Chaque essai dérive les clés des deux compartiments et tente d'ouvrir
 *   les deux bases, quel que soit le résultat : la durée de déverrouillage
 *   ne dépend pas de la base ouverte.
 */
import { lockoutDelayMs } from './attemptLimiter';
import { bytesToHex, hexToBytes, toSqlCipherRawKey, wipe } from './bytes';
import { CryptoError } from './errors';
import { deriveDatabaseKey } from './kdf';
import {
  ARGON2ID_PARAMS,
  DATABASE_KEY_LENGTH,
  DEVICE_SECRET_LENGTH,
  KEY_SLOT_FORMAT_VERSION,
  SALT_LENGTH,
  SLOT_FILE_NAMES,
  type Argon2Params,
  type SlotIndex,
} from './params';
import { assertPinAcceptable, pinsAreEqual } from './pinPolicy';
import type {
  Argon2Engine,
  Clock,
  EncryptedDatabase,
  EncryptedDatabaseDriver,
  RandomSource,
  SecureValueStore,
} from './types';
import {
  parseVaultState,
  serializeVaultState,
  type VaultState,
} from './vaultState';

export interface VaultKeyManagerDeps<TDb extends EncryptedDatabase> {
  argon2: Argon2Engine;
  random: RandomSource;
  store: SecureValueStore;
  driver: EncryptedDatabaseDriver<TDb>;
  clock?: Clock;
  /** Surchargé uniquement par les tests ; la production utilise le cahier des charges. */
  argon2Params?: Argon2Params;
}

export type VaultStatus =
  | { kind: 'uninitialized' }
  | { kind: 'ready' }
  | { kind: 'locked'; retryAt: number };

/** Base déverrouillée. `slot` ne révèle rien : l'attribution est aléatoire. */
export interface VaultSession<
  TDb extends EncryptedDatabase = EncryptedDatabase,
> {
  db: TDb;
  slot: SlotIndex;
}

export interface InitializeResult<
  TDb extends EncryptedDatabase = EncryptedDatabase,
> {
  /** Base ouverte par le code maître. */
  primary: TDb;
  /** Base ouverte par le code de contrainte, à remplir de données anodines. */
  decoy: TDb | null;
}

const SLOTS: readonly SlotIndex[] = [0, 1];
const systemClock: Clock = { now: () => Date.now() };

interface Candidate {
  slot: SlotIndex;
  saltHex: string;
  pending: boolean;
  key: Uint8Array;
}

export class VaultKeyManager<
  TDb extends EncryptedDatabase = EncryptedDatabase,
> {
  private readonly argon2: Argon2Engine;
  private readonly random: RandomSource;
  private readonly store: SecureValueStore;
  private readonly driver: EncryptedDatabaseDriver<TDb>;
  private readonly clock: Clock;
  private readonly params: Argon2Params;
  /** Sérialise les opérations : deux déverrouillages simultanés fausseraient le compteur. */
  private queue: Promise<unknown> = Promise.resolve();

  constructor(deps: VaultKeyManagerDeps<TDb>) {
    this.argon2 = deps.argon2;
    this.random = deps.random;
    this.store = deps.store;
    this.driver = deps.driver;
    this.clock = deps.clock ?? systemClock;
    this.params = deps.argon2Params ?? ARGON2ID_PARAMS;
  }

  getStatus(): Promise<VaultStatus> {
    return this.exclusive(async () => {
      const state = await this.loadState();
      if (state === null) {
        return { kind: 'uninitialized' };
      }
      if (state.lockedUntil > this.clock.now()) {
        return { kind: 'locked', retryAt: state.lockedUntil };
      }
      return { kind: 'ready' };
    });
  }

  /**
   * Crée les deux compartiments. `duressPin` est facultatif : sans lui, le
   * second compartiment existe quand même, sous une clé aléatoire perdue.
   */
  initialize(options: {
    masterPin: string;
    duressPin?: string;
  }): Promise<InitializeResult<TDb>> {
    return this.exclusive(async () => {
      const { masterPin, duressPin } = options;
      assertPinAcceptable(masterPin);
      if (duressPin !== undefined) {
        assertPinAcceptable(duressPin);
        if (pinsAreEqual(masterPin, duressPin)) {
          throw new CryptoError(
            'PIN_POLICY',
            'Les deux codes doivent être différents',
          );
        }
      }
      if ((await this.loadState()) !== null) {
        throw new CryptoError('ALREADY_INITIALIZED', 'Le coffre existe déjà');
      }

      const deviceSecret = this.random.bytes(DEVICE_SECRET_LENGTH);
      const salts = SLOTS.map(() => this.random.bytes(SALT_LENGTH));
      const primarySlot: SlotIndex = (this.random.bytes(1)[0] % 2) as SlotIndex;
      const decoySlot: SlotIndex = primarySlot === 0 ? 1 : 0;

      const keys: Uint8Array[] = [];
      const opened: TDb[] = [];
      try {
        keys[primarySlot] = await deriveDatabaseKey(
          this.argon2,
          masterPin,
          salts[primarySlot],
          deviceSecret,
          this.params,
        );
        keys[decoySlot] =
          duressPin === undefined
            ? this.random.bytes(DATABASE_KEY_LENGTH)
            : await deriveDatabaseKey(
                this.argon2,
                duressPin,
                salts[decoySlot],
                deviceSecret,
                this.params,
              );

        for (const slot of SLOTS) {
          opened[slot] = await this.driver.create(
            SLOT_FILE_NAMES[slot],
            toSqlCipherRawKey(keys[slot]),
          );
        }

        await this.saveState({
          v: KEY_SLOT_FORMAT_VERSION,
          deviceSecret: bytesToHex(deviceSecret),
          slots: [
            { salt: bytesToHex(salts[0]) },
            { salt: bytesToHex(salts[1]) },
          ],
          failedAttempts: 0,
          lockedUntil: 0,
        });
      } catch (error) {
        for (const db of opened) {
          db?.close();
        }
        await this.removeFilesQuietly();
        throw error;
      } finally {
        wipe(deviceSecret, ...salts, ...keys);
      }

      let decoy: TDb | null = opened[decoySlot];
      if (duressPin === undefined) {
        decoy.close();
        decoy = null;
      }
      return { primary: opened[primarySlot], decoy };
    });
  }

  /** Ouvre la base correspondant au code saisi (maître ou contrainte). */
  unlock(pin: string): Promise<VaultSession<TDb>> {
    return this.exclusive(() => this.unlockInternal(pin));
  }

  /**
   * Change le code du compartiment ouvert par `currentPin`. Renvoie la
   * session, déjà rechiffrée avec la nouvelle clé.
   */
  changePin(currentPin: string, newPin: string): Promise<VaultSession<TDb>> {
    return this.exclusive(async () => {
      assertPinAcceptable(newPin);
      if (pinsAreEqual(currentPin, newPin)) {
        throw new CryptoError(
          'PIN_POLICY',
          "Le nouveau code doit être différent de l'ancien",
        );
      }

      const session = await this.unlockInternal(currentPin);
      const deviceSecret = await this.readDeviceSecret();
      let newKey: Uint8Array | undefined;
      try {
        // Le nouveau code ne doit pas déjà ouvrir l'autre compartiment :
        // sinon un même code ouvrirait deux bases.
        if (await this.pinOpensOtherSlot(newPin, session.slot, deviceSecret)) {
          throw new CryptoError('PIN_POLICY', "Ce code n'est pas autorisé");
        }

        const newSalt = this.random.bytes(SALT_LENGTH);
        newKey = await deriveDatabaseKey(
          this.argon2,
          newPin,
          newSalt,
          deviceSecret,
          this.params,
        );
        const newSaltHex = bytesToHex(newSalt);
        wipe(newSalt);

        // 1. Journaliser le nouveau sel avant de toucher à la base.
        const state = await this.requireState();
        state.slots[session.slot] = {
          salt: state.slots[session.slot].salt,
          pendingSalt: newSaltHex,
        };
        await this.saveState(state);

        // 2. Rechiffrer la base.
        await session.db.execute(
          `PRAGMA rekey = "${toSqlCipherRawKey(newKey)}"`,
        );

        // 3. Valider.
        state.slots[session.slot] = { salt: newSaltHex };
        await this.saveState(state);
        return session;
      } catch (error) {
        session.db.close();
        throw error;
      } finally {
        wipe(deviceSecret, newKey);
      }
    });
  }

  /** Efface définitivement les deux bases et l'état (irréversible). */
  destroy(): Promise<void> {
    return this.exclusive(async () => {
      await this.removeFilesQuietly();
      await this.store.clear();
    });
  }

  // --- interne -------------------------------------------------------------

  private async unlockInternal(pin: string): Promise<VaultSession<TDb>> {
    const state = await this.requireState();
    const now = this.clock.now();
    if (state.lockedUntil > now) {
      throw new CryptoError('LOCKED_OUT', 'Trop de tentatives', {
        retryAt: state.lockedUntil,
      });
    }

    // Compter l'essai avant de dériver (voir attemptLimiter.ts).
    const attempts = state.failedAttempts + 1;
    const delay = lockoutDelayMs(attempts);
    state.failedAttempts = attempts;
    state.lockedUntil = delay > 0 ? now + delay : 0;
    await this.saveState(state);

    const deviceSecret = hexToBytes(state.deviceSecret);
    const candidates: Candidate[] = [];
    try {
      for (const slot of SLOTS) {
        const record = state.slots[slot];
        const salts: Array<[string, boolean]> = [[record.salt, false]];
        if (record.pendingSalt !== undefined) {
          salts.push([record.pendingSalt, true]);
        }
        for (const [saltHex, pending] of salts) {
          const salt = hexToBytes(saltHex);
          try {
            const key = await deriveDatabaseKey(
              this.argon2,
              pin,
              salt,
              deviceSecret,
              this.params,
            );
            candidates.push({ slot, saltHex, pending, key });
          } finally {
            wipe(salt);
          }
        }
      }
    } catch (error) {
      wipe(...candidates.map(c => c.key));
      throw error;
    } finally {
      wipe(deviceSecret);
    }

    // Tenter TOUTES les ouvertures, sans sortie anticipée.
    let match: { candidate: Candidate; db: TDb } | null = null;
    let ioError: unknown = null;
    for (const candidate of candidates) {
      try {
        const db = await this.driver.openExisting(
          SLOT_FILE_NAMES[candidate.slot],
          toSqlCipherRawKey(candidate.key),
        );
        if (db !== null) {
          if (match === null) {
            match = { candidate, db };
          } else {
            db.close();
          }
        }
      } catch (error) {
        ioError = error;
      } finally {
        wipe(candidate.key);
      }
    }

    if (match === null) {
      if (ioError !== null) {
        throw new CryptoError(
          'DATABASE_CORRUPTED',
          'Une base de données est illisible',
          { cause: ioError },
        );
      }
      throw new CryptoError('INVALID_PIN', 'Code incorrect', {
        retryAt: state.lockedUntil > 0 ? state.lockedUntil : undefined,
      });
    }

    // Succès : remise à zéro du compteur et résolution d'un changement de
    // code interrompu (le sel qui a fonctionné devient le sel courant).
    const { slot, saltHex } = match.candidate;
    state.failedAttempts = 0;
    state.lockedUntil = 0;
    state.slots[slot] = { salt: saltHex };
    try {
      await this.saveState(state);
    } catch (error) {
      match.db.close();
      throw error;
    }
    return { db: match.db, slot };
  }

  private async pinOpensOtherSlot(
    pin: string,
    currentSlot: SlotIndex,
    deviceSecret: Uint8Array,
  ): Promise<boolean> {
    const state = await this.requireState();
    const otherSlot: SlotIndex = currentSlot === 0 ? 1 : 0;
    const salt = hexToBytes(state.slots[otherSlot].salt);
    let key: Uint8Array | undefined;
    try {
      key = await deriveDatabaseKey(
        this.argon2,
        pin,
        salt,
        deviceSecret,
        this.params,
      );
      const db = await this.driver.openExisting(
        SLOT_FILE_NAMES[otherSlot],
        toSqlCipherRawKey(key),
      );
      if (db === null) {
        return false;
      }
      db.close();
      return true;
    } finally {
      wipe(salt, key);
    }
  }

  private async readDeviceSecret(): Promise<Uint8Array> {
    return hexToBytes((await this.requireState()).deviceSecret);
  }

  /**
   * Charge l'état. Si l'état existe mais que les bases ont disparu (cas iOS :
   * le Keychain survit à la désinstallation), l'état orphelin est effacé.
   */
  private async loadState(): Promise<VaultState | null> {
    const raw = await this.store.read();
    if (raw === null) {
      return null;
    }
    const state = parseVaultState(raw);
    const present = await Promise.all(
      SLOT_FILE_NAMES.map(name => this.driver.exists(name)),
    );
    if (!present[0] && !present[1]) {
      await this.store.clear();
      return null;
    }
    if (!present[0] || !present[1]) {
      throw new CryptoError(
        'DATABASE_CORRUPTED',
        'Une base de données est manquante',
      );
    }
    return state;
  }

  private async requireState(): Promise<VaultState> {
    const state = await this.loadState();
    if (state === null) {
      throw new CryptoError('NOT_INITIALIZED', "Le coffre n'existe pas encore");
    }
    return state;
  }

  private saveState(state: VaultState): Promise<void> {
    return this.store.write(serializeVaultState(state));
  }

  private async removeFilesQuietly(): Promise<void> {
    for (const name of SLOT_FILE_NAMES) {
      try {
        await this.driver.remove(name);
      } catch {
        // Fichier absent : rien à faire.
      }
    }
  }

  private exclusive<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task, task);
    this.queue = run.catch(() => undefined);
    return run;
  }
}
