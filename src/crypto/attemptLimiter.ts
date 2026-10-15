/**
 * Limitation des essais de déverrouillage : quelques essais libres, puis un
 * délai qui double à chaque échec, plafonné.
 *
 * Le compteur est incrémenté AVANT la dérivation et remis à zéro uniquement
 * en cas de succès : tuer l'application pendant un essai ne contourne pas la
 * limite.
 */
export const FREE_ATTEMPTS = 5;
export const BASE_DELAY_MS = 30_000;
export const MAX_DELAY_MS = 60 * 60 * 1000;

/** Délai imposé après `failedAttempts` échecs consécutifs. */
export function lockoutDelayMs(failedAttempts: number): number {
  if (failedAttempts < FREE_ATTEMPTS) {
    return 0;
  }
  const exponent = failedAttempts - FREE_ATTEMPTS;
  // Borne l'exposant pour éviter Infinity sur un compteur aberrant.
  const delay = BASE_DELAY_MS * 2 ** Math.min(exponent, 20);
  return Math.min(delay, MAX_DELAY_MS);
}
