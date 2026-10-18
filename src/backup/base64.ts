/* eslint-disable no-bitwise -- encodages binaires */
/** Base64 standard (RFC 4648), sans dépendance à `Buffer` ni `atob`. */
const ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const LOOKUP = new Map([...ALPHABET].map((c, i) => [c, i]));

export function bytesToBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const n =
      (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    out += ALPHABET[(n >> 18) & 63] + ALPHABET[(n >> 12) & 63];
    out += i + 1 < bytes.length ? ALPHABET[(n >> 6) & 63] : '=';
    out += i + 2 < bytes.length ? ALPHABET[n & 63] : '=';
  }
  return out;
}

export function base64ToBytes(text: string): Uint8Array {
  const clean = text.replace(/[=]+$/, '');
  if (!/^[A-Za-z0-9+/]*$/.test(clean) || clean.length % 4 === 1) {
    throw new Error('Base64 invalide');
  }
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let o = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const n =
      ((LOOKUP.get(clean[i]) ?? 0) << 18) |
      ((LOOKUP.get(clean[i + 1]) ?? 0) << 12) |
      ((LOOKUP.get(clean[i + 2]) ?? 0) << 6) |
      (LOOKUP.get(clean[i + 3]) ?? 0);
    out[o++] = (n >> 16) & 255;
    if (i + 2 < clean.length) out[o++] = (n >> 8) & 255;
    if (i + 3 < clean.length) out[o++] = n & 255;
  }
  return out;
}

/**
 * UTF-8 → texte, sans `TextDecoder` (absent de certains moteurs JS
 * mobiles). Les séquences invalides donnent U+FFFD.
 */
export function utf8ToText(bytes: Uint8Array): string {
  const parts: string[] = [];
  let chunk: number[] = [];
  for (let i = 0; i < bytes.length; ) {
    const b = bytes[i];
    let cp = 0xfffd;
    let len = 1;
    if (b < 0x80) {
      cp = b;
    } else if (b >= 0xc2 && b < 0xe0 && i + 1 < bytes.length) {
      cp = ((b & 0x1f) << 6) | (bytes[i + 1] & 0x3f);
      len = 2;
    } else if (b >= 0xe0 && b < 0xf0 && i + 2 < bytes.length) {
      cp =
        ((b & 0x0f) << 12) |
        ((bytes[i + 1] & 0x3f) << 6) |
        (bytes[i + 2] & 0x3f);
      len = 3;
    } else if (b >= 0xf0 && b < 0xf5 && i + 3 < bytes.length) {
      cp =
        ((b & 0x07) << 18) |
        ((bytes[i + 1] & 0x3f) << 12) |
        ((bytes[i + 2] & 0x3f) << 6) |
        (bytes[i + 3] & 0x3f);
      len = 4;
    }
    i += len;
    if (cp > 0xffff) {
      cp -= 0x10000;
      chunk.push(0xd800 + (cp >> 10), 0xdc00 + (cp & 0x3ff));
    } else {
      chunk.push(cp);
    }
    if (chunk.length > 8192) {
      parts.push(String.fromCharCode(...chunk));
      chunk = [];
    }
  }
  parts.push(String.fromCharCode(...chunk));
  return parts.join('');
}
