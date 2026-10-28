/**
 * Pharmacie familiale : le moteur de calcul donne le nombre de boîtes de
 * chaque médicament et du petit matériel ; l'utilisateur indique ce qu'il a
 * déjà, Fenrir dit ce qu'il manque. Quelques produits restent à décider avec
 * le pharmacien (traitements habituels, alternatives, enfants) : ils forment
 * une courte liste à cocher. Jamais de posologie.
 */
import type { SqlDatabase } from '../db/types';
import { GEAR_REFS, type GearRef } from './baseGear';
import {
  DELIVERY_LABELS,
  PHARMACY_CATALOG,
  STORAGE_LABELS,
  type CatalogEntry,
} from './pharmacy';
import {
  boxesByAdults,
  boxesByChildren,
  CATEGORY_LABELS,
  computeStock,
  formatBoxes,
  formatQuantity,
  DURATIONS,
  householdError,
  type CatalogueMed,
  type EngineResult,
  type Household,
  type MedResult,
} from './pharmacyEngine';

export const LIST_LIMITS = { adults: [0, 10], children: [0, 10] } as const;
/** Boîtes déjà en stock : au plus ce nombre par produit. */
export const HAVE_MAX = 999;

/** Réglages du foyer (moteur), stock déclaré et état de la liste. */
export interface ListSettings extends Household {
  version: 4;
  /** Le calcul a été lancé pour ces réglages. */
  generated: boolean;
  /** Boîtes déjà en stock, par référence du moteur. */
  have: Record<string, number>;
  /** Produits à décider avec le pharmacien, cochés (identifiants). */
  checked: string[];
}

export function newListSettings(
  adults: number,
  children: number,
): ListSettings {
  return {
    version: 4,
    adults: clamp(adults, LIST_LIMITS.adults),
    childWeights: Array<number | null>(
      clamp(children, LIST_LIMITS.children),
    ).fill(null),
    days: 30,
    generated: false,
    have: {},
    checked: [],
  };
}

function clamp(n: number, [min, max]: readonly [number, number]) {
  return Math.min(max, Math.max(min, Math.round(n)));
}

// --- Tableau de stock ------------------------------------------------------------

/** Ligne du tableau : calcul du moteur, stock déclaré et manque. */
export interface StockRow extends MedResult {
  /** Boîtes déjà en stock (saisie). */
  have: number;
  /** Boîtes qui manquent pour atteindre l'objectif. */
  missing: number;
}

export function stockTable(settings: ListSettings): {
  rows: StockRow[];
  result: EngineResult;
} {
  const result = computeStock(settings);
  const rows = result.meds.map(m => {
    const have = settings.have[m.ref] ?? 0;
    return { ...m, have, missing: Math.max(0, m.boxes - have) };
  });
  return { rows, result };
}

/** Bilan : produits complets, boîtes à stocker, déjà là, à acheter. */
export function stockSummary(rows: StockRow[]) {
  return {
    complete: rows.filter(r => r.missing === 0).length,
    total: rows.length,
    boxes: rows.reduce((n, r) => n + r.boxes, 0),
    have: rows.reduce((n, r) => n + Math.min(r.have, r.boxes), 0),
    missing: rows.reduce((n, r) => n + r.missing, 0),
  };
}

/** Précautions, délivrance et conservation d'un produit du moteur. */
export function medInfo(med: CatalogueMed): {
  caution?: string;
  practical?: string;
  deliverySource?: string;
} {
  const entry = med.catalogId
    ? PHARMACY_CATALOG.find(e => e.id === med.catalogId)
    : undefined;
  return entry
    ? {
        caution: entry.caution,
        practical: practical(entry),
        deliverySource: entry.delivery?.source,
      }
    : {};
}

export { boxesByAdults, CATEGORY_LABELS, formatBoxes, formatQuantity };

// --- À décider avec le pharmacien ----------------------------------------------

export interface ListItem {
  id: string;
  name: string;
  /** « 6 mois à prévoir », « Alternative au racécadotril »… */
  quantity: string;
  detail: string;
  use: string;
  consult?: string;
  practical?: string;
  sources: string[];
  caution?: string;
}

