/** Utilitaires octets / hexadécimal sans dépendance. */

const HEX_RE = /^(?:[0-9a-f]{2})*$/;

export function bytesToHex(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i].toString(16).padStart(2, '0');
  }
  return out;
}

export function hexToBytes(hex: string): Uint8Array {
  const normalized = hex.toLowerCase();
  if (!HEX_RE.test(normalized)) {
    throw new TypeError('Chaîne hexadécimale invalide');
  }
  const out = new Uint8Array(normalized.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(normalized.substr(i * 2, 2), 16);
  }
  return out;
}

export function isHex(value: string, byteLength: number): boolean {
  return value.length === byteLength * 2 && HEX_RE.test(value);
}

/**
 * Efface un tampon en mémoire. Ne protège que les `Uint8Array` : les chaînes
 * JavaScript sont immuables et ne peuvent pas être effacées.
 */
export function wipe(...buffers: Array<Uint8Array | null | undefined>): void {
  for (const buffer of buffers) {
    buffer?.fill(0);
  }
}

/**
 * Format de clé brute attendu par SQLCipher (`x'…'`) : la clé est utilisée
 * telle quelle, sans le PBKDF2 interne de SQLCipher.
 */
export function toSqlCipherRawKey(key: Uint8Array): string {
  return `x'${bytesToHex(key)}'`;
}
