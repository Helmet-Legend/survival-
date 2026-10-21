/**
 * Scénarios de consommation : mêmes stocks, besoins différents. Les
 * coefficients reprennent les fiches du guide (chaleur ou effort : l'eau
 * peut aller jusqu'au double ; effort physique : 2 500 à 3 500 kcal).
 */
import type { HouseholdSettings } from './resilienceCalculator';

export interface Scenario {
  id: string;
  label: string;
  hint: string;
  apply(household: HouseholdSettings): HouseholdSettings;
  /** Multiplie le besoin d'énergie électrique. */
  energyFactor?: number;
}

export const SCENARIOS: readonly Scenario[] = [
  {
    id: 'normal',
    label: 'Normal',
    hint: 'Vos réglages actuels.',
    apply: h => h,
  },
  {
    id: 'heat',
    label: 'Canicule',
    hint: 'Eau +50 % (chaleur : jusqu’au double selon l’effort).',
    apply: h => ({
      ...h,
      waterLitersPerPersonDay: h.waterLitersPerPersonDay * 1.5,
      waterFactor: (h.waterFactor ?? 1) * 1.5,
    }),
  },
  {
    id: 'effort',
    label: 'Effort physique',
    hint: 'Adultes : eau +50 % et 2 500 kcal (bas de la fourchette).',
    apply: h => ({
      ...h,
      waterLitersPerPersonDay: h.waterLitersPerPersonDay * 1.5,
      kcalPerPersonDay: Math.max(h.kcalPerPersonDay, 2500),
    }),
  },
  {
    id: 'guests',
    label: '+2 personnes',
    hint: 'Accueil de proches : deux personnes de plus.',
    apply: h => ({ ...h, members: h.members + 2 }),
  },
  {
    id: 'blackout',
    label: 'Coupure de courant',
    hint: 'Énergie doublée : téléphone, lampe et radio sur batteries.',
    apply: h => h,
    energyFactor: 2,
  },
];
