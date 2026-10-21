/**
 * Simulateur de crise : une crise déroulée jour par jour sur le stock réel.
 *
 * Chaque jour, le foyer consomme son besoin d'eau et de vivres (réglages du
 * foyer), lots pris par péremption croissante ; l'énergie électrique stockée
 * diminue du besoin quotidien réglé. Rien n'est deviné : une calorie ou une
 * capacité absente est signalée, pas estimée. Le stock n'est pas modifié.
 *
 * Hypothèses communes, affichées à l'écran : aucun ravitaillement pendant la
 * crise, et l'eau du robinet n'est pas comptée (la simulation mesure ce que
 * les réserves couvrent seules).
 */
import { addDays, daysBetween } from '../lib/dates';
import {
  dailyKcalNeed,
  dailyWaterNeed,
  lotCalories,
  lotWaterLiters,
  type HouseholdSettings,
  type StockLot,
} from '../resilience/resilienceCalculator';

export type CrisisId = 'blackout' | 'waterCut' | 'lockdown' | 'evacuation';

/** Où mène un événement : une fiche du guide, ou un écran de Fenrir. */
export type CrisisLink =
  | { kind: 'guide'; slug: string; label: string }
  | { kind: 'familyPlan'; label: string }
  | { kind: 'emergency'; label: string };

export interface CrisisEvent {
  /** Jour de la crise (1 = premier jour) ; ignoré si `atEnd`. */
  day: number;
  /** Dernier jour de la crise, quelle que soit sa durée. */
  atEnd?: boolean;
  text: string;
  link?: CrisisLink;
}

export interface CrisisScenario {
  id: CrisisId;
  label: string;
  hint: string;
  durations: readonly number[];
  defaultDays: number;
  /** Plus de courant : énergie stockée consommée, froid perdu. */
  noPower: boolean;
  /** Le contenu d'un sac, pour une personne, au lieu du stock général. */
  usesBag: boolean;
  hypotheses: readonly string[];
  events: readonly CrisisEvent[];
}

const guide = (slug: string, label: string): CrisisLink => ({
  kind: 'guide',
  slug,
  label,
});

/** Réfrigérateur fermé : environ 4 h (fiche « Conserver sans réfrigérateur »). */
export const FRIDGE_LAST_DAY = 0;
/** Congélateur plein et fermé : environ 48 h (24 h à moitié plein). */
export const FROZEN_LAST_DAY = 1;

