import type { BundledGuide } from '../../db/guides';
import type { CrisisId } from '../../plan/crisis';

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
  protection: 'Équipement et protection',
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
  /** Mots-clés supplémentaires pour la recherche. */
  keywords?: readonly string[];
  /** Résumé « En bref » ; par défaut, le premier paragraphe de la fiche. */
  summary?: string;
  /** Pages en ligne consultées, avec leur adresse et le mois de consultation. */
  links?: readonly SourceLink[];
  /** Mois (`AAAA-MM`) où cette fiche a été vérifiée ; par défaut `GUIDE_CHECKED`. */
  checked?: string;
}

export interface SourceLink {
  org: string;
  title: string;
  url: string;
  /** Mois de consultation, `AAAA-MM`. */
  consulted: string;
}

/** Mois de rédaction ou de dernière révision du guide embarqué. */
export const GUIDE_UPDATED = 'octobre 2026';
/** Le même mois, `AAAA-MM`, pour signaler les fiches à revoir. */
export const GUIDE_CHECKED = '2026-10';
/** Au-delà, une fiche est signalée « à revoir » plutôt que présentée comme actuelle. */
export const REVIEW_AFTER_MONTHS = 12;

/** Mots lus par minute pour estimer le temps de lecture. */
const WORDS_PER_MINUTE = 180;

export type Reliability = 'officielle' | 'editoriale' | 'sante';

export const RELIABILITY_LABELS: Record<Reliability, string> = {
  officielle: 'Sources officielles citées',
  editoriale: 'Contenu éditorial, à vérifier',
  sante: 'Santé : non relue par un soignant',
};

const MARKER = /^(## |# |- |\d+\. |! |= |\| |◇ |↓|☐ |★ |✕ |→ |▣ |▸ )/;

/** Premier paragraphe simple de la fiche, raccourci à une ou deux phrases. */
export function defaultSummary(lines: readonly string[]): string {
  const first =
    lines.find(l => l.trim() !== '' && !MARKER.test(l)) ??
    lines.find(l => l.startsWith('- '))?.slice(2) ??
    '';
  if (first.length <= 220) {
    return first;
  }
  const cut = first.slice(0, 220);
  const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf(' : '));
  return end > 80 ? `${cut.slice(0, end + 1).trim()}` : `${cut.trim()}…`;
}

export function readingMinutes(lines: readonly string[]): number {
  const words = lines.join(' ').split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / WORDS_PER_MINUTE));
}

/** Préfixe des lignes de métadonnées, rendues en pied de fiche. */
export const META_PREFIX = '§ ';

/**
 * Une fiche : chaque ligne est un paragraphe. Marqueurs reconnus par le
 * lecteur : « ## » intertitre, « - » puce, « 1. » étape, « ! » mise en
 * garde, « = » ligne de tableau, « ◇ » étape de schéma, « ↓ » flèche.
 * Repères de mise en page (voir `ficheLayout`) : « ★ » action prioritaire,
 * « ✕ » à ne surtout pas faire, « # Avant » / « # Pendant » / « # Après »
 * onglet, « → » lien vers un autre écran, « ▣ clé  Titre  Texte » carte
 * illustrée, « ▸ Titre » volet repliable (les puces « - » qui suivent).
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
  const reliability: Reliability = meta.medical
    ? 'sante'
    : meta.sources && meta.sources.length > 0
    ? 'officielle'
    : 'editoriale';
  const footer = [
    `${META_PREFIX}En bref : ${meta.summary ?? defaultSummary(lines)}`,
    `${META_PREFIX}Lecture : ${readingMinutes(lines)} min`,
    `${META_PREFIX}Fiabilité : ${RELIABILITY_LABELS[reliability]}`,
    `${META_PREFIX}Vérifiée : ${meta.checked ?? GUIDE_CHECKED}`,
    `${META_PREFIX}Priorité : ${meta.priority ?? 'importante'}`,
    ...(meta.sources && meta.sources.length > 0
      ? [`${META_PREFIX}Références : ${meta.sources.join(' ; ')}`]
      : []),
    ...(meta.links ?? []).map(
      l =>
        `${META_PREFIX}Source : ${[l.org, l.title, l.consulted, l.url].join(
          SOURCE_SEP,
        )}`,
    ),
    `${META_PREFIX}Mise à jour : ${GUIDE_UPDATED}`,
    ...(meta.keywords && meta.keywords.length > 0
      ? [`${META_PREFIX}Mots-clés : ${meta.keywords.join(', ')}`]
      : []),
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

const SOURCE_SEP = ' | ';

/** Pages en ligne citées par une fiche (lignes « § Source »). */
export function ficheSources(body: string): SourceLink[] {
  return readMeta(body)
    .entries.filter(([key]) => key === 'Source')
    .map(([, value]) => value.split(SOURCE_SEP))
    .filter(parts => parts.length === 4)
    .map(([org, title, consulted, url]) => ({ org, title, consulted, url }));
}

