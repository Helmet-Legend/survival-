import { CryptoError } from './errors';
import { PIN_MAX_LENGTH, PIN_MIN_LENGTH } from './params';
import { normalizePin } from './kdf';

/**
 * Règles minimales sur les codes. Un PIN de 6 chiffres reste faible (10⁶
 * combinaisons) : c'est la liaison au secret matériel et le limiteur
 * d'essais qui le rendent acceptable. Une phrase de passe est recommandée.
 */
export function assertPinAcceptable(pin: string): void {
  const normalized = normalizePin(pin);
  if (normalized.length < PIN_MIN_LENGTH) {
    throw new CryptoError(
      'PIN_POLICY',
      `Le code doit contenir au moins ${PIN_MIN_LENGTH} caractères`,
    );
  }
  if (normalized.length > PIN_MAX_LENGTH) {
    throw new CryptoError(
      'PIN_POLICY',
      `Le code doit contenir au plus ${PIN_MAX_LENGTH} caractères`,
    );
  }
  if (/^(.)\1+$/.test(normalized)) {
    throw new CryptoError(
      'PIN_POLICY',
      'Le code ne peut pas répéter un seul caractère',
    );
  }
}

export function pinsAreEqual(a: string, b: string): boolean {
  return normalizePin(a) === normalizePin(b);
}