export const CRISES: readonly CrisisScenario[] = [
  {
    id: 'blackout',
    label: 'Coupure de courant',
    hint: 'Plus d’électricité : froid, éclairage et recharge sur vos réserves.',
    durations: [3, 5, 7],
    defaultDays: 5,
    noPower: true,
    usesBag: false,
    hypotheses: [
      'Produits réfrigérés : consommables le premier jour seulement (réfrigérateur fermé, environ 4 heures de froid).',
      'Produits congelés : consommables les deux premiers jours (congélateur plein et fermé, environ 48 heures ; 24 heures à moitié plein).',
      'Énergie : batteries et batteries externes au besoin quotidien réglé, 80 % de leur capacité utilisable.',
    ],
    events: [
      {
        day: 1,
        text: 'Le courant est coupé. Gardez réfrigérateur et congélateur fermés ; mangez d’abord les produits frais.',
        link: guide('conservation-sans-frigo', 'Conserver sans réfrigérateur'),
      },
      {
        day: 1,
        text: 'La nuit tombe : lampes et piles plutôt que bougies, jamais de bougie sans surveillance.',
        link: guide('coupure-courant', 'Coupure d’électricité prolongée'),
      },
      {
        day: 2,
        text: 'Les antennes relais peuvent s’arrêter faute de courant : le réseau mobile devient incertain.',
        link: { kind: 'familyPlan', label: 'Revoir le plan de communication' },
      },
      {
        day: 2,
        text: 'Plus de plaques ni de four électriques : il faut préparer les repas autrement.',
        link: guide('cuisson-sans-electricite', 'Repas sans électricité'),
      },
      {
        day: 3,
        text: 'Groupe électrogène, barbecue ou réchaud : jamais à l’intérieur, même fenêtre ouverte.',
        link: guide('intoxication-co', 'Monoxyde de carbone'),
      },
      {
        day: 4,
        text: 'Écoutez la radio pour les consignes et la durée annoncée de la coupure.',
        link: guide('radio-urgence', 'Radio en situation de crise'),
      },
      {
        day: 0,
        atEnd: true,
        text: 'Au retour du courant, vérifiez les produits du congélateur avant de les consommer.',
        link: guide('apres-la-crise', 'Après la crise'),
      },
    ],
  },
  {
    id: 'waterCut',
    label: 'Coupure d’eau',
    hint: 'Plus d’eau au robinet : boire et cuisiner sur vos réserves.',
    durations: [2, 3, 5],
    defaultDays: 3,
    noPower: false,
    usesBag: false,
    hypotheses: [
      'Seule l’eau stockée potable (ou sans potabilité renseignée) est comptée pour boire.',
      'Le courant reste disponible : réfrigérateur et congélateur fonctionnent.',
    ],
    events: [
      {
        day: 1,
        text: 'Plus d’eau au robinet : l’eau stockée sert d’abord à boire et à cuisiner.',
        link: guide('coupure-eau', 'Coupure d’eau courante'),
      },
      {
        day: 1,
        text: 'Les toilettes ne se rechargent plus : prévoyez une solution de fortune.',
        link: guide('toilettes-fortune', 'Toilettes de fortune'),
      },
      {
        day: 2,
        text: 'Hygiène des mains avec très peu d’eau, surtout avant les repas.',
        link: guide('mains-sans-eau', 'Se laver les mains avec peu d’eau'),
      },
      {
        day: 0,
        atEnd: true,
        text: 'Si l’eau revient, suivez les consignes locales avant de la boire.',
        link: guide('eau-potable', 'Rendre l’eau potable'),
      },
    ],
  },
  {
    id: 'lockdown',
    label: 'Confinement',
    hint: 'Rester chez soi sans ravitaillement ; courant disponible.',
    durations: [7, 14, 21],
    defaultDays: 14,
    noPower: false,
    usesBag: false,
    hypotheses: [
      'Le courant reste disponible : réfrigérateur et congélateur fonctionnent.',
    ],
    events: [
      {
        day: 1,
        text: 'Restez à l’intérieur et suivez les consignes officielles à la radio.',
        link: guide('confinement', 'Se mettre à l’abri'),
      },
      {
        day: 2,
        text: 'Commencez par les produits frais et ce qui se périme ; gardez conserves et sec pour la suite.',
        link: guide('rationnement', 'Rationner la nourriture'),
      },
      {
        day: 3,
        text: 'Prenez des nouvelles des proches et convenez d’un horaire d’appel.',
        link: { kind: 'familyPlan', label: 'Ouvrir le plan familial' },
      },
      {
        day: 7,
        text: 'Traitements habituels : vérifiez ce qu’il reste et jusqu’à quand.',
        link: guide('medicaments-urgence', 'Médicaments en situation de crise'),
      },
      {
        day: 10,
        text: 'Les déchets s’accumulent : stockez-les fermés, à l’écart des réserves.',
        link: guide('dechets-eaux-grises', 'Déchets et eaux usées'),
      },
      {
        day: 14,
        text: 'La durée pèse sur le moral : gardez un rythme et des tâches pour chacun.',
        link: guide('gestion-stress-survie', 'Gérer le stress'),
      },
    ],
  },
  {
    id: 'evacuation',
    label: 'Évacuation',
    hint: 'Départ avec un sac : seul son contenu compte.',
    durations: [1, 2, 3],
    defaultDays: 3,
    noPower: true,
    usesBag: true,
    hypotheses: [
      'Un sac pour une personne, comme le kit 72 heures : les réglages du foyer s’appliquent à une seule personne.',
      'Seul le contenu du sac choisi est compté ; le stock de la maison reste derrière vous.',
    ],
    events: [
      {
        day: 1,
        text: 'Départ : papiers, argent, médicaments et chargeur avant de fermer la porte.',
        link: guide('papiers-importants', 'Papiers et argent'),
      },
      {
        day: 1,
        text: 'Rejoignez le point de regroupement convenu et prévenez votre contact relais.',
        link: { kind: 'familyPlan', label: 'Voir les points de regroupement' },
      },
      {
        day: 2,
        text: 'Sans réseau, plus de carte sur le téléphone : carte papier et boussole.',
        link: guide('boussole-carte', 'Boussole et carte'),
      },
      {
        day: 3,
        text: 'Restez au chaud et au sec : c’est la première priorité dehors.',
        link: guide('rester-au-chaud', 'Rester au chaud et au sec'),
      },
    ],
  },
];

export function crisisById(id: CrisisId): CrisisScenario {
  return CRISES.find(c => c.id === id) ?? CRISES[0];
}

export interface ResourceDay {
  /** Réserve au début du jour, après les pertes (péremption, froid). */
  start: number;
  /** Réserve à la fin du jour. */
  end: number;
  /** Part du besoin du jour non couverte. */
  short: number;
}

export interface CrisisDay {
  day: number;
  date: string;
  water: ResourceDay;
  food: ResourceDay;
  energy: ResourceDay | null;
  /** Ce qui se perd ce jour-là (périmé ou froid perdu). */
  lost: string[];
  events: CrisisEvent[];
}

export interface ResourceOutcome {
  dailyNeed: number;
  /** Jours entièrement couverts depuis le début. */
  coveredDays: number;
  /** Premier jour (1…) où le besoin n'est pas couvert, sinon null. */
  firstShortDay: number | null;
  /** Total manquant sur la durée (L, kcal ou Wh). */
  missing: number;
}

export interface CrisisInput {
  scenario: CrisisScenario;
  days: number;
  household: HouseholdSettings;
  lots: readonly StockLot[];
  /** Énergie utilisable connue (Wh), ou null si aucune capacité connue. */
  usableWh: number | null;
  whPerPersonDay: number;
  /** Lampes en état d'usage. */
  lights: number;
  asOf: string;
}

