/**
 * Pharmacie du foyer : objectif de stock de produits de santé et de
 * consommables pour une durée d'autonomie, inventaire par lots et alertes.
 *
 * Le calcul estime un objectif de stock, jamais une posologie. Trois
 * méthodes distinctes, sans fréquence d'utilisation inventée :
 * - consommable : quantité par personne et par mois saisie par l'utilisateur ;
 * - médicament occasionnel : épisodes par personne et par an × unités par
 *   épisode, d'après des repères sourcés (fréquence publiée, notice) que
 *   l'utilisateur peut modifier ; ou nombre de boîtes choisi à la main ;
 * - traitement prescrit : quantité par jour indiquée sur l'ordonnance,
 *   à faire valider par le médecin ou le pharmacien.
 * Une donnée manquante est signalée, jamais remplacée par une valeur par défaut.
 */
import { addDays, assertIsoDate } from '../lib/dates';
import type { SqlDatabase } from '../db/types';

export type PharmacyKind = 'consumable' | 'occasional' | 'prescribed';

export const KIND_LABELS: Record<PharmacyKind, string> = {
  consumable: 'Consommable',
  occasional: 'Médicament occasionnel',
  prescribed: 'Traitement prescrit',
};

export type Storage = 'ambient' | 'cold' | 'unknown';

export const STORAGE_LABELS: Record<Storage, string> = {
  ambient: 'Température ambiante, à l’abri de l’humidité',
  cold: 'Au réfrigérateur (2 à 8 °C)',
  unknown: 'À vérifier sur la notice',
};

/** Statut de délivrance, affiché seulement avec sa source. */
export interface Delivery {
  status: 'otc' | 'prescription';
  source: string;
}

export const DELIVERY_LABELS: Record<Delivery['status'], string> = {
  otc: 'Sans ordonnance',
  prescription: 'Sur ordonnance',
};

/** Lot en stock : nombre de conditionnements (boîtes, flacons, paquets). */
export interface PharmacyLot {
  id: string;
  packs: number;
  /** AAAA-MM-JJ, facultative. */
  expiry?: string;
}

export interface PharmacyLine {
  id: string;
  /** Produit du catalogue d'origine, s'il y en a un. */
  catalogId?: string;
  name: string;
  /** Principe actif (DCI), pour repérer les doublons. */
  ingredient?: string;
  need: string;
  kind: PharmacyKind;
  /** Unité comptée : comprimé, sachet, pansement… */
  unit: string;
  /** Unités par conditionnement ; nécessaire aux consommables et traitements. */
  packSize?: number;
  storage: Storage;
  delivery?: Delivery;
  /** Consommable : unités par personne et par mois (saisie). */
  perPersonPerMonth?: number;
  /** Médicament occasionnel : épisodes par personne et par an (estimation). */
  episodesPerYear?: number;
  /** Médicament occasionnel : unités au plus par épisode (notice). */
  unitsPerEpisode?: number;
  /** Médicament occasionnel : boîtes choisies à la main, à la place de l'estimation. */
  precautionPacks?: number;
  /** Traitement prescrit : unités par jour selon l'ordonnance (saisie). */
  prescribedPerDay?: number;
  /** Traitement prescrit : personnes concernées. */
  prescribedPersons?: number;
  /** Traitement prescrit : quantité validée avec le médecin ou le pharmacien. */
  validated?: boolean;
  lots: PharmacyLot[];
}

export type DurationUnit = 'days' | 'weeks' | 'months';

export const DURATION_LABELS: Record<DurationUnit, [string, string]> = {
  days: ['jour', 'jours'],
  weeks: ['semaine', 'semaines'],
  months: ['mois', 'mois'],
};

export interface PharmacyPlan {
  version: 1;
  persons: number;
  duration: { value: number; unit: DurationUnit };
  /** Marge logistique en %, appliquée aux consommables et traitements. */
  marginPercent: number;
  lines: PharmacyLine[];
}

export const LIMITS = {
  persons: [1, 50],
  days: [1, 3650],
  marginPercent: [0, 100],
  packSize: [1, 10_000],
  quantity: [0, 100_000],
} as const;

