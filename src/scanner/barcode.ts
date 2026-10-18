/**
 * Codes EAN/UPC : validation de la clé de contrôle et forme canonique. Un
 * même produit peut être lu en UPC-A (12 chiffres), UPC-E (8) ou EAN-13 :
 * tous sont ramenés à l'EAN-13, sauf l'EAN-8 qui reste à 8 chiffres.
 */

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
    // GTIN-14 d'un carton : garder tel quel.
    return code;
  }
  return null;
}
