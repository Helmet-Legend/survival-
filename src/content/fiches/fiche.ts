import type { BundledGuide } from '../../db/guides';

/** Familles du guide, dans l'ordre d'affichage. */
export const F = {
  crise: 'Gestion de crise',
  risques: 'Risques & alertes',
  sante: 'Santé',
  eau: 'Eau potable',
  alimentation: 'Alimentation',
  energie: 'Énergie',
  habitat: 'Habitat',
  evacuation: 'Évacuation',
  communication: 'Communication',
  orientation: 'Orientation',
  nature: 'Autonomie en nature',
} as const;
export type Family = (typeof F)[keyof typeof F];

export const GUIDE_FOLDERS: readonly Family[] = Object.values(F);

/** Vitale : gestes et consignes qui protègent une vie dans l'immédiat. */
export type Priority = 'vitale' | 'importante' | 'utile';

export interface FicheMeta {
  priority?: Priority;
  /** Références reconnues à consulter, sans prétendre à une validation. */
  sources?: readonly string[];
  /** Fiche de santé : rappel qu'elle n'a pas été relue par un soignant. */
  medical?: boolean;
}

/** Mois de rédaction ou de dernière révision du guide embarqué. */
export const GUIDE_UPDATED = 'octobre 2026';

/** Préfixe des lignes de métadonnées, rendues en pied de fiche. */
export const META_PREFIX = '§ ';

/**
 * Une fiche : chaque ligne est un paragraphe. Marqueurs reconnus par le
 * lecteur : « ## » intertitre, « - » puce, « 1. » étape, « ! » mise en
 * garde, « = » ligne de tableau, « ◇ » étape de schéma, « ↓ » flèche.
 * Les métadonnées (priorité, sources, date) sont ajoutées en fin de corps,
 * en lignes « § Clé : valeur ».
 */
export function fiche(
  slug: string,
  category: Family,
  title: string,
  lines: readonly string[],
  meta: FicheMeta = {},
): BundledGuide {
  const footer = [
    `${META_PREFIX}Priorité : ${meta.priority ?? 'importante'}`,
    ...(meta.sources && meta.sources.length > 0
      ? [`${META_PREFIX}Références : ${meta.sources.join(' ; ')}`]
      : []),
    `${META_PREFIX}Mise à jour : ${GUIDE_UPDATED}`,
    ...(meta.medical
      ? [
          `${META_PREFIX}Relecture : non relue par un professionnel de santé. Ne remplace pas une formation aux premiers secours (PSC1).`,
        ]
      : []),
  ];
  return {
    slug,
    category,
    title,
    body: [...lines, ...footer].join('\n'),
  };
}

/** Lit les métadonnées « § Clé : valeur » d'un corps de fiche. */
export function readMeta(body: string): {
  priority: Priority;
  entries: Array<[string, string]>;
} {
  const entries: Array<[string, string]> = [];
  for (const line of body.split('\n')) {
    if (line.startsWith(META_PREFIX)) {
      const text = line.slice(META_PREFIX.length);
      const sep = text.indexOf(' : ');
      if (sep > 0) {
        entries.push([text.slice(0, sep), text.slice(sep + 3)]);
      }
    }
  }
  const priority = entries.find(([key]) => key === 'Priorité')?.[1];
  return {
    priority:
      priority === 'vitale' || priority === 'utile' ? priority : 'importante',
    entries,
  };
}

// Références communes.
export const REF = {
  psc1: 'Référentiel national PSC1 (prévention et secours civiques, ministère de l’Intérieur)',
  erc: 'Recommandations du Conseil européen de réanimation (ERC, 2021)',
  sgdsn: 'Guide « Tous responsables » (SGDSN, 2025)',
  georisques: 'Géorisques (georisques.gouv.fr)',
  spf: 'Santé publique France',
  oms: 'Organisation mondiale de la santé (traitement de l’eau à domicile)',
  ars: 'Agences régionales de santé (ARS)',
  meteo: 'Météo-France (vigilance)',
  antipoison: 'Centres antipoison',
  anfr: 'Agence nationale des fréquences (ANFR)',
  anses: 'Agence nationale de sécurité sanitaire (ANSES), fiches botulisme',
  cyber: 'Cybermalveillance.gouv.fr (bonnes pratiques de sauvegarde)',
  sphere: 'Manuel Sphère (2018), normes minimales en approvisionnement en eau',
  usda: 'Département de l’Agriculture des États-Unis (USDA, sécurité des aliments en cas de coupure)',
} as const;