/** Un mois compte 30 jours : hypothèse affichée avec le résultat. */
export const DAYS_PER_MONTH = 30;
/** Une péremption à moins de 90 jours est signalée. */
export const EXPIRY_WARNING_DAYS = 90;

export function durationDays(duration: PharmacyPlan['duration']): number {
  const factor =
    duration.unit === 'weeks'
      ? 7
      : duration.unit === 'months'
      ? DAYS_PER_MONTH
      : 1;
  return Math.round(duration.value * factor);
}

export function newPlan(persons: number): PharmacyPlan {
  return {
    version: 1,
    persons: clamp(Math.round(persons), LIMITS.persons),
    duration: { value: 6, unit: 'months' },
    marginPercent: 10,
    lines: [],
  };
}

function clamp(n: number, [min, max]: readonly [number, number]): number {
  return Math.min(max, Math.max(min, n));
}

// --- Catalogue -----------------------------------------------------------------

export interface CatalogEntry {
  id: string;
  need: string;
  name: string;
  /** Exemples de noms commerciaux, à titre de repère. */
  examples?: string;
  ingredient?: string;
  kind: PharmacyKind;
  unit: string;
  storage: Storage;
  delivery?: Delivery;
  /** Précaution affichée avec le produit. */
  caution?: string;
  /** Repères sourcés pour estimer un médicament occasionnel. */
  estimate?: Estimate;
}

/** Chaque valeur préremplie porte sa source ; l'utilisateur peut la changer. */
export interface Estimate {
  episodesPerYear: number;
  episodesSource: string;
  unitsPerEpisode: number;
  unitsSource: string;
  packSize?: number;
  packSource?: string;
}

/** Un an compte 365 jours pour convertir une fréquence annuelle. */
export const DAYS_PER_YEAR = 365;

const GASTRO_SPF =
  'Santé publique France, enquête 2009-2010 : 0,33 gastro-entérite par personne et par an (plus fréquente chez le jeune enfant)';

const ANSM_2020 =
  'ANSM, 15 janvier 2020 : sans ordonnance, délivré sur demande au pharmacien';
const LIBRE_ACCES_2025 =
  'Liste ANSM des médicaments de médication officinale (mise à jour de décembre 2025)';

/**
 * Produits de départ. Statut de délivrance seulement quand il a été vérifié ;
 * sinon « à confirmer avec le pharmacien ». Aucune quantité ni fréquence.
 */