// --- Mise en page du lecteur ------------------------------------------------

export const PHASES = ['Avant', 'Pendant', 'Après'] as const;
export type Phase = (typeof PHASES)[number];

/** Écrans de Fenrir qu'une fiche peut ouvrir (lignes « → »). */
export type FicheLink =
  | { kind: 'waterStock' }
  | { kind: 'healthStock' }
  | { kind: 'crisis'; scenario: CrisisId }
  | { kind: 'localRisks' };

/** Lignes « → » à écrire dans une fiche. */
export const LINK = {
  waterStock: '→ stock-eau',
  healthStock: '→ trousse',
  crisis: (scenario: CrisisId) => `→ simulateur ${scenario}`,
  localRisks: '→ consignes-locales',
} as const;

function parseLink(target: string): FicheLink | null {
  if (target === 'stock-eau') {
    return { kind: 'waterStock' };
  }
  if (target === 'trousse') {
    return { kind: 'healthStock' };
  }
  if (target === 'consignes-locales') {
    return { kind: 'localRisks' };
  }
  const crisis = /^simulateur (\w+)$/.exec(target);
  return crisis ? { kind: 'crisis', scenario: crisis[1] as CrisisId } : null;
}

export interface FicheLayout {
  /** Lignes « ★ » : l'encadré en tête de fiche. */
  priorities: string[];
  /** Lignes « ✕ » : le bloc rouge, visible quel que soit l'onglet. */
  donts: string[];
  links: FicheLink[];
  /** Corps avant le premier onglet (toute la fiche s'il n'y en a pas). */
  intro: string[];
  /** Onglets « # Avant », « # Pendant », « # Après », dans l'ordre de la fiche. */
  phases: Array<{ phase: Phase; lines: string[] }>;
}

/** Répartit le corps d'une fiche (métadonnées retirées) entre les blocs du lecteur. */
export function ficheLayout(body: string): FicheLayout {
  const layout: FicheLayout = {
    priorities: [],
    donts: [],
    links: [],
    intro: [],
    phases: [],
  };
  for (const line of body.split('\n')) {
    if (line.startsWith(META_PREFIX)) {
      continue;
    }
    if (line.startsWith('★ ')) {
      layout.priorities.push(line.slice(2));
    } else if (line.startsWith('✕ ')) {
      layout.donts.push(line.slice(2));
    } else if (line.startsWith('→ ')) {
      const link = parseLink(line.slice(2).trim());
      if (link !== null) {
        layout.links.push(link);
      }
    } else if (
      line.startsWith('# ') &&
      (PHASES as readonly string[]).includes(line.slice(2).trim())
    ) {
      layout.phases.push({ phase: line.slice(2).trim() as Phase, lines: [] });
    } else {
      const current = layout.phases[layout.phases.length - 1];
      (current ? current.lines : layout.intro).push(line);
    }
  }
  return layout;
}

/** Clés rendues en tête de fiche plutôt que dans le pied. */
export const HEADER_KEYS = new Set([
  'En bref',
  'Lecture',
  'Fiabilité',
  'Vérifiée',
]);

