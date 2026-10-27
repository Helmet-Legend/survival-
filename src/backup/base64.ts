/* eslint-disable no-bitwise -- encodages binaires */
/** Base64 standard (RFC 4648), sans dépendance à `Buffer` ni `atob`. */
const ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
/** Valeur de chaque caractère base64 par son code (-1 : hors alphabet). */
const LOOKUP = new Int16Array(128).fill(-1);
for (let i = 0; i < ALPHABET.length; i++) {
  LOOKUP[ALPHABET.charCodeAt(i)] = i;
}
const CODES = Array.from(ALPHABET, c => c.charCodeAt(0));
/**
 * Octets traités par bloc : le texte est assemblé bloc par bloc, jamais
 * caractère par caractère (des dizaines de millions de petits morceaux
 * saturaient la mémoire pour une sauvegarde riche en photos).
 */
const CHUNK = 3 * 8192;

export function bytesToBase64(bytes: Uint8Array): string {
  const parts: string[] = [];
  const codes = new Array<number>((CHUNK / 3) * 4);
  for (let start = 0; start < bytes.length; start += CHUNK) {
    const end = Math.min(start + CHUNK, bytes.length);
    let o = 0;
    for (let i = start; i < end; i += 3) {
      const n =
        (bytes[i] << 16) |
        ((i + 1 < end ? bytes[i + 1] : 0) << 8) |
        (i + 2 < end ? bytes[i + 2] : 0);
      codes[o++] = CODES[(n >> 18) & 63];
      codes[o++] = CODES[(n >> 12) & 63];
      codes[o++] = i + 1 < end ? CODES[(n >> 6) & 63] : 61; // '='
      codes[o++] = i + 2 < end ? CODES[n & 63] : 61;
    }
    parts.push(String.fromCharCode.apply(null, codes.slice(0, o)));
  }
  return parts.join('');
}

export function base64ToBytes(text: string): Uint8Array {
  let length = text.length;
  while (length > 0 && text.charCodeAt(length - 1) === 61) {
    length--;
  }
  if (length % 4 === 1) {
    throw new Error('Base64 invalide');
  }
  const out = new Uint8Array(Math.floor((length * 3) / 4));
  const value = (i: number) => {
    const code = text.charCodeAt(i);
    const v = code < 128 ? LOOKUP[code] : -1;
    if (v < 0) {
      throw new Error('Base64 invalide');
    }
    return v;
  };
  let o = 0;
  for (let i = 0; i < length; i += 4) {
    const n =
      (value(i) << 18) |
      (value(i + 1) << 12) |
      (i + 2 < length ? value(i + 2) << 6 : 0) |
      (i + 3 < length ? value(i + 3) : 0);
    out[o++] = (n >> 16) & 255;
    if (i + 2 < length) out[o++] = (n >> 8) & 255;
    if (i + 3 < length) out[o++] = n & 255;
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
