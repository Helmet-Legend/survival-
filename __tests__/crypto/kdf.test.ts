import { argon2idAsync } from '@noble/hashes/argon2';
import { hkdf } from '@noble/hashes/hkdf';
import { sha256 } from '@noble/hashes/sha2';
import { utf8ToBytes } from '@noble/hashes/utils';

import {
  bytesToHex,
  hexToBytes,
  isHex,
  toSqlCipherRawKey,
  wipe,
} from '../../src/crypto/bytes';
import { deriveDatabaseKey } from '../../src/crypto/kdf';
import { ARGON2ID_PARAMS, HKDF_INFO } from '../../src/crypto/params';
import { JsArgon2, TEST_ARGON2_PARAMS } from './fakes';

const salt = hexToBytes('000102030405060708090a0b0c0d0e0f');
const deviceSecret = new Uint8Array(32).fill(7);

describe('paramètres Argon2id', () => {
  it('respecte le cahier des charges', () => {
    expect(ARGON2ID_PARAMS).toEqual({
      memoryKiB: 65_536,
      iterations: 3,
      parallelism: 2,
      hashLength: 32,
    });
    expect(Object.isFrozen(ARGON2ID_PARAMS)).toBe(true);
  });
});

describe('deriveDatabaseKey', () => {
  const engine = new JsArgon2();
  const derive = (pin: string, s = salt, secret = deviceSecret) =>
    deriveDatabaseKey(engine, pin, s, secret, TEST_ARGON2_PARAMS);

  it("compose Argon2id puis HKDF-SHA256 avec le secret d'appareil", async () => {
    const stretched = await argon2idAsync('482915', salt, {
      m: TEST_ARGON2_PARAMS.memoryKiB,
      t: TEST_ARGON2_PARAMS.iterations,
      p: TEST_ARGON2_PARAMS.parallelism,
      dkLen: 32,
    });
    const expected = hkdf(
      sha256,
      stretched,
      deviceSecret,
      utf8ToBytes(HKDF_INFO),
      32,
    );
    expect(bytesToHex(await derive('482915'))).toBe(bytesToHex(expected));
  });

  it("dépend du PIN, du sel et du secret d'appareil", async () => {
    const base = bytesToHex(await derive('482915'));
    expect(bytesToHex(await derive('482916'))).not.toBe(base);
    expect(bytesToHex(await derive('482915', new Uint8Array(16)))).not.toBe(
      base,
    );
    expect(
      bytesToHex(await derive('482915', salt, new Uint8Array(32).fill(8))),
    ).not.toBe(base);
  });

  it('rejette des entrées de mauvaise taille', async () => {
    await expect(derive('482915', new Uint8Array(8))).rejects.toMatchObject({
      code: 'DERIVATION_FAILED',
    });
    await expect(
      derive('482915', salt, new Uint8Array(16)),
    ).rejects.toMatchObject({ code: 'DERIVATION_FAILED' });
  });

  it('rejette une sortie Argon2 de longueur inattendue', async () => {
    const bad = { argon2id: async () => new Uint8Array(16) };
    await expect(
      deriveDatabaseKey(bad, '482915', salt, deviceSecret, TEST_ARGON2_PARAMS),
    ).rejects.toMatchObject({ code: 'DERIVATION_FAILED' });
  });
});

describe('bytes', () => {
  it('convertit hex <-> octets', () => {
    const bytes = new Uint8Array([0, 1, 0xab, 0xff]);
    expect(bytesToHex(bytes)).toBe('0001abff');
    expect(hexToBytes('0001ABFF')).toEqual(bytes);
    expect(() => hexToBytes('abc')).toThrow(TypeError);
    expect(() => hexToBytes('zz')).toThrow(TypeError);
    expect(isHex('00ff', 2)).toBe(true);
    expect(isHex('00ff', 3)).toBe(false);
  });

  it('produit le format de clé brute SQLCipher', () => {
    const key = new Uint8Array(32).fill(0xab);
    expect(toSqlCipherRawKey(key)).toBe(`x'${'ab'.repeat(32)}'`);
  });

  it('efface les tampons', () => {
    const a = new Uint8Array([1, 2, 3]);
    wipe(a, undefined, null);
    expect(a).toEqual(new Uint8Array(3));
  });
});