const entryOf = (id: string): CatalogEntry => {
  const entry = PHARMACY_CATALOG.find(e => e.id === id);
  if (!entry) {
    throw new Error(`Produit inconnu : ${id}`);
  }
  return entry;
};

/** Délivrance (si vérifiée) et conservation, tirées du catalogue. */
function practical(entry: CatalogEntry): string {
  return [
    entry.delivery
      ? DELIVERY_LABELS[entry.delivery.status]
      : 'Délivrance à confirmer avec le pharmacien',
    STORAGE_LABELS[entry.storage],
  ].join(' · ');
}

const refs = (...ids: GearRef[]) => ids.map(id => GEAR_REFS[id].title);

function fromCatalog(
  id: string,
  info: Omit<ListItem, 'id' | 'practical' | 'caution' | 'sources'> & {
    catalogId?: string;
    sources?: string[];
  },
): ListItem {
  const entry = entryOf(info.catalogId ?? id);
  return {
    id,
    name: info.name,
    quantity: info.quantity,
    detail: info.detail,
    use: info.use,
    consult: info.consult,
    practical: practical(entry),
    sources: [...(info.sources ?? []), entry.delivery?.source ?? ''].filter(
      Boolean,
    ),
    caution: entry.caution,
  };
}

/** Produits sans quantité calculée : traitements, alternatives, enfants. */
export function buildPharmacyList(
  settings: Pick<ListSettings, 'adults' | 'childWeights' | 'days'>,
): ListItem[] {
  const { adults, days } = settings;
  const children = settings.childWeights.length;
  if (adults + children === 0) {
    return [];
  }
  const items: ListItem[] = [
    {
      id: 'traitements',
      name: 'Traitements habituels',
      quantity: `${days} jours à prévoir`,
      detail:
        'Quantité selon l’ordonnance : demander au médecin un renouvellement adapté, garder une copie des ordonnances.',
      use: 'Maladies chroniques (tension, diabète, thyroïde, asthme…), contraception.',
      sources: refs('sgdsn', 'georisques', 'bbk'),
    },
  ];
  if (children > 0) {
    items.push({
      id: 'couches',
      name: 'Couches et protections enfant',
      quantity: 'Selon la consommation habituelle',
      detail:
        'À calculer selon l’âge et la consommation de chaque enfant sur la durée.',
      use: 'Bébés et jeunes enfants.',
      sources: [],
    });
  }
  items.push(
    fromCatalog('antifongique', {
      name: 'Antifongique cutané',
      quantity: 'Selon les besoins du foyer',
      detail:
        'Pas de fréquence publiée. Hygiène réduite et humidité favorisent les mycoses.',
      use: 'Mycoses de la peau et des pieds.',
    }),
  );
  return items;
}

/** Règles de constitution du stock, affichées repliées. */
export const STOCK_RULES: readonly string[] = [
  'Préférer les unidoses et les comprimés sous blister : un flacon ouvert se garde moins longtemps (durée après ouverture sur la notice).',
  'Renouveler par roulement : utiliser d’abord ce qui périme le plus tôt, vérifier les dates une fois par an.',
  'Garder les notices et une copie des ordonnances avec la pharmacie.',
  'Ranger au sec, à l’abri de la chaleur et hors de portée des enfants.',
];

// --- Enregistrement --------------------------------------------------------------

export const LIST_KEY = 'pharmacy_list';

export function listSettingsError(s: ListSettings): string | null {
  const error = householdError(s);
  if (error) {
    return error;
  }
  if (
    typeof s.have !== 'object' ||
    s.have === null ||
    !Object.values(s.have).every(
      n => Number.isInteger(n) && n >= 0 && n <= HAVE_MAX,
    )
  ) {
    return 'Stock déclaré illisible.';
  }
  if (
    !Array.isArray(s.checked) ||
    !s.checked.every(id => typeof id === 'string')
  ) {
    return 'Liste cochée illisible.';
  }
  return null;
}