export const PHARMACY_CATALOG: readonly CatalogEntry[] = [
  {
    id: 'paracetamol',
    need: 'Douleur, fièvre',
    name: 'Paracétamol 500 mg',
    examples: 'Doliprane, Efferalgan, Dafalgan, génériques',
    ingredient: 'paracétamol',
    kind: 'occasional',
    unit: 'comprimé',
    estimate: {
      episodesPerYear: 3,
      episodesSource:
        '2 à 3 rhumes par adulte et par an (chiffre attribué au CDC, à confirmer) ; on retient 3',
      unitsPerEpisode: 18,
      unitsSource:
        'Notice paracétamol 500 mg (base publique des médicaments) : au plus 6 comprimés par jour, 3 jours en cas de fièvre sans avis médical',
      packSize: 16,
      packSource: 'HAS, avis 2026 : boîtes de 16 comprimés à 500 mg',
    },
    storage: 'ambient',
    delivery: { status: 'otc', source: ANSM_2020 },
    caution:
      'Ne pas cumuler deux produits qui en contiennent ; dose selon la notice, l’âge et le poids. Sans ordonnance, l’ANSM recommande de ne pas délivrer plus de 2 boîtes à la fois : étaler les achats.',
  },
  {
    id: 'cetirizine',
    need: 'Allergie',
    name: 'Cétirizine',
    examples: 'Drill allergie, génériques',
    ingredient: 'cétirizine',
    kind: 'occasional',
    unit: 'comprimé',
    storage: 'ambient',
    delivery: { status: 'otc', source: LIBRE_ACCES_2025 },
    caution: 'Peut endormir : lire la notice avant de conduire.',
  },
  {
    id: 'sro',
    need: 'Diarrhée, déshydratation',
    name: 'Solution de réhydratation orale',
    examples: 'Sachets de pharmacie',
    kind: 'occasional',
    unit: 'sachet',
    storage: 'ambient',
    caution:
      'Préparer exactement comme indiqué. Traitement de référence chez l’enfant.',
  },
  {
    id: 'loperamide',
    need: 'Diarrhée (adulte)',
    name: 'Lopéramide 2 mg',
    examples: 'Imodium lingual, Diastrolib',
    ingredient: 'lopéramide',
    kind: 'occasional',
    unit: 'gélule',
    estimate: {
      episodesPerYear: 0.33,
      episodesSource: GASTRO_SPF,
      unitsPerEpisode: 12,
      unitsSource:
        'Notice lopéramide 2 mg : au plus 6 par jour, 2 jours au plus sans avis médical, à partir de 15 ans',
      packSize: 12,
      packSource: 'Boîtes de 12 courantes (ex. Zentiva Conseil)',
    },
    storage: 'ambient',
    delivery: { status: 'otc', source: LIBRE_ACCES_2025 },
    caution:
      'Jamais en cas de fièvre ou de sang dans les selles ; pas chez le jeune enfant.',
  },
  {
    id: 'diosmectite',
    need: 'Diarrhée',
    name: 'Diosmectite',
    examples: 'Smecta, génériques',
    ingredient: 'diosmectite',
    kind: 'occasional',
    unit: 'sachet',
    estimate: {
      episodesPerYear: 0.33,
      episodesSource: GASTRO_SPF,
      unitsPerEpisode: 21,
      unitsSource:
        'Notice Smecta 3 g : adulte, en moyenne 3 sachets par jour, 7 jours au plus',
      packSize: 18,
      packSource: 'Smecta 3 g, boîte de 18 sachets',
    },
    storage: 'ambient',
    caution:
      'Pas avant 2 ans (ANSM) ; déconseillé pendant la grossesse et l’allaitement.',
  },
  {
    id: 'metopimazine',
    need: 'Nausées, vomissements',
    name: 'Métopimazine 7,5 mg',
    examples: 'Vogalib, Métopimazine Viatris Conseil',
    ingredient: 'métopimazine',
    kind: 'occasional',
    unit: 'comprimé',
    storage: 'ambient',
    delivery: { status: 'otc', source: LIBRE_ACCES_2025 },
    caution: 'Au plus 2 jours sans avis médical (notice).',
  },
  {
    id: 'phloroglucinol',
    need: 'Douleurs de ventre, crampes',
    name: 'Phloroglucinol',
    examples: 'Spasfon, génériques',
    ingredient: 'phloroglucinol',
    kind: 'occasional',
    unit: 'comprimé',
    storage: 'ambient',
  },
  {
    id: 'antiacide',
    need: 'Brûlures d’estomac',
    name: 'Alginate ou antiacide',
    examples: 'Gaviscon',
    kind: 'occasional',
    unit: 'sachet',
    storage: 'ambient',
  },
  {
    id: 'macrogol',
    need: 'Constipation',
    name: 'Macrogol',
    examples: 'Forlax, génériques',
    ingredient: 'macrogol',
    kind: 'occasional',
    unit: 'sachet',
    storage: 'ambient',
  },
  {
    id: 'antifongique',
    need: 'Mycose de la peau',
    name: 'Antifongique cutané',
    examples: 'Clotrimazole, éconazole',
    kind: 'occasional',
    unit: 'tube',
    storage: 'ambient',
  },
  {
    id: 'antiseptique',
    need: 'Petites plaies',
    name: 'Antiseptique cutané',
    examples: 'Chlorhexidine',
    ingredient: 'chlorhexidine',
    kind: 'occasional',
    unit: 'flacon',
    storage: 'ambient',
  },
  {
    id: 'serum',
    need: 'Lavage des plaies et des yeux',
    name: 'Sérum physiologique en unidoses',
    examples: 'Chlorure de sodium 0,9 %',
    kind: 'consumable',
    unit: 'unidose',
    storage: 'ambient',
  },
  {
    id: 'pansements',
    need: 'Petites plaies',
    name: 'Pansements adhésifs',
    kind: 'consumable',
    unit: 'pansement',
    storage: 'ambient',
  },
  {
    id: 'compresses',
    need: 'Plaies',
    name: 'Compresses stériles',
    kind: 'consumable',
    unit: 'sachet',
    storage: 'ambient',
  },
  {
    id: 'gants',
    need: 'Protection',
    name: 'Gants à usage unique',
    kind: 'consumable',
    unit: 'paire',
    storage: 'ambient',
  },
  {
    id: 'masques',
    need: 'Protection',
    name: 'Masques',
    kind: 'consumable',
    unit: 'masque',
    storage: 'ambient',
  },
  {
    id: 'traitement',
    need: 'Traitement personnel',
    name: 'Traitement habituel (à préciser)',
    kind: 'prescribed',
    unit: 'comprimé',
    storage: 'unknown',
    caution:
      'Réserve à constituer avec le médecin : ordonnance et renouvellement.',
  },
  {
    id: 'insuline',
    need: 'Diabète',
    name: 'Insuline (à préciser)',
    ingredient: 'insuline',
    kind: 'prescribed',
    unit: 'stylo',
    storage: 'cold',
    caution: 'Plan médical, consommables et chaîne du froid à prévoir.',
  },
];

