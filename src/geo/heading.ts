/**
 * Calculs de la boussole : cap ramené dans [0, 360[, passage du nord
 * magnétique au nord géographique, écart signé avec un cap fixé.
 */

/** Cap ramené dans [0, 360[. */
export function normalizeHeading(degrees: number): number {
  return ((degrees % 360) + 360) % 360;
}

/**
 * Écart signé du cap actuel vers le cap visé, dans ]-180, 180] : positif,
 * il faut tourner à droite ; négatif, à gauche.
 */
export function headingOffset(target: number, current: number): number {
  const diff = normalizeHeading(target - current);
  return diff > 180 ? diff - 360 : diff;
}

/** En deçà, on est « dans l'axe » du cap fixé. */
export const ON_COURSE_DEGREES = 5;

/** « Dans l'axe », « Tournez de 12° à droite »… */
export function describeOffset(offset: number): string {
  const degrees = Math.round(Math.abs(offset));
  if (degrees <= ON_COURSE_DEGREES) {
    return 'Dans l’axe';
  }
  return `Tournez de ${degrees}° ${offset > 0 ? 'à droite' : 'à gauche'}`;
}

/** Cap affiché selon la référence : magnétique tel quel, ou géographique. */
export function displayedHeading(
  magnetic: number,
  declination: number | null,
  reference: 'magnetic' | 'true',
): number {
  return normalizeHeading(
    reference === 'true' && declination !== null
      ? magnetic + declination
      : magnetic,
  );
}
