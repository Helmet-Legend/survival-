/**
 * Nourriture des animaux (catégorie `pets`, types `food` : croquettes et
 * `wet` : pâtée) : nombre de jours couverts par le stock.
 *
 * La ration vient des animaux de Mon foyer : somme des rations de ce type
 * pour les animaux choisis (« Pour »). Sans animal enregistré, la ration
 * saisie sur la fiche (anciennes versions) sert encore. Aucune ration n'est
 * supposée : sans ration, pas de calcul.
 *
 * Ces aliments ne comptent jamais dans l'autonomie du foyer, qui ne lit que
 * les catégories Eau et Nourriture.
 */
import { eatersOf, knownPets, petRation, type Pet } from '../resilience/pets';
import type { ItemAttributes } from './attributes';
import type { ItemCategory, ItemUnit } from './types';

/** Types de nourriture pour animaux : croquettes, pâtée. */
export const PET_FOOD_SUBTYPES: readonly string[] = ['food', 'wet'];

export interface PetFoodItem {
  category: ItemCategory;
  subtype: string | null;
  unit: ItemUnit;
  attributes?: ItemAttributes;
}

export function isPetFood(item: Pick<PetFoodItem, 'category' | 'subtype'>) {
  return (
    item.category === 'pets' &&
    item.subtype !== null &&
    PET_FOOD_SUBTYPES.includes(item.subtype)
  );
}

/** Quantité en grammes, ou null si elle ne peut pas être convertie. */
export function petFoodGrams(item: PetFoodItem, quantity: number) {
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
 * Ration du jour (g) de cet aliment : animaux de Mon foyer choisis, sinon
 * ration de la fiche ; null sans ration.
 */
export function petFoodRation(
  item: PetFoodItem,
  pets: readonly Pet[] = knownPets(),
): number | null {
  if (!isPetFood(item)) {
    return null;
  }
  if (pets.length > 0) {
    const total = eatersOf(pets, item.attributes?.forPets).reduce(
      (sum, p) => sum + petRation(p, item.subtype),
      0,
    );
    return total > 0 ? total : null;
  }
  const ration = item.attributes?.dailyRation;
  return ration !== undefined && ration > 0 ? ration : null;
}

/**
 * Jours entiers de nourriture couverts par `quantity`, ou null : pas un
 * aliment pour animaux, ration inconnue, poids inconnu.
 */
export function petFoodDays(
  item: PetFoodItem,
  quantity: number,
  pets: readonly Pet[] = knownPets(),
): number | null {
  const ration = petFoodRation(item, pets);
  if (ration === null) {
    return null;
  }
  const g = petFoodGrams(item, quantity);
  return g === null ? null : Math.max(0, Math.floor(g / ration + 1e-9));
}

/** « 40 jours de nourriture », « 1 jour de nourriture ». */
export function petFoodLabel(days: number): string {
  return `${days} jour${days > 1 ? 's' : ''} de nourriture`;
}

export interface PetFoodLine {
  /** `food` : croquettes, `wet` : pâtée. */
  subtype: string;
  /** Jours couverts, ou null si aucun stock pour cet animal. */
  days: number | null;
}

export interface PetSummary {
  pet: Pet;
  /** Une ligne par type d'aliment de sa ration ; vide : ration à renseigner. */
  lines: PetFoodLine[];
}

/**
 * Pour chaque animal de Mon foyer et chaque aliment de sa ration : jours
 * couverts par les stocks qui lui sont destinés (stocks consommés l'un
 * après l'autre, d'où la somme des jours).
 */
export function petFoodSummary(
  items: ReadonlyArray<PetFoodItem & { usableQuantity: number }>,
  pets: readonly Pet[] = knownPets(),
): PetSummary[] {
  return pets.map(pet => ({
    pet,
    lines: PET_FOOD_SUBTYPES.filter(t => petRation(pet, t) > 0).map(subtype => {
      const covering = items.filter(
        i =>
          isPetFood(i) &&
          i.subtype === subtype &&
          eatersOf(pets, i.attributes?.forPets).some(p => p.id === pet.id),
      );
      const days = covering
        .map(i => petFoodDays(i, i.usableQuantity, pets))
        .filter((d): d is number => d !== null);
      return {
        subtype,
        days: days.length === 0 ? null : days.reduce((a, b) => a + b, 0),
      };
    }),
  }));
}
