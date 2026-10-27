/**
 * Liste de pharmacie familiale : adultes, enfants et durée donnent une liste
 * organisée de médicaments et de petit matériel, à cocher et à exporter.
 *
 * Trois bases de quantité, toujours affichées :
 * - estimation : fréquence publiée × quantité au plus par épisode (notice),
 *   pour les adultes seulement, repris du catalogue de la pharmacie ;
 * - présence : un exemplaire pour le foyer, cité par les listes officielles ;
 * - conseil : pas de repère publié, ou dose selon l'âge et le poids (enfants) :
 *   quantité à définir avec le pharmacien. Jamais de posologie.
 */
import type { SqlDatabase } from '../db/types';
import { GEAR_REFS, type GearRef } from './baseGear';
import {
  DAYS_PER_MONTH,
  DAYS_PER_YEAR,
  PHARMACY_CATALOG,
  type CatalogEntry,
} from './pharmacy';

export const LIST_MONTHS = [1, 3, 6, 12] as const;
export type ListMonths = (typeof LIST_MONTHS)[number];
export const LIST_LIMITS = { adults: [0, 10], children: [0, 10] } as const;

export interface ListSettings {
  version: 1;
  adults: number;
  children: number;
  months: ListMonths;
  /** La liste a été générée pour ces réglages. */
  generated: boolean;
  /** Éléments cochés (identifiants). */
  checked: string[];
}

export type ListSection = 'adults' | 'children' | 'household' | 'gear';

export const SECTION_LABELS: Record<ListSection, string> = {
  adults: 'Adultes : médicaments courants',
  children: 'Enfants',
  household: 'Tout le foyer',
  gear: 'Petit matériel',
};

export type Basis = 'estimate' | 'presence' | 'advice';

export const BASIS_LABELS: Record<Basis, string> = {
  estimate: 'Estimation statistique, pas une prescription',
  presence: 'Un pour le foyer, d’après les listes officielles',
  advice: 'Quantité à définir avec le pharmacien',
};

export interface ListItem {
  id: string;
  section: ListSection;
  name: string;
  /** Quantité affichée : « 6 boîtes de 16 comprimés », « 1 pour le foyer »… */
  quantity: string;
  /** Détail du calcul ou de la raison. */
  detail: string;
  basis: Basis;
  /** Conditionnements estimés (estimation seulement). */
  packs?: number;
  sources: string[];
  caution?: string;
}

export function newListSettings(
  adults: number,
  children: number,
): ListSettings {
  return {
    version: 1,
    adults: clamp(adults, LIST_LIMITS.adults),
    children: clamp(children, LIST_LIMITS.children),
    months: 6,
    generated: false,
    checked: [],
  };
}

function clamp(n: number, [min, max]: readonly [number, number]) {
  return Math.min(max, Math.max(min, Math.round(n)));
}

const plural = (n: number, one: string, many = `${one}s`) =>
  n > 1 ? many : one;

const catalog = (id: string): CatalogEntry => {
  const entry = PHARMACY_CATALOG.find(e => e.id === id);
  if (!entry?.estimate) {
    throw new Error(`Repère manquant : ${id}`);
  }
  return entry;
};

/**
 * Estimation adulte : épisodes par an × adultes × jours ÷ 365 × unités par
 * épisode, arrondie à l'unité puis à la boîte supérieure.
 */
function estimated(
  id: string,
  name: string,
  adults: number,
  days: number,
  extra: { note?: string } = {},
): ListItem {
  const entry = catalog(id);
  const e = entry.estimate!;
  const units = Math.ceil(
    (e.episodesPerYear * adults * days * e.unitsPerEpisode) / DAYS_PER_YEAR -
      1e-9,
  );
  const packSize = e.packSize!;
  const packs = Math.max(1, Math.ceil(units / packSize));
  const episodes = (e.episodesPerYear * adults * days) / DAYS_PER_YEAR;
  return {
    id,
    section: 'adults',
    name,
    quantity: `${packs} ${plural(packs, 'boîte')} de ${packSize} ${plural(
      packSize,
      entry.unit,
    )}`,
    detail: `${fmt(episodes)} épisode(s) attendu(s) × ${
      e.unitsPerEpisode
    } ${plural(
      e.unitsPerEpisode,
      entry.unit,
    )} au plus par épisode = ${units} ${plural(units, entry.unit)}${
      extra.note ? `. ${extra.note}` : ''
    }`,
    basis: 'estimate',
    packs,
    sources: [e.episodesSource, e.unitsSource, e.packSource ?? ''].filter(
      Boolean,
    ),
    caution: entry.caution,
  };
}

