/**
 * Nourriture des animaux (catégorie `pets`, type `food`) : nombre de jours
 * couverts, d'après la quantité en stock et la ration journalière que
 * l'utilisateur indique lui-même (paquet ou vétérinaire). Aucune ration
 * n'est supposée : sans ration, pas de calcul.
 *
 * Ces aliments ne comptent jamais dans l'autonomie du foyer, qui ne lit que
 * les catégories Eau et Nourriture.
 */
import type { ItemAttributes } from './attributes';
import type { ItemCategory, ItemUnit } from './types';

export const PET_FOOD_SUBTYPE = 'food';

export interface PetFoodItem {
  category: ItemCategory;
  subtype: string | null;
  unit: ItemUnit;
  attributes?: ItemAttributes;
}

/** Quantité en grammes, ou null si elle ne peut pas être convertie. */
function grams(item: PetFoodItem, quantity: number): number | null {
  if (item.unit === 'kg') {
    return quantity * 1000;
  }
  if (item.unit === 'g') {
    return quantity;
  }
  const a = item.attributes;
  if (item.unit === 'unit' && a?.unitWeight !== undefined) {
    return quantity * a.unitWeight * (a.unitWeightUnit === 'kg' ? 1000 : 1);
  }
  return null;
}

/**
 * Jours entiers de nourriture couverts par `quantity`, ou null : pas un
 * aliment pour animaux, ration non renseignée, poids inconnu.
 */
export function petFoodDays(
  item: PetFoodItem,
  quantity: number,
): number | null {
  const ration = item.attributes?.dailyRation;
  if (
    item.category !== 'pets' ||
    item.subtype !== PET_FOOD_SUBTYPE ||
    ration === undefined ||
    ration <= 0
  ) {
    return null;
  }
  const g = grams(item, quantity);
  return g === null ? null : Math.max(0, Math.floor(g / ration + 1e-9));
}

/** « 40 jours de nourriture », « 1 jour de nourriture ». */
export function petFoodLabel(days: number): string {
  return `${days} jour${days > 1 ? 's' : ''} de nourriture`;
}
