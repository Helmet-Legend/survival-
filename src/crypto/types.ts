/**
 * Ports (interfaces) du module crypto. Les implémentations natives sont dans
 * `./native`, les doublures de test dans `__tests__/crypto/fakes.ts`.
 */
import type { Argon2Params } from './params';

/** Moteur Argon2id. L'implémentation de production doit tourner hors du thread JS/UI. */
export interface Argon2Engine {
  argon2id(
    password: string,
    salt: Uint8Array,
    params: Argon2Params,
  ): Promise<Uint8Array>;
}

/** Générateur d'aléa cryptographique (CSPRNG du système). */
export interface RandomSource {
  bytes(length: number): Uint8Array;
}

/**
 * Stockage d'une seule chaîne dans un espace protégé par le matériel
 * (Android Keystore / iOS Keychain), non sauvegardé et non transférable.
 */
export interface SecureValueStore {
  read(): Promise<string | null>;
  write(value: string): Promise<void>;
  clear(): Promise<void>;
}

export interface Clock {
  now(): number;
}

/** Connexion à une base chiffrée ouverte. */
export interface EncryptedDatabase {
  execute(sql: string): Promise<unknown>;
  close(): void;
}

/** Accès aux fichiers SQLCipher. */
export interface EncryptedDatabaseDriver<
  TDb extends EncryptedDatabase = EncryptedDatabase,
> {
  /** Crée (ou écrase) une base vide chiffrée avec la clé donnée. */
  create(fileName: string, rawKey: string): Promise<TDb>;
  /**
   * Ouvre une base existante et vérifie la clé. Renvoie `null` si la clé est
   * fausse. Lève une erreur si le fichier n'existe pas.
   */
  openExisting(fileName: string, rawKey: string): Promise<TDb | null>;
  exists(fileName: string): Promise<boolean>;
  remove(fileName: string): Promise<void>;
}
