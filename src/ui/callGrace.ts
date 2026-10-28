/**
 * Appel ou SMS lancé depuis l'écran Urgence : l'application du téléphone
 * passe Fenrir en arrière-plan. Le coffre reste alors ouvert jusqu'à
 * `CALL_GRACE_MS` hors de l'application, pour relire le point de
 * regroupement en revenant ; au-delà, il se verrouille.
 */

export const CALL_GRACE_MS = 2 * 60 * 1000;

/** Délai pour que l'application du téléphone s'ouvre après l'appui. */
const LEAVE_WINDOW_MS = 10 * 1000;

let leavingAt: number | null = null;

/** À appeler juste avant d'ouvrir l'appel ou le SMS. */
export function markLeavingForCall(now = Date.now()): void {
  leavingAt = now;
}

/**
 * Au passage en arrière-plan : vrai si l'on vient de lancer un appel ou un
 * SMS depuis l'Urgence. La marque ne sert qu'une fois.
 */
export function takeLeavingForCall(now = Date.now()): boolean {
  const at = leavingAt;
  leavingAt = null;
  return at !== null && now - at <= LEAVE_WINDOW_MS;
}