export function lineFromCatalog(entry: CatalogEntry, id: string): PharmacyLine {
  return {
    id,
    catalogId: entry.id,
    name: entry.name,
    ingredient: entry.ingredient,
    need: entry.need,
    kind: entry.kind,
    unit: entry.unit,
    storage: entry.storage,
    delivery: entry.delivery,
    ...(entry.kind === 'prescribed' ? { prescribedPersons: 1 } : {}),
    ...(entry.estimate
      ? {
          episodesPerYear: entry.estimate.episodesPerYear,
          unitsPerEpisode: entry.estimate.unitsPerEpisode,
          packSize: entry.estimate.packSize,
        }
      : {}),
    lots: [],
  };
}

// --- Calcul --------------------------------------------------------------------

export type Missing =
  | 'perPersonPerMonth'
  | 'precautionPacks'
  | 'prescribedPerDay'
  | 'packSize';

export const MISSING_LABELS: Record<Missing, string> = {
  perPersonPerMonth: 'Quantité par personne et par mois à indiquer',
  precautionPacks:
    'Épisodes par an et unités par épisode à indiquer, ou nombre de boîtes à choisir',
  prescribedPerDay: 'Quantité par jour de l’ordonnance à indiquer',
  packSize: 'Nombre d’unités par conditionnement à indiquer',
};

export interface LineResult {
  line: PharmacyLine;
  /** Unités nécessaires (consommables, traitements), marge comprise. */
  units: number | null;
  /** Conditionnements visés, arrondis au conditionnement supérieur. */
  targetPacks: number | null;
  /** Conditionnements utilisables (lots non périmés). */
  availablePacks: number;
  expiredPacks: number;
  /** Conditionnements à acheter (0 si le stock suffit). */
  toBuyPacks: number | null;
  /** Conditionnements au-delà de l'objectif. */
  surplusPacks: number;
  missing: Missing[];
  /** Traitement prescrit dont la quantité n'a pas été validée. */
  needsValidation: boolean;
  formula: string;
}

const fmt = (n: number) =>
  Number.isInteger(n)
    ? String(n)
    : n
        .toFixed(2)
        .replace(/\.?0+$/, '')
        .replace('.', ',');

