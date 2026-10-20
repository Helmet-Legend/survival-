/**
 * Préparation par paliers : le kit d'urgence recommandé (guide « Tous
 * responsables », SGDSN 2025, et kit 72 h de Géorisques), vérifié d'après
 * le stock réel. Pour la maison, l'eau et les vivres se mesurent en jours
 * d'autonomie selon le palier choisi ; pour un sac, sur 72 h pour une
 * personne. L'équipement est le même à tous les paliers.
 *
 * Ce que le stock ne suit pas (argent liquide, double des clés) se coche à
 * la main. Les listes sont indicatives : rien n'est compté qui n'a pas été
 * saisi.
 */
import type { SqlDatabase } from '../db/types';
import type { ItemCategory, ItemSummary } from '../inventory';
import {
  computeResilience,
  loadConsumableLots,
  loadHousehold,
} from '../resilience/resilienceCalculator';

/** Paliers proposés, en jours ; 3 jours est le minimum officiel. */
export const TIERS = [2, 3, 7, 10] as const;
export type Tier = (typeof TIERS)[number];
export const OFFICIAL_TIER: Tier = 3;

/** `home` pour la maison, sinon l'identifiant du sac. */
export type Scope = 'home' | string;

export type CheckKind = 'water' | 'food' | 'stock' | 'documents' | 'manual';

export interface CheckDefinition {
  id: string;
  label: string;
  hint?: string;
  kind: CheckKind;
  /** Pour `stock` : la catégorie et les types qui conviennent. */
  category?: ItemCategory;
  subtypes?: readonly string[];
  /** Mots du nom qui conviennent aussi (sans accents, minuscules). */
  names?: readonly string[];
  /** Où l'ajouter : catégorie et valeurs préremplies de la fiche. */
  add?: { category: ItemCategory; prefill?: Record<string, string> };
  /** Seulement pour la maison ou seulement pour un sac. */
  only?: 'home' | 'bag';
}

export const CHECKS: readonly CheckDefinition[] = [
  {
    id: 'water',
    label: 'Eau potable',
    hint: '6 L par personne pour 72 h (2 L par jour).',
    kind: 'water',
    add: { category: 'water' },
  },
  {
    id: 'food',
    label: 'Vivres non périssables',
    hint: 'De préférence sans cuisson.',
    kind: 'food',
    add: { category: 'food' },
  },
  {
    id: 'radio',
    label: 'Radio à piles',
    hint: 'Pour suivre les consignes des autorités.',
    kind: 'stock',
    category: 'energy',
    subtypes: ['communication'],
    names: ['radio'],
    add: {
      category: 'energy',
      prefill: { name: 'Radio à piles', subtype: 'communication' },
    },
  },
  {
    id: 'light',
    label: 'Lampe de poche ou frontale',
    kind: 'stock',
    category: 'energy',
    subtypes: ['lighting'],
    names: ['lampe', 'torche', 'frontale'],
    add: {
      category: 'energy',
      prefill: { name: 'Lampe frontale', subtype: 'lighting' },
    },
  },
  {
    id: 'batteries',
    label: 'Piles de rechange',
    kind: 'stock',
    category: 'power',
    subtypes: ['battery'],
    names: ['pile'],
    add: { category: 'power', prefill: { name: 'Piles', subtype: 'battery' } },
  },
  {
    id: 'powerbank',
    label: 'Batterie externe et chargeur',
    kind: 'stock',
    category: 'power',
    subtypes: ['powerbank', 'solar'],
    names: ['batterie externe', 'chargeur', 'powerbank'],
    add: {
      category: 'power',
      prefill: { name: 'Batterie externe', subtype: 'powerbank' },
    },
  },
  {
    id: 'fire',
    label: 'Bougies, briquet ou allumettes',
    kind: 'stock',
    category: 'power',
    subtypes: ['candle'],
    names: ['bougie', 'briquet', 'allumette'],
    add: { category: 'power', prefill: { name: 'Bougies', subtype: 'candle' } },
  },
  {
    id: 'firstaid',
    label: 'Trousse de premiers secours',
    kind: 'stock',
    category: 'medical',
    subtypes: ['dressing', 'antiseptic'],
    names: ['trousse', 'pansement', 'compresse'],
    add: { category: 'medical' },
  },
  {
    id: 'medicine',
    label: 'Médicaments essentiels',
    hint: 'Vos traitements habituels, et une copie des ordonnances.',
    kind: 'stock',
    category: 'medical',
    subtypes: ['medicine'],
    add: { category: 'medical', prefill: { subtype: 'medicine' } },
  },
  {
    id: 'warm',
    label: 'Vêtements chauds, couverture',
    kind: 'stock',
    category: 'energy',
    subtypes: ['sleeping', 'protection'],
    names: ['couverture', 'vetement', 'polaire', 'duvet', 'sac de couchage'],
    add: {
      category: 'energy',
      prefill: { name: 'Couverture de survie', subtype: 'sleeping' },
    },
  },
  {
    id: 'documents',
    label: 'Copies des documents essentiels',
    hint: 'Pièces d’identité, carte Vitale, assurance.',
    kind: 'documents',
    only: 'home',
  },
  {
    id: 'documents_copy',
    label: 'Copies papier des documents',
    hint: 'Pièces d’identité, carte Vitale, assurance.',
    kind: 'manual',
    only: 'bag',
  },
  {
    id: 'cash',
    label: 'Argent liquide',
    hint: 'Les paiements par carte peuvent être coupés.',
    kind: 'manual',
  },
  {
    id: 'keys',
    label: 'Double des clés',
    kind: 'manual',
  },
];

