/**
 * Fiches de survie embarquées dans l'application, rangées par dossier.
 *
 * À FAIRE VALIDER : ces fiches sont des exemples rédigés d'après les
 * recommandations grand public (PSC1, Croix-Rouge, Sécurité civile). Elles
 * doivent être relues par un professionnel de santé avant toute diffusion.
 */
import type { BundledGuide } from '../db/guides';
import { COMMUNICATION } from './fiches/communication';
import { EAU, ORIENTATION } from './fiches/eau-orientation';
import { FAMILLES } from './fiches/familles';
import { MEDICAL } from './fiches/medical';
import { ORGANISATION } from './fiches/organisation';
import { PREPARATION, RISQUES } from './fiches/preparation-risques';
import { SURVIE } from './fiches/survie';
import { ALIMENTATION, HYGIENE } from './fiches/vie-quotidienne';

export { GUIDE_FOLDERS } from './fiches/fiche';

export const BUNDLED_GUIDES: BundledGuide[] = [
  ...SURVIE,
  ...MEDICAL,
  ...EAU,
  ...COMMUNICATION,
  ...ORIENTATION,
  ...ALIMENTATION,
  ...HYGIENE,
  ...PREPARATION,
  ...RISQUES,
  ...FAMILLES,
  ...ORGANISATION,
];