export function computeLine(
  line: PharmacyLine,
  plan: Pick<PharmacyPlan, 'persons' | 'duration' | 'marginPercent'>,
  asOf: string,
): LineResult {
  assertIsoDate(asOf);
  const days = durationDays(plan.duration);
  const margin = 1 + plan.marginPercent / 100;
  const missing: Missing[] = [];
  let units: number | null = null;
  let targetPacks: number | null = null;
  let formula = '';

  if (line.kind === 'occasional' && line.precautionPacks !== undefined) {
    targetPacks = line.precautionPacks;
    formula = `Objectif = ${fmt(
      line.precautionPacks,
    )} boîte(s) choisie(s) à la main ; ni durée ni marge`;
  } else if (line.kind === 'occasional') {
    if (
      line.episodesPerYear === undefined ||
      line.unitsPerEpisode === undefined
    ) {
      missing.push('precautionPacks');
    } else {
      const episodes =
        (line.episodesPerYear * plan.persons * days) / DAYS_PER_YEAR;
      units = Math.ceil(episodes * line.unitsPerEpisode * margin - 1e-9);
    }
    if (line.packSize === undefined) {
      missing.push('packSize');
    } else if (units !== null) {
      targetPacks = Math.ceil(units / line.packSize);
    }
    formula = `Unités = ${fmt(
      line.episodesPerYear ?? NaN,
    )} épisode(s) par personne et par an × ${
      plan.persons
    } personne(s) × ${days} j ÷ ${DAYS_PER_YEAR} × ${fmt(
      line.unitsPerEpisode ?? NaN,
    )} ${line.unit} par épisode × ${fmt(margin)} (marge ${
      plan.marginPercent
    } %), arrondi à l’unité ; boîtes = unités ÷ ${
      line.packSize ?? '?'
    }, arrondi au-dessus`.replace(/NaN/g, '?');
  } else {
    const perDay =
      line.kind === 'consumable'
        ? line.perPersonPerMonth === undefined
          ? null
          : (line.perPersonPerMonth * plan.persons) / DAYS_PER_MONTH
        : line.prescribedPerDay === undefined
        ? null
        : line.prescribedPerDay * (line.prescribedPersons ?? 1);
    if (perDay === null) {
      missing.push(
        line.kind === 'consumable' ? 'perPersonPerMonth' : 'prescribedPerDay',
      );
    } else {
      // Arrondi à l'unité supérieure : on ne stocke pas une demi-compresse.
      units = Math.ceil(perDay * days * margin - 1e-9);
    }
    if (line.packSize === undefined) {
      missing.push('packSize');
    } else if (units !== null) {
      targetPacks = Math.ceil(units / line.packSize);
    }
    const base =
      line.kind === 'consumable'
        ? `${fmt(line.perPersonPerMonth ?? NaN)} ${
            line.unit
          } par personne et par mois × ${
            plan.persons
          } personne(s) × ${days} j ÷ ${DAYS_PER_MONTH}`
        : `${fmt(line.prescribedPerDay ?? NaN)} ${line.unit} par jour × ${
            line.prescribedPersons ?? 1
          } personne(s) × ${days} j`;
    formula = `Unités = ${base.replace('NaN', '?')} × ${fmt(margin)} (marge ${
      plan.marginPercent
    } %), arrondi à l’unité ; boîtes = unités ÷ ${
      line.packSize ?? '?'
    } par conditionnement, arrondi au-dessus`;
  }

  let availablePacks = 0;
  let expiredPacks = 0;
  for (const lot of line.lots) {
    if (lot.expiry !== undefined && lot.expiry < asOf) {
      expiredPacks += lot.packs;
    } else {
      availablePacks += lot.packs;
    }
  }
  return {
    line,
    units,
    targetPacks,
    availablePacks,
    expiredPacks,
    toBuyPacks:
      targetPacks === null ? null : Math.max(0, targetPacks - availablePacks),
    surplusPacks:
      targetPacks === null ? 0 : Math.max(0, availablePacks - targetPacks),
    missing,
    needsValidation: line.kind === 'prescribed' && line.validated !== true,
    formula,
  };
}

// --- Alertes -------------------------------------------------------------------

export type AlertKind =
  | 'expired'
  | 'expiresSoon'
  | 'expiresDuring'
  | 'cold'
  | 'duplicate';

export interface PharmacyAlert {
  kind: AlertKind;
  lineIds: string[];
  message: string;
}

const normalize = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

