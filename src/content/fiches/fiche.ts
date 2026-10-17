import type { BundledGuide } from '../../db/guides';

/**
 * Une fiche : chaque ligne est un paragraphe. Marqueurs reconnus par le
 * lecteur : « ## » intertitre, « - » puce, « 1. » étape, « ! » mise en
 * garde, « = » ligne de tableau en chasse fixe.
 */
export function fiche(
  slug: string,
  category: string,
  title: string,
  lines: readonly string[],
): BundledGuide {
  return { slug, category, title, body: lines.join('\n') };
}

/** Dossiers des guides, dans l'ordre d'affichage. */
export const GUIDE_FOLDERS = [
  'Survie',
  'Médical',
  'Eau',
  'Communication',
  'Orientation',
  'Alimentation',
  'Hygiène',
  'Préparation',
  'Risques & alertes',
] as const;
