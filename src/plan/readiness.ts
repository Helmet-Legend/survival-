/**
 * Indice de préparation : un score sur 100, explicable critère par critère,
 * calculé uniquement d'après ce qui est saisi dans Fenrir (stock général,
 * kit 72 h, documents, plan familial, sacs). Chaque critère dit pourquoi il
 * a ses points et quelle action en ajouterait. Ce n'est pas une mesure de
 * la sécurité réelle.
 */
import type { SqlDatabase } from '../db/types';
import type { BagSummary, ItemCategory, ItemSummary } from '../inventory';
import { computeEnergy } from '../resilience/energy';
import {
  computeResilience,
  loadConsumableLots,
  loadHousehold,
} from '../resilience/resilienceCalculator';
import { loadFamilyPlan, type FamilyPlan } from './familyPlan';
import { getPreparation, OFFICIAL_TIER, type CheckResult } from './preparation';

export type ReadinessAction =
  | { kind: 'add'; category: ItemCategory; prefill?: Record<string, string> }
  | { kind: 'preparation' }
  | { kind: 'familyPlan' }
  | { kind: 'documents' }
  | { kind: 'bags' };

export interface ReadinessCriterion {
  id: string;
  label: string;
  points: number;
  max: number;
  /** Ce qui explique les points obtenus. */
  reason: string;
  /** Ce qu'il reste à faire, ou null si le critère est complet. */
  todo: string | null;
  action: ReadinessAction;
}

export interface ReadinessReport {
  score: number;
  level: string;
  criteria: ReadinessCriterion[];
  /** Critères incomplets, du plus grand nombre de points à gagner au plus petit. */
  next: ReadinessCriterion[];
}

export function readinessLevel(score: number): string {
  if (score >= 90) {
    return 'Très bien préparé';
  }
  if (score >= 70) {
    return 'Solide';
  }
  if (score >= 40) {
    return 'En progrès';
  }
  return 'À construire';
}

const plural = (n: number, one: string, many = `${one}s`) =>
  `${n} ${n > 1 ? many : one}`;

/** Points proportionnels aux jours couverts, plafonnés au palier officiel. */
function daysPoints(days: number, max: number): number {
  return Math.round(max * Math.min(1, days / OFFICIAL_TIER));
}

export interface ReadinessInput {
  items: readonly ItemSummary[];
  members: number;
  /** Jours d'autonomie en eau et en vivres (péremptions comprises). */
  waterDays: number;
  foodDays: number;
  /** Résultats du kit 72 h de la maison, par identifiant. */
  checks: ReadonlyMap<string, CheckResult>;
  documentCount: number;
  plan: FamilyPlan;
  bags: readonly BagSummary[];
}

