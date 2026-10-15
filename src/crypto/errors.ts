/**
 * Erreurs typées du module crypto.
 *
 * Les messages sont volontairement génériques : ils peuvent être affichés à
 * l'écran et ne doivent jamais révéler l'existence d'un second compartiment
 * (mode sous contrainte) ni quelle base a été ouverte.
 */
export type CryptoErrorCode =
  /** Échec de la dérivation Argon2id ou HKDF (module natif absent, mémoire insuffisante…). */
  | 'DERIVATION_FAILED'
  /** Le code saisi n'ouvre aucune base. */
  | 'INVALID_PIN'
  /** Trop d'essais : attendre `retryAt`. */
  | 'LOCKED_OUT'
  /** Le code ne respecte pas la politique (longueur, doublon…). */
  | 'PIN_POLICY'
  /** L'état persistant (sels, secret matériel) est illisible ou incohérent. */
  | 'STORAGE_CORRUPTED'
  /** Une base existe mais ne peut pas être lue alors que la clé est correcte. */
  | 'DATABASE_CORRUPTED'
  /** Aucun coffre n'a encore été créé. */
  | 'NOT_INITIALIZED'
  /** Un coffre existe déjà. */
  | 'ALREADY_INITIALIZED';

export class CryptoError extends Error {
  readonly code: CryptoErrorCode;
  /** Pour LOCKED_OUT : horodatage (ms epoch) à partir duquel un nouvel essai est autorisé. */
  readonly retryAt?: number;

  constructor(
    code: CryptoErrorCode,
    message: string,
    options?: { cause?: unknown; retryAt?: number },
  ) {
    super(message);
    this.name = 'CryptoError';
    this.code = code;
    this.retryAt = options?.retryAt;
    if (options?.cause !== undefined) {
      // `cause` n'est pas typé dans la lib ES2019 ciblée par le projet.
      (this as { cause?: unknown }).cause = options.cause;
    }
  }
}

export function isCryptoError(value: unknown): value is CryptoError {
  return value instanceof CryptoError;
}