export interface CheckResult {
  definition: CheckDefinition;
  done: boolean;
  /** Ce qui a été trouvé, ou ce qui manque (« 4 j sur 7 »). */
  detail: string | null;
}

export interface PreparationReport {
  scope: Scope;
  tier: Tier;
  /** Jours demandés pour l'eau et les vivres (72 h pour un sac). */
  days: number;
  results: CheckResult[];
  done: number;
  total: number;
}

function plain(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/** Un article utilisable (lots non périmés) correspond-il à l'élément ? */
export function matches(check: CheckDefinition, item: ItemSummary): boolean {
  if (item.usableQuantity <= 0) {
    return false;
  }
  if (
    check.category === item.category &&
    item.subtype !== null &&
    (check.subtypes ?? []).includes(item.subtype)
  ) {
    return true;
  }
  const name = plain(item.name);
  return (check.names ?? []).some(word => name.includes(word));
}

export async function loadMarks(
  db: SqlDatabase,
  scope: Scope,
): Promise<Set<string>> {
  const { rows } = await db.execute(
    'SELECT item FROM preparation_marks WHERE scope = ?',
    [scope],
  );
  return new Set(rows.map(r => String(r.item)));
}

export async function setMark(
  db: SqlDatabase,
  scope: Scope,
  item: string,
  checked: boolean,
): Promise<void> {
  if (checked) {
    await db.execute(
      'INSERT OR IGNORE INTO preparation_marks (scope, item) VALUES (?, ?)',
      [scope, item],
    );
  } else {
    await db.execute(
      'DELETE FROM preparation_marks WHERE scope = ? AND item = ?',
      [scope, item],
    );
  }
}

/** Jours d'autonomie en eau et en vivres du foyer (stock général). */
export async function loadHomeAutonomy(
  db: SqlDatabase,
  asOf: string,
): Promise<{ water: number; food: number }> {
  const [household, lots] = await Promise.all([
    loadHousehold(db),
    loadConsumableLots(db),
  ]);
  const autonomy = computeResilience(lots, household, asOf);
  return { water: autonomy.water.days, food: autonomy.food.days };
}

const daysLabel = (have: number, need: number) => `${have} j sur ${need}`;

/**
 * Évalue la liste pour la maison (stock général, foyer entier, palier
 * choisi) ou pour un sac (son contenu, une personne, 72 h).
 */
export async function getPreparation(
  db: SqlDatabase,
  input: {
    scope: Scope;
    tier: Tier;
    /** Articles du périmètre (stock général ou contenu du sac). */
    items: readonly ItemSummary[];
    documentCount: number;
    asOf: string;
  },
): Promise<PreparationReport> {
  const bag = input.scope !== 'home';
  const days = bag ? OFFICIAL_TIER : input.tier;
  const household = await loadHousehold(db);
  const lots = await loadConsumableLots(db, bag ? input.scope : undefined);
  const autonomy = computeResilience(
    lots,
    bag ? { ...household, members: 1 } : household,
    input.asOf,
  );
  const marks = await loadMarks(db, input.scope);
  const results = CHECKS.filter(
    c => c.only === undefined || c.only === (bag ? 'bag' : 'home'),
  ).map((definition): CheckResult => {
    switch (definition.kind) {
      case 'water':
      case 'food': {
        const have = autonomy[definition.kind].days;
        return {
          definition,
          done: have >= days,
          detail: daysLabel(have, days),
        };
      }
      case 'documents':
        return {
          definition,
          done: input.documentCount > 0,
          detail:
            input.documentCount > 0
              ? `${input.documentCount} dans le dossier Documents`
              : null,
        };
      case 'manual':
        return { definition, done: marks.has(definition.id), detail: null };
      case 'stock': {
        const found = input.items.filter(item => matches(definition, item));
        return {
          definition,
          done: found.length > 0,
          detail:
            found.length === 0
              ? null
              : found
                  .slice(0, 2)
                  .map(item => item.name)
                  .join(', ') + (found.length > 2 ? '…' : ''),
        };
      }
    }
  });
  return {
    scope: input.scope,
    tier: input.tier,
    days,
    results,
    done: results.filter(r => r.done).length,
    total: results.length,
  };
}
