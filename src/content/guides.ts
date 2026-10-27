/**
 * Fiches de survie embarquées dans l'application, rangées par dossier.
 *
 * À FAIRE VALIDER : ces fiches sont des exemples rédigés d'après les
 * recommandations grand public (PSC1, Croix-Rouge, Sécurité civile). Elles
 * doivent être relues par un professionnel de santé avant toute diffusion.
 */
import type { BundledGuide } from '../db/guides';
import { APPLICATIONS } from './fiches/applications';
import { COMMUNICATION } from './fiches/communication';
import { COMPLEMENTS } from './fiches/complements';
import { EAU, ORIENTATION } from './fiches/eau-orientation';
import { FAMILLES } from './fiches/familles';
import { MEDICAL } from './fiches/medical';
import { ORGANISATION } from './fiches/organisation';
import { PROTECTION } from './fiches/protection';
import { PREPARATION, RISQUES } from './fiches/preparation-risques';
import { SURVIE } from './fiches/survie';
import { URGENCES } from './fiches/urgences-courantes';
import { ALIMENTATION, HYGIENE } from './fiches/vie-quotidienne';

import { META_PREFIX } from './fiches/fiche';
import { RESUMES } from './fiches/resumes';

export { GUIDE_FOLDERS } from './fiches/fiche';

const ALL: BundledGuide[] = [
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
  ...PROTECTION,
  ...COMPLEMENTS,
  ...APPLICATIONS,
  ...URGENCES,
];

/** Résumé « En bref » rédigé pour chaque fiche, à la place du premier paragraphe. */
export const BUNDLED_GUIDES: BundledGuide[] = ALL.map(guide => {
  const summary = RESUMES[guide.slug];
  return summary === undefined
    ? guide
    : {
        ...guide,
        body: guide.body.replace(
          new RegExp(`^${META_PREFIX}En bref : .*$`, 'm'),
          `${META_PREFIX}En bref : ${summary}`,
        ),
      };
});