export function pharmacyAlerts(
  plan: PharmacyPlan,
  asOf: string,
): PharmacyAlert[] {
  assertIsoDate(asOf);
  const alerts: PharmacyAlert[] = [];
  const soon = addDays(asOf, EXPIRY_WARNING_DAYS);
  const end = addDays(asOf, durationDays(plan.duration));
  for (const line of plan.lines) {
    for (const lot of line.lots) {
      if (lot.expiry === undefined || lot.packs === 0) {
        continue;
      }
      if (lot.expiry < asOf) {
        alerts.push({
          kind: 'expired',
          lineIds: [line.id],
          message: `${line.name} : ${lot.packs} conditionnement(s) périmé(s) depuis le ${lot.expiry}. Ne pas les utiliser ; les rapporter en pharmacie.`,
        });
      } else if (lot.expiry < soon) {
        alerts.push({
          kind: 'expiresSoon',
          lineIds: [line.id],
          message: `${line.name} : péremption le ${lot.expiry}, dans moins de ${EXPIRY_WARNING_DAYS} jours.`,
        });
      } else if (lot.expiry < end) {
        alerts.push({
          kind: 'expiresDuring',
          lineIds: [line.id],
          message: `${line.name} : péremption le ${lot.expiry}, avant la fin de la durée simulée.`,
        });
      }
    }
    if (line.storage === 'cold') {
      alerts.push({
        kind: 'cold',
        lineIds: [line.id],
        message: `${line.name} se conserve au réfrigérateur : prévoir une solution en cas de coupure de courant et demander conseil au pharmacien.`,
      });
    }
  }
  const byIngredient = new Map<string, PharmacyLine[]>();
  for (const line of plan.lines) {
    if (line.ingredient) {
      const key = normalize(line.ingredient);
      byIngredient.set(key, [...(byIngredient.get(key) ?? []), line]);
    }
  }
  for (const lines of byIngredient.values()) {
    if (lines.length > 1) {
      alerts.push({
        kind: 'duplicate',
        lineIds: lines.map(l => l.id),
        message: `${lines
          .map(l => l.name)
          .join(', ')} contiennent le même principe actif (${
          lines[0].ingredient
        }) : ne jamais les prendre ensemble.`,
      });
    }
  }
  return alerts;
}

// --- Validation des données ------------------------------------------------------

const isInt = (n: unknown, [min, max]: readonly [number, number]) =>
  typeof n === 'number' && Number.isInteger(n) && n >= min && n <= max;
const isNum = (n: unknown, [min, max]: readonly [number, number]) =>
  typeof n === 'number' && Number.isFinite(n) && n >= min && n <= max;
const optional = (n: unknown, check: (v: unknown) => boolean) =>
  n === undefined || check(n);
const isDate = (s: unknown) => {
  if (typeof s !== 'string') {
    return false;
  }
  try {
    assertIsoDate(s);
    return true;
  } catch {
    return false;
  }
};

/** Erreur de saisie lisible, ou null si la ligne est cohérente. */
export function lineError(line: PharmacyLine): string | null {
  if (typeof line.name !== 'string' || line.name.trim() === '') {
    return 'Le nom du produit est obligatoire.';
  }
  if (!(line.kind in KIND_LABELS)) {
    return 'Type de produit inconnu.';
  }
  if (!optional(line.packSize, v => isInt(v, LIMITS.packSize))) {
    return 'Le conditionnement doit être un nombre entier d’unités, au moins 1.';
  }
  if (
    !optional(line.perPersonPerMonth, v => isNum(v, [0, LIMITS.quantity[1]]))
  ) {
    return 'La quantité par personne et par mois doit être positive.';
  }
  if (!optional(line.episodesPerYear, v => isNum(v, [0, 365]))) {
    return 'Le nombre d’épisodes par an doit être compris entre 0 et 365.';
  }
  if (!optional(line.unitsPerEpisode, v => isNum(v, [0, LIMITS.quantity[1]]))) {
    return 'Les unités par épisode doivent être positives.';
  }
  if (!optional(line.precautionPacks, v => isInt(v, LIMITS.quantity))) {
    return 'Le nombre de boîtes doit être un entier positif.';
  }
  if (
    !optional(line.prescribedPerDay, v => isNum(v, [0, LIMITS.quantity[1]]))
  ) {
    return 'La quantité par jour doit être positive.';
  }
  if (!optional(line.prescribedPersons, v => isInt(v, LIMITS.persons))) {
    return 'Le nombre de personnes doit être compris entre 1 et 50.';
  }
  for (const lot of line.lots) {
    if (!isInt(lot.packs, LIMITS.quantity)) {
      return 'Une quantité en stock doit être un entier positif ou nul.';
    }
    if (lot.expiry !== undefined && !isDate(lot.expiry)) {
      return 'Date de péremption invalide (AAAA-MM-JJ).';
    }
  }
  return null;
}