const fmt = (n: number) =>
  (Math.round(n * 10) / 10).toString().replace('.', ',');

const refs = (...ids: GearRef[]) => ids.map(id => GEAR_REFS[id].title);

/** Liste pour un foyer et une durée ; vide sans personne. */
export function buildPharmacyList(
  settings: Pick<ListSettings, 'adults' | 'children' | 'months'>,
): ListItem[] {
  const { adults, children, months } = settings;
  const people = adults + children;
  if (people === 0) {
    return [];
  }
  const days = months * DAYS_PER_MONTH;
  const items: ListItem[] = [];

  if (adults > 0) {
    items.push(
      estimated('paracetamol', 'Paracétamol 500 mg (adulte)', adults, days),
      estimated('diosmectite', 'Diosmectite 3 g (diarrhée)', adults, days),
      estimated(
        'loperamide',
        'Lopéramide 2 mg (diarrhée, dès 15 ans)',
        adults,
        days,
        {
          note: 'Alternative à la diosmectite, selon le conseil du pharmacien',
        },
      ),
      {
        id: 'antihistaminique',
        section: 'adults',
        name: 'Antihistaminique (allergie)',
        quantity: BASIS_LABELS.advice,
        detail:
          'Pas de fréquence publiée : selon les allergies connues du foyer.',
        basis: 'advice',
        sources: [],
        caution: catalogCaution('cetirizine'),
      },
    );
  }

  if (children > 0) {
    const forKids = `pour ${children} ${plural(children, 'enfant')}`;
    items.push(
      {
        id: 'paracetamol_enfant',
        section: 'children',
        name: 'Paracétamol pédiatrique',
        quantity: BASIS_LABELS.advice,
        detail: `Forme et dose selon le poids et l’âge de chaque enfant, ${forKids}. Fenrir ne propose pas de posologie.`,
        basis: 'advice',
        sources: [],
        caution:
          'Seringue ou dosette fournie avec le produit ; ne pas cumuler avec un autre produit contenant du paracétamol.',
      },
      {
        id: 'diosmectite_enfant',
        section: 'children',
        name: 'Diosmectite (enfant)',
        quantity: BASIS_LABELS.advice,
        detail: `Pas avant 2 ans ; dose selon l’âge, ${forKids}.`,
        basis: 'advice',
        sources: [],
      },
    );
  }

  items.push(
    {
      id: 'sro',
      section: 'household',
      name: 'Solution de réhydratation orale',
      quantity: BASIS_LABELS.advice,
      detail:
        'Traitement de référence de la diarrhée chez l’enfant ; préparer exactement selon la notice.',
      basis: 'advice',
      sources: refs('bbk'),
    },
    {
      id: 'traitements',
      section: 'household',
      name: 'Traitements habituels',
      quantity: `${months} mois à prévoir`,
      detail:
        'Quantité selon l’ordonnance : demander au médecin un renouvellement adapté, garder une copie des ordonnances.',
      basis: 'advice',
      sources: refs('sgdsn', 'georisques', 'bbk'),
    },
    {
      id: 'trousse',
      section: 'gear',
      name: 'Trousse de premiers secours',
      quantity: '1 pour le foyer',
      detail: 'Compresses stériles, pansements, antiseptique, bande.',
      basis: 'presence',
      sources: refs('sgdsn', 'croixrouge', 'bbk'),
    },
    {
      id: 'thermometre',
      section: 'gear',
      name: 'Thermomètre médical',
      quantity: '1 pour le foyer',
      detail: 'Vérifier la pile.',
      basis: 'presence',
      sources: refs('bbk'),
    },
    {
      id: 'gants',
      section: 'gear',
      name: 'Gants jetables',
      quantity: '1 boîte pour le foyer',
      detail: 'Pour les soins et le nettoyage d’une plaie.',
      basis: 'presence',
      sources: refs('croixrouge', 'bbk', 'canada'),
    },
    {
      id: 'pince',
      section: 'gear',
      name: 'Pince à épiler et ciseaux',
      quantity: '1 pour le foyer',
      detail: 'Échardes, tiques, découpe de pansements.',
      basis: 'presence',
      sources: refs('bbk', 'canada', 'luxembourg'),
    },
    {
      id: 'ffp2',
      section: 'gear',
      name: 'Masques FFP2',
      quantity: '1 boîte pour le foyer',
      detail: 'Poussières, fumées, épidémie.',
      basis: 'presence',
      sources: refs('sgdsn', 'croixrouge', 'bbk'),
    },
  );
  return items;
}