export interface FicheInfo {
  summary: string | null;
  minutes: number | null;
  reliability: string | null;
  /** `AAAA-MM` de la dernière vérification. */
  checked: string | null;
}

export function ficheInfo(body: string): FicheInfo {
  const map = new Map(readMeta(body).entries);
  const minutes = Number(/^(\d+)/.exec(map.get('Lecture') ?? '')?.[1]);
  const checked = map.get('Vérifiée') ?? null;
  return {
    summary: map.get('En bref') || null,
    minutes: Number.isFinite(minutes) && minutes > 0 ? minutes : null,
    reliability: map.get('Fiabilité') ?? null,
    checked: checked !== null && /^\d{4}-\d{2}$/.test(checked) ? checked : null,
  };
}

/** Vrai si la dernière vérification date d'au moins `REVIEW_AFTER_MONTHS` mois. */
export function needsReview(checked: string | null, today: string): boolean {
  if (checked === null) {
    return true;
  }
  const [cy, cm] = checked.split('-').map(Number);
  const [y, m] = today.split('-').map(Number);
  return (y - cy) * 12 + (m - cm) >= REVIEW_AFTER_MONTHS;
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
  servicePublic:
    'Service-Public.fr (armes : acquisition, détention, transport)',
  legifrance: 'Légifrance (Code pénal, article 122-5)',
  attaque: 'Gouvernement : « Réagir en cas d’attaque terroriste »',
  inrs: 'INRS (appareils de protection respiratoire)',
  anses: 'Agence nationale de sécurité sanitaire (ANSES), fiches botulisme',
  cyber: 'Cybermalveillance.gouv.fr (bonnes pratiques de sauvegarde)',
  sphere: 'Manuel Sphère (2018), normes minimales en approvisionnement en eau',
  nij: 'National Institute of Justice (NIJ) : normes 0101.06, 0101.07 et 0123.00, liste des produits conformes',
  usda: 'Département de l’Agriculture des États-Unis (USDA, sécurité des aliments en cas de coupure)',
} as const;

// Pages en ligne citées, vérifiées au mois indiqué.
export const WEB = {
  ars: {
    org: 'Agences régionales de santé (ARS)',
    title: 'Portail des ARS : consignes locales sur l’eau du robinet',
    url: 'https://www.ars.sante.fr',
    consulted: '2026-10',
  },
  tousResponsables: {
    org: 'Ministère de l’Intérieur et SGDSN',
    title: '« Tous responsables : face aux risques, agissons » (2025)',
    url: 'https://www.interieur.gouv.fr/actualites/actualites-du-ministere/tous-responsables-face-aux-risques-agissons',
    consulted: '2026-10',
  },
  georisques: {
    org: 'Géorisques',
    title: 'Risques de son adresse, DICRIM et plans communaux',
    url: 'https://www.georisques.gouv.fr',
    consulted: '2026-10',
  },
  ansm: {
    org: 'Agence nationale de sécurité du médicament (ANSM)',
    title: 'Paracétamol, anti-inflammatoires et grossesse : mises en garde',
    url: 'https://ansm.sante.fr',
    consulted: '2026-10',
  },
  santeFr: {
    org: 'Santé.fr (service public d’information en santé)',
    title: 'Plaies : soigner et savoir quand consulter',
    url: 'https://www.sante.fr/plaies',
    consulted: '2026-10',
  },
  usda: {
    org: 'Département de l’Agriculture des États-Unis (USDA)',
    title: 'Sécurité des aliments en cas de coupure (en anglais)',
    url: 'https://www.usda.gov',
    consulted: '2026-10',
  },
} as const satisfies Record<string, SourceLink>;

/** Carte illustrée d'une ligne « ▣ clé  Titre  Texte ». */
export function imageCard(
  line: string,
): { image: string; title: string; text: string } | null {
  if (!line.startsWith('▣ ')) {
    return null;
  }
  const [image, title, ...rest] = line
    .slice(2)
    .trim()
    .split(/\s{2,}/);
  return image && title ? { image, title, text: rest.join(' ') } : null;
}