export function planError(plan: PharmacyPlan): string | null {
  if (!isInt(plan.persons, LIMITS.persons)) {
    return 'Le nombre de personnes doit être compris entre 1 et 50.';
  }
  if (
    !(plan.duration.unit in DURATION_LABELS) ||
    !isNum(plan.duration.value, [0.0001, Infinity]) ||
    !isInt(durationDays(plan.duration), LIMITS.days)
  ) {
    return 'La durée doit être comprise entre 1 jour et 10 ans.';
  }
  if (!isNum(plan.marginPercent, LIMITS.marginPercent)) {
    return 'La marge doit être comprise entre 0 et 100 %.';
  }
  for (const line of plan.lines) {
    const error = lineError(line);
    if (error) {
      return `${line.name || 'Produit'} : ${error}`;
    }
  }
  return null;
}

// --- Enregistrement --------------------------------------------------------------

export const PHARMACY_KEY = 'pharmacy_plan';

export async function loadPharmacyPlan(
  db: SqlDatabase,
): Promise<PharmacyPlan | null> {
  const { rows } = await db.execute(
    'SELECT value FROM settings WHERE key = ?',
    [PHARMACY_KEY],
  );
  if (rows.length === 0) {
    return null;
  }
  try {
    const plan = JSON.parse(String(rows[0].value)) as PharmacyPlan;
    return plan.version === 1 &&
      Array.isArray(plan.lines) &&
      plan.lines.every(l => Array.isArray(l.lots)) &&
      planError(plan) === null
      ? plan
      : null;
  } catch {
    return null;
  }
}

export async function savePharmacyPlan(
  db: SqlDatabase,
  plan: PharmacyPlan,
): Promise<void> {
  const error = planError(plan);
  if (error) {
    throw new Error(error);
  }
  await db.execute(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
    [PHARMACY_KEY, JSON.stringify(plan)],
  );
}

// --- Export ----------------------------------------------------------------------

const CSV_HEADER = [
  'Produit',
  'Principe actif',
  'Besoin',
  'Type',
  'Unité',
  'Unités par conditionnement',
  'Objectif (conditionnements)',
  'En stock (utilisables)',
  'Périmés',
  'À acheter',
  'Prochaine péremption',
  'Conservation',
  'Délivrance',
  'Source',
  'Données manquantes',
];

function cell(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value);
  return /[";\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Tableur (« ; », BOM UTF-8) : hypothèses en tête, une ligne par produit. */
export function pharmacyCsv(plan: PharmacyPlan, asOf: string): string {
  const [one, many] = DURATION_LABELS[plan.duration.unit];
  const rows: unknown[][] = [
    ['Pharmacie du foyer — objectif de stock, pas une posologie'],
    [
      `${plan.persons} personne(s), ${fmt(plan.duration.value)} ${
        plan.duration.value > 1 ? many : one
      } (${durationDays(plan.duration)} j), marge ${
        plan.marginPercent
      } %, au ${asOf}`,
    ],
    [],
    CSV_HEADER,
  ];
  for (const line of plan.lines) {
    const r = computeLine(line, plan, asOf);
    const next = line.lots
      .map(l => l.expiry)
      .filter((d): d is string => d !== undefined && d >= asOf)
      .sort()[0];
    rows.push([
      line.name,
      line.ingredient,
      line.need,
      KIND_LABELS[line.kind],
      line.unit,
      line.packSize,
      r.targetPacks,
      r.availablePacks,
      r.expiredPacks,
      r.toBuyPacks,
      next,
      STORAGE_LABELS[line.storage],
      line.delivery ? DELIVERY_LABELS[line.delivery.status] : 'À confirmer',
      line.delivery?.source,
      [
        ...r.missing.map(m => MISSING_LABELS[m]),
        ...(r.needsValidation ? ['À valider avec le médecin'] : []),
      ].join(' · '),
    ]);
  }
  return `﻿${rows.map(r => r.map(cell).join(';')).join('\r\n')}\r\n`;
}