type StoredV1 = {
  version: 1;
  adults: number;
  children: number;
  months: number;
  generated: boolean;
  checked: string[];
};
type StoredV2 = Omit<ListSettings, 'version' | 'have' | 'days'> & {
  version: 2;
  months: number;
};
type StoredV3 = Omit<ListSettings, 'version' | 'days'> & {
  version: 3;
  months: number;
};

/** Durée en mois des versions précédentes → la durée proposée la plus proche. */
const toDays = (months: number) =>
  DURATIONS.reduce((best, d) =>
    Math.abs(d - months * 30) < Math.abs(best - months * 30) ? d : best,
  );

/** Reprend les réglages des versions précédentes. */
function upgrade(
  raw: StoredV1 | StoredV2 | StoredV3 | ListSettings,
): ListSettings | null {
  switch (raw.version) {
    case 1:
      return {
        version: 4,
        adults: raw.adults,
        childWeights: Array<number | null>(raw.children).fill(null),
        days: toDays(raw.months),
        generated: raw.generated,
        have: {},
        checked: raw.checked,
      };
    case 2:
    case 3:
      return {
        version: 4,
        adults: raw.adults,
        childWeights: raw.childWeights,
        days: toDays(raw.months),
        generated: raw.generated,
        have: raw.version === 3 ? raw.have : {},
        checked: raw.checked,
      };
    case 4:
      return raw;
    default:
      return null;
  }
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
    const s = upgrade(JSON.parse(String(rows[0].value)));
    return s !== null && listSettingsError(s) === null ? s : null;
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

/** Tableur (« ; », BOM UTF-8) : stock à constituer, progression, à décider. */
export function pharmacyListCsv(settings: ListSettings, asOf: string): string {
  const rows: unknown[][] = [
    ['Pharmacie familiale — liste indicative, pas une prescription'],
    [
      `${settings.adults} adulte(s), ${settings.childWeights.length} enfant(s), ${settings.days} jours, au ${asOf}`,
    ],
    [],
    [
      'Rubrique',
      'Produit',
      'Quantité totale (marge comprise)',
      'À stocker',
      'J’en ai',
      'Il manque',
      'Pour',
      'Base',
      'Sources',
    ],
  ];
  for (const r of stockTable(settings).rows) {
    rows.push([
      CATEGORY_LABELS[r.med.categorie],
      r.med.nom,
      formatQuantity(r.withMargin, r.med.format),
      formatBoxes(r.boxes, r.med),
      r.have,
      r.missing,
      r.from.join(' · '),
      r.sourced ? 'Fréquence sourcée' : 'Repère non sourcé, à valider',
      [...r.sources, r.med.boiteSource].join(' · '),
    ]);
  }
  const byAdults = boxesByAdults(settings);
  rows.push(
    [],
    [`Boîtes selon le nombre d’adultes (${settings.days} jours)`],
    ['Produit', ...byAdults[0].boxes.map((_, i) => `${i + 1} adulte(s)`)],
    ...byAdults.map(r => [r.med.nom, ...r.boxes]),
  );
  const weights = settings.childWeights.filter((w): w is number => w !== null);
  if (weights.length > 0) {
    const weight = weights.reduce((a, b) => a + b, 0) / weights.length;
    const byChildren = boxesByChildren(settings, weight);
    rows.push(
      [],
      [
        `Boîtes selon le nombre d’enfants de ${
          Math.round(weight * 10) / 10
        } kg (sans adulte)`.replace('.', ','),
      ],
      ['Produit', ...byChildren[0].boxes.map((_, i) => `${i + 1} enfant(s)`)],
      ...byChildren.map(r => [r.med.nom, ...r.boxes]),
    );
  }
  rows.push(
    [],
    ['À décider avec le pharmacien', 'Quantité', 'Détail', 'Coché'],
    ...buildPharmacyList(settings).map(i => [
      i.name,
      i.quantity,
      i.detail,
      settings.checked.includes(i.id) ? 'oui' : '',
    ]),
  );
  return `﻿${rows.map(r => r.map(cell).join(';')).join('\r\n')}\r\n`;
}
