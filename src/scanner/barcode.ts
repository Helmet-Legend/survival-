/**
 * Codes EAN/UPC : validation de la clé de contrôle et forme canonique. Un
 * même produit peut être lu en UPC-A (12 chiffres), UPC-E (8) ou EAN-13 :
 * tous sont ramenés à l'EAN-13, sauf l'EAN-8 qui reste à 8 chiffres.
 */
import { parseBoxQr } from '../inventory/boxRepository';

function checkDigitValid(digits: string): boolean {
  let sum = 0;
  const body = digits.slice(0, -1);
  for (let i = 0; i < body.length; i++) {
    // Poids 3 pour le chiffre le plus à droite du corps, puis alternance.
    const weight = (body.length - i) % 2 === 1 ? 3 : 1;
    sum += Number(body[i]) * weight;
  }
  return (10 - (sum % 10)) % 10 === Number(digits[digits.length - 1]);
}

/** UPC-E (8 chiffres, système 0 ou 1) développé en UPC-A (12 chiffres). */
export function expandUpcE(code: string): string | null {
  if (!/^[01]\d{7}$/.test(code)) {
    return null;
  }
  const [s, d1, d2, d3, d4, d5, d6, check] = code.split('');
  let body: string;
  switch (d6) {
    case '0':
    case '1':
    case '2':
      body = `${d1}${d2}${d6}0000${d3}${d4}${d5}`;
      break;
    case '3':
      body = `${d1}${d2}${d3}00000${d4}${d5}`;
      break;
    case '4':
      body = `${d1}${d2}${d3}${d4}00000${d5}`;
      break;
    default:
      body = `${d1}${d2}${d3}${d4}${d5}0000${d6}`;
  }
  return `${s}${body}${check}`;
}

/**
 * Forme canonique d'un code lu ou saisi, ou null s'il n'est pas un EAN/UPC
 * valide. `format` vient du lecteur natif ; absent pour une saisie.
 */
export function normalizeBarcode(raw: string, format?: string): string | null {
  const code = raw.replace(/[\s-]/g, '');
  if (!/^\d+$/.test(code)) {
    return null;
  }
  if (code.length === 8 && format === 'UPC_E') {
    const upcA = expandUpcE(code);
    return upcA !== null && checkDigitValid(upcA) ? `0${upcA}` : null;
  }
  if (code.length === 8) {
    return checkDigitValid(code) ? code : null;
  }
  if (code.length === 12 || code.length === 13) {
    const ean = code.padStart(13, '0');
    return checkDigitValid(ean) ? ean : null;
  }
  if (code.length === 14 && checkDigitValid(code)) {
    // GTIN-14 commençant par 0 (Data Matrix des médicaments) : c'est un
    // EAN-13 (le code CIP 13) ; sinon un carton, gardé tel quel.
    return code.startsWith('0') ? code.slice(1) : code;
  }
  return null;
}

/** Une lecture : le code canonique, et ce que le Data Matrix apporte en plus. */
export interface ScanRead {
  code: string;
  /** Péremption `AAAA-MM-JJ` lue dans le code (Data Matrix GS1). */
  expiry?: string;
  lot?: string;
  /** Étiquette d'une boîte de rangement : son identifiant. */
  box?: string;
}

const GS = String.fromCharCode(29);

/** `AAMMJJ` GS1 en `AAAA-MM-JJ` ; jour 00 = dernier jour du mois. */
function gs1Date(value: string): string | undefined {
  if (!/^\d{6}$/.test(value)) {
    return undefined;
  }
  const year = 2000 + Number(value.slice(0, 2));
  const month = Number(value.slice(2, 4));
  let day = Number(value.slice(4, 6));
  if (month < 1 || month > 12) {
    return undefined;
  }
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (day === 0) {
    day = last;
  }
  if (day > last) {
    return undefined;
  }
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(
    2,
    '0',
  )}`;
}

/**
 * Lit les données GS1 d'un Data Matrix (boîtes de médicaments) : GTIN (01),
 * péremption (17), lot (10) ; numéro de série (21) et autres champs sont
 * ignorés. Null si le texte n'est pas au format GS1 ou sans GTIN valide.
 */
export function parseGs1(raw: string): ScanRead | null {
  // Forme lisible « (01)…(17)…(10)… » : ramenée à la forme brute.
  if (/^\(\d{2,4}\)/.test(raw.trim())) {
    const pieces = raw.trim().split(/\((\d{2,4})\)/);
    const fields: string[] = [];
    for (let i = 1; i + 1 < pieces.length; i += 2) {
      fields.push(pieces[i] + pieces[i + 1]);
    }
    raw = fields.join(GS);
  }
  let s = raw.replace(/^\](d2|C1|Q3)/, '');
  if (s.startsWith(GS)) {
    s = s.slice(1);
  }
  const fixed: Record<string, number> = { '01': 14, '11': 6, '15': 6, '17': 6 };
  const variable = new Set(['10', '21', '240', '241', '30', '91', '92', '93']);
  let gtin: string | undefined;
  let expiry: string | undefined;
  let lot: string | undefined;
  while (s.length > 0) {
    const ai2 = s.slice(0, 2);
    const ai3 = s.slice(0, 3);
    if (fixed[ai2] !== undefined) {
      const value = s.slice(2, 2 + fixed[ai2]);
      if (value.length < fixed[ai2]) {
        return null;
      }
      if (ai2 === '01') {
        gtin = value;
      } else if (ai2 === '17') {
        expiry = gs1Date(value);
      }
      s = s.slice(2 + fixed[ai2]);
      if (s.startsWith(GS)) {
        s = s.slice(1);
      }
      continue;
    }
    const ai = variable.has(ai3) ? ai3 : variable.has(ai2) ? ai2 : null;
    if (ai === null) {
      break;
    }
    const end = s.indexOf(GS);
    const value = s.slice(ai.length, end === -1 ? undefined : end);
    if (ai === '10') {
      lot = value.slice(0, 20);
    }
    s = end === -1 ? '' : s.slice(end + 1);
  }
  const code = gtin === undefined ? null : normalizeBarcode(gtin);
  if (code === null) {
    return null;
  }
  return {
    code,
    ...(expiry ? { expiry } : {}),
    ...(lot ? { lot } : {}),
  };
}

/** Lecture brute du lecteur natif : EAN/UPC, ou Data Matrix GS1. */
export function readFromScanner(raw: string, format: string): ScanRead | null {
  if (format === 'DATA_MATRIX') {
    return parseGs1(raw);
  }
  if (format === 'QR_CODE') {
    const box = parseBoxQr(raw);
    return box === null ? null : { code: raw.trim(), box };
  }
  const code = normalizeBarcode(raw, format);
  return code === null ? null : { code };
}