export interface CrisisResult {
  scenario: CrisisScenario;
  members: number;
  days: CrisisDay[];
  water: ResourceOutcome;
  food: ResourceOutcome;
  /** Null si le courant reste disponible ou si aucune capacité n'est connue. */
  energy: ResourceOutcome | null;
  /** Lampes et personnes, quand le courant manque. */
  lights: { count: number; members: number } | null;
}

interface Portion {
  name: string;
  amount: number;
  /** Dernier jour (0 = premier jour) où la portion est consommable. */
  lastDay: number;
  /** Perdue par le froid plutôt que par sa date. */
  cold: boolean;
}

function portionsOf(
  lots: readonly StockLot[],
  amountOf: (lot: StockLot) => number,
  asOf: string,
  noPower: boolean,
): Portion[] {
  const portions: Portion[] = [];
  for (const lot of lots) {
    const amount = amountOf(lot);
    if (!(amount > 0)) {
      continue;
    }
    const byDate =
      lot.expirationDate === null
        ? Infinity
        : daysBetween(asOf, lot.expirationDate);
    const byCold = !noPower
      ? Infinity
      : lot.storage === 'fridge'
      ? FRIDGE_LAST_DAY
      : lot.storage === 'frozen'
      ? FROZEN_LAST_DAY
      : Infinity;
    if (byDate < 0) {
      continue; // déjà périmé : hors réserve dès le départ.
    }
    portions.push({
      name: lot.itemName,
      amount,
      lastDay: Math.min(byDate, byCold),
      cold: byCold < byDate,
    });
  }
  return portions.sort((a, b) => a.lastDay - b.lastDay);
}

/** Déroule une ressource jour par jour ; noms perdus par jour. */
function runResource(
  portions: Portion[],
  dailyNeed: number,
  days: number,
): { daily: ResourceDay[]; lost: string[][] } {
  const daily: ResourceDay[] = [];
  const lost: string[][] = [];
  const left = portions.map(p => ({ ...p }));
  for (let d = 0; d < days; d++) {
    const lostToday: string[] = [];
    for (const p of left) {
      if (p.amount > 0 && p.lastDay < d) {
        lostToday.push(
          p.cold ? `${p.name} (froid perdu)` : `${p.name} (périmé)`,
        );
        p.amount = 0;
      }
    }
    const start = left.reduce((sum, p) => sum + p.amount, 0);
    let need = dailyNeed;
    for (const p of left) {
      if (need <= 0) {
        break;
      }
      const used = Math.min(p.amount, need);
      p.amount -= used;
      need -= used;
    }
    const end = left.reduce((sum, p) => sum + p.amount, 0);
    // Marge flottante : un reste de 1e-9 n'est pas un manque.
    daily.push({ start, end, short: need > 1e-9 ? need : 0 });
    lost.push([...new Set(lostToday)]);
  }
  return { daily, lost };
}

function outcome(daily: ResourceDay[], dailyNeed: number): ResourceOutcome {
  const first = daily.findIndex(d => d.short > 0);
  return {
    dailyNeed,
    coveredDays: first === -1 ? daily.length : first,
    firstShortDay: first === -1 ? null : first + 1,
    missing: daily.reduce((sum, d) => sum + d.short, 0),
  };
}

export function simulateCrisis(input: CrisisInput): CrisisResult {
  const { scenario, days, asOf } = input;
  // Sac d'évacuation : une personne, celle qui le porte.
  const household = scenario.usesBag
    ? { ...input.household, members: 1, children: 0, babies: 0 }
    : input.household;
  const waterNeed = dailyWaterNeed(household);
  const foodNeed = dailyKcalNeed(household);
  const water = runResource(
    portionsOf(input.lots, lotWaterLiters, asOf, scenario.noPower),
    waterNeed,
    days,
  );
  const food = runResource(
    portionsOf(input.lots, lotCalories, asOf, scenario.noPower),
    foodNeed,
    days,
  );
  const members = household.members;
  const energyNeed = members * input.whPerPersonDay;
  const energy =
    scenario.noPower && input.usableWh !== null
      ? runResource(
          [
            {
              name: 'Énergie',
              amount: input.usableWh,
              lastDay: Infinity,
              cold: false,
            },
          ],
          energyNeed,
          days,
        ).daily
      : null;
  const result: CrisisDay[] = [];
  for (let d = 0; d < days; d++) {
    result.push({
      day: d + 1,
      date: addDays(asOf, d),
      water: water.daily[d],
      food: food.daily[d],
      energy: energy === null ? null : energy[d],
      lost: [...water.lost[d], ...food.lost[d]],
      events: scenario.events.filter(e =>
        e.atEnd ? d === days - 1 : e.day === d + 1,
      ),
    });
  }
  return {
    scenario,
    members,
    days: result,
    water: outcome(water.daily, waterNeed),
    food: outcome(food.daily, foodNeed),
    energy: energy === null ? null : outcome(energy, energyNeed),
    lights: scenario.noPower ? { count: input.lights, members } : null,
  };
}