function catalogCaution(id: string) {
  return PHARMACY_CATALOG.find(e => e.id === id)?.caution;
}

// --- Enregistrement --------------------------------------------------------------

export const LIST_KEY = 'pharmacy_list';

export function listSettingsError(s: ListSettings): string | null {
  const inRange = (n: unknown, [min, max]: readonly [number, number]) =>
    typeof n === 'number' && Number.isInteger(n) && n >= min && n <= max;
  if (!inRange(s.adults, LIST_LIMITS.adults)) {
    return 'Le nombre d’adultes doit être compris entre 0 et 10.';
  }
  if (!inRange(s.children, LIST_LIMITS.children)) {
    return 'Le nombre d’enfants doit être compris entre 0 et 10.';
  }
  if (s.adults + s.children === 0) {
    return 'Ajoutez au moins une personne au foyer.';
  }
  if (!(LIST_MONTHS as readonly number[]).includes(s.months)) {
    return 'Durée inconnue.';
  }
  if (
    !Array.isArray(s.checked) ||
    !s.checked.every(id => typeof id === 'string')
  ) {
    return 'Liste cochée illisible.';
  }
  return null;
}

export async function loadListSettings(
  db: SqlDatabase,
): Promise<ListSettings | null> {
  const { rows } = await db.execute(
    'SELECT value FROM settings WHERE key = ?',
    [LIST_KEY],
  );
  if (rows.length === 0) {
    return null;
  }
  try {
    const s = JSON.parse(String(rows[0].value)) as ListSettings;
    return s.version === 1 && listSettingsError(s) === null ? s : null;
  } catch {
    return null;
  }
}

export async function saveListSettings(
  db: SqlDatabase,
  settings: ListSettings,
): Promise<void> {
  const error = listSettingsError(settings);
  if (error) {
    throw new Error(error);
  }
  await db.execute(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
    [LIST_KEY, JSON.stringify(settings)],
  );
}

// --- Export ----------------------------------------------------------------------

function cell(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value);
  return /[";\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Tableur (« ; », BOM UTF-8) : hypothèses en tête, une ligne par élément. */
export function pharmacyListCsv(settings: ListSettings, asOf: string): string {
  const rows: unknown[][] = [
    ['Pharmacie familiale — liste indicative, pas une prescription'],
    [
      `${settings.adults} adulte(s), ${settings.children} enfant(s), ${settings.months} mois, au ${asOf}`,
    ],
    [],
    ['Rubrique', 'Élément', 'Quantité', 'Détail', 'Base', 'Sources', 'Coché'],
  ];
  for (const item of buildPharmacyList(settings)) {
    rows.push([
      SECTION_LABELS[item.section],
      item.name,
      item.quantity,
      item.detail,
      BASIS_LABELS[item.basis],
      item.sources.join(' · '),
      settings.checked.includes(item.id) ? 'oui' : '',
    ]);
  }
  return `﻿${rows.map(r => r.map(cell).join(';')).join('\r\n')}\r\n`;
}
