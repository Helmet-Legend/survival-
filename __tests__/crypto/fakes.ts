import { argon2idAsync } from '@noble/hashes/argon2';

import type { Argon2Params } from '../../src/crypto/params';
import type {
  Argon2Engine,
  Clock,
  EncryptedDatabase,
  EncryptedDatabaseDriver,
  RandomSource,
  SecureValueStore,
} from '../../src/crypto/types';

/** Paramètres réduits : la vraie dérivation (64 MiB) est trop lente en JS pur. */
export const TEST_ARGON2_PARAMS: Argon2Params = {
  memoryKiB: 64,
  iterations: 1,
  parallelism: 2,
  hashLength: 32,
};

/** Argon2id de référence en JS pur (@noble/hashes), avec compteur d'appels. */
export class JsArgon2 implements Argon2Engine {
  calls = 0;
  failNext = false;

  async argon2id(
    password: string,
    salt: Uint8Array,
    params: Argon2Params,
  ): Promise<Uint8Array> {
    this.calls++;
    if (this.failNext) {
      this.failNext = false;
      throw new Error('out of memory');
    }
    return argon2idAsync(password, salt, {
      m: params.memoryKiB,
      t: params.iterations,
      p: params.parallelism,
      dkLen: params.hashLength,
    });
  }
}

/** Aléa déterministe (xorshift) : reproductible, pas cryptographique. */
/* eslint-disable no-bitwise -- générateur xorshift */
export class SeededRandom implements RandomSource {
  constructor(private seed: number) {}

  bytes(length: number): Uint8Array {
    const out = new Uint8Array(length);
    for (let i = 0; i < length; i++) {
      this.seed ^= this.seed << 13;
      this.seed ^= this.seed >>> 17;
      this.seed ^= this.seed << 5;
      out[i] = this.seed & 0xff;
    }
    return out;
  }
}

export class MemoryStore implements SecureValueStore {
  value: string | null = null;
  writes = 0;
  /** Fait échouer l'écriture numéro N (1-indexée, comptée depuis la création). */
  failOnWrite: number | null = null;

  async read(): Promise<string | null> {
    return this.value;
  }

  async write(value: string): Promise<void> {
    this.writes++;
    if (this.failOnWrite === this.writes) {
      throw new Error('keychain write failed');
    }
    this.value = value;
  }

  async clear(): Promise<void> {
    this.value = null;
  }
}

export class FakeClock implements Clock {
  constructor(public current = 1_700_000_000_000) {}
  now(): number {
    return this.current;
  }
}

interface FakeFile {
  key: string;
  marker: string;
}

export class FakeDb implements EncryptedDatabase {
  closed = false;
  failRekey = false;

  constructor(
    private readonly files: Map<string, FakeFile>,
    readonly fileName: string,
  ) {}

  /** Contenu factice permettant d'identifier la base ouverte. */
  get marker(): string {
    return this.files.get(this.fileName)!.marker;
  }
  set marker(value: string) {
    this.files.get(this.fileName)!.marker = value;
  }

  async execute(sql: string): Promise<unknown> {
    const rekey = /^PRAGMA rekey = "(x'[0-9a-f]{64}')"$/.exec(sql);
    if (rekey) {
      if (this.failRekey) {
        throw new Error('rekey failed');
      }
      this.files.get(this.fileName)!.key = rekey[1];
      return {};
    }
    throw new Error(`SQL inattendu : ${sql}`);
  }

  close(): void {
    this.closed = true;
  }
}

/** Simule SQLCipher : une base ne s'ouvre qu'avec la clé exacte. */
export class FakeDriver implements EncryptedDatabaseDriver<FakeDb> {
  readonly files = new Map<string, FakeFile>();
  openAttempts: string[] = [];
  createdKeys: string[] = [];

  async create(fileName: string, rawKey: string): Promise<FakeDb> {
    expect(rawKey).toMatch(/^x'[0-9a-f]{64}'$/);
    this.createdKeys.push(rawKey);
    this.files.set(fileName, { key: rawKey, marker: '' });
    return new FakeDb(this.files, fileName);
  }

  async openExisting(fileName: string, rawKey: string): Promise<FakeDb | null> {
    this.openAttempts.push(fileName);
    const file = this.files.get(fileName);
    if (file === undefined) {
      throw new Error('ENOENT');
    }
    return file.key === rawKey ? new FakeDb(this.files, fileName) : null;
  }

  async exists(fileName: string): Promise<boolean> {
    return this.files.has(fileName);
  }

  async remove(fileName: string): Promise<void> {
    this.files.delete(fileName);
  }
}