/** Calcul pur, à partir des données déjà chargées. */
export function computeReadiness(input: ReadinessInput): ReadinessReport {
  const has = (id: string) => input.checks.get(id)?.done === true;
  // Ajout proposé : la fiche préremplie du kit pour le premier manque.
  const addFor = (...ids: string[]): ReadinessAction => {
    const missing = ids.find(id => !has(id)) ?? ids[0];
    const add = input.checks.get(missing)?.definition.add;
    return add ? { kind: 'add', ...add } : { kind: 'preparation' };
  };
  const criteria: ReadinessCriterion[] = [];

  const water = daysPoints(input.waterDays, 20);
  criteria.push({
    id: 'water',
    label: 'Eau potable',
    points: water,
    max: 20,
    reason: `${plural(input.waterDays, 'jour')} d’autonomie pour le foyer`,
    todo:
      water < 20
        ? `Atteindre ${OFFICIAL_TIER} jours (2 L par personne et par jour au minimum)`
        : null,
    action: { kind: 'add', category: 'water' },
  });

  const food = daysPoints(input.foodDays, 15);
  criteria.push({
    id: 'food',
    label: 'Vivres',
    points: food,
    max: 15,
    reason: `${plural(input.foodDays, 'jour')} d’autonomie pour le foyer`,
    todo:
      food < 15
        ? `Atteindre ${OFFICIAL_TIER} jours, de préférence sans cuisson`
        : null,
    action: { kind: 'add', category: 'food' },
  });

  const lights = computeEnergy(input.items, input.members, 1).lights;
  const light = lights >= input.members ? 10 : lights > 0 ? 5 : 0;
  criteria.push({
    id: 'light',
    label: 'Éclairage',
    points: light,
    max: 10,
    reason: `${plural(lights, 'lampe')} en état pour ${plural(
      input.members,
      'personne',
    )}`,
    todo: light < 10 ? 'Une lampe par personne' : null,
    action: addFor('light'),
  });

  const radio = has('radio') ? 10 : 0;
  criteria.push({
    id: 'radio',
    label: 'Radio',
    points: radio,
    max: 10,
    reason:
      radio > 0
        ? 'Radio à piles ou à manivelle en stock'
        : 'Aucune radio en stock',
    todo: radio > 0 ? null : 'Une radio à piles ou à manivelle',
    action: addFor('radio'),
  });

  const energy = (has('batteries') ? 5 : 0) + (has('powerbank') ? 5 : 0);
  criteria.push({
    id: 'energy',
    label: 'Énergie de secours',
    points: energy,
    max: 10,
    reason:
      [
        has('batteries') ? 'piles de rechange' : null,
        has('powerbank') ? 'batterie externe' : null,
      ]
        .filter(Boolean)
        .join(' et ')
        .replace(/^./, c => c.toUpperCase()) || 'Ni piles ni batterie externe',
    todo:
      energy < 10
        ? !has('batteries')
          ? 'Des piles de rechange'
          : 'Une batterie externe chargée'
        : null,
    action: addFor('batteries', 'powerbank'),
  });

  const health = (has('firstaid') ? 6 : 0) + (has('medicine') ? 4 : 0);
  criteria.push({
    id: 'health',
    label: 'Santé',
    points: health,
    max: 10,
    reason:
      [
        has('firstaid') ? 'trousse de secours' : null,
        has('medicine') ? 'médicaments' : null,
      ]
        .filter(Boolean)
        .join(' et ')
        .replace(/^./, c => c.toUpperCase()) ||
      'Ni trousse ni médicaments en stock',
    todo:
      health < 10
        ? !has('firstaid')
          ? 'Une trousse de secours'
          : 'Les traitements personnels et médicaments courants'
        : null,
    action: addFor('firstaid', 'medicine'),
  });

  const docs = input.documentCount > 0 ? 10 : 0;
  criteria.push({
    id: 'documents',
    label: 'Documents',
    points: docs,
    max: 10,
    reason:
      docs > 0
        ? `${plural(input.documentCount, 'document')} dans le dossier chiffré`
        : 'Aucun document photographié',
    todo: docs > 0 ? null : 'Photographier papiers d’identité et ordonnances',
    action: { kind: 'documents' },
  });

  const p = input.plan;
  const contacts = p.contacts.length > 0;
  const meeting =
    p.meetingNear.place.trim() !== '' || p.meetingFar.place.trim() !== '';
  const comms = p.comms.primary.trim() !== '';
  const plan = (contacts ? 4 : 0) + (meeting ? 3 : 0) + (comms ? 3 : 0);
  criteria.push({
    id: 'plan',
    label: 'Plan familial',
    points: plan,
    max: 10,
    reason:
      [
        contacts ? plural(p.contacts.length, 'contact') : null,
        meeting ? 'point de regroupement' : null,
        comms ? 'plan de communication' : null,
      ]
        .filter(Boolean)
        .join(', ') || 'Plan familial vide',
    todo: !contacts
      ? 'Noter les contacts d’urgence'
      : !meeting
      ? 'Choisir un point de regroupement'
      : !comms
      ? 'Définir le moyen de contact principal (PACE)'
      : null,
    action: { kind: 'familyPlan' },
  });

  const filled = input.bags.filter(b => b.itemCount > 0).length;
  const bag = filled > 0 ? 5 : input.bags.length > 0 ? 2 : 0;
  criteria.push({
    id: 'bag',
    label: 'Sac d’évacuation',
    points: bag,
    max: 5,
    reason:
      input.bags.length === 0
        ? 'Aucun sac'
        : filled > 0
        ? `${plural(filled, 'sac')} rempli${filled > 1 ? 's' : ''}`
        : 'Sac créé mais vide',
    todo: bag < 5 ? 'Préparer un sac par personne' : null,
    action: { kind: 'bags' },
  });

  const score = criteria.reduce((sum, c) => sum + c.points, 0);
  return {
    score,
    level: readinessLevel(score),
    criteria,
    next: criteria
      .filter(c => c.todo !== null)
      .sort((a, b) => b.max - b.points - (a.max - a.points)),
  };
}

/** Charge les données utiles et calcule l'indice. */
export async function getReadiness(
  db: SqlDatabase,
  input: {
    items: readonly ItemSummary[];
    documentCount: number;
    bags: readonly BagSummary[];
    asOf: string;
  },
): Promise<ReadinessReport> {
  const [household, plan, preparation, lots] = await Promise.all([
    loadHousehold(db),
    loadFamilyPlan(db),
    getPreparation(db, {
      scope: 'home',
      tier: OFFICIAL_TIER,
      items: input.items,
      documentCount: input.documentCount,
      asOf: input.asOf,
    }),
    loadConsumableLots(db),
  ]);
  const autonomy = computeResilience(lots, household, input.asOf);
  return computeReadiness({
    items: input.items,
    members: household.members,
    waterDays: autonomy.water.days,
    foodDays: autonomy.food.days,
    checks: new Map(preparation.results.map(r => [r.definition.id, r])),
    documentCount: input.documentCount,
    plan,
    bags: input.bags,
  });
}
