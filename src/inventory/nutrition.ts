/**
 * Calories d'un article de nourriture, calculées uniquement à partir de
 * données saisies : kcal par unité de l'étiquette, ou valeur énergétique
 * (kcal/100 g avec un poids connu, kcal/portion pour des portions).
 * Sinon `null` : les données sont incomplètes, rien n'est deviné.
 */
import type { ItemUnit } from './types';
import type { ItemAttributes } from './attributes';

export function caloriesPerUnit(
  unit: ItemUnit,
  stored: number | null,
  attrs: ItemAttributes,
): number | null {
  if (stored !== null) {
    return stored;
  }
  const { energyValue, energyBasis } = attrs;
  if (energyValue === undefined || energyBasis === undefined) {
    return null;
  }
  if (energyBasis === 'per100g') {
    if (unit === 'kg') {
      return energyValue * 10;
    }
    if (unit === 'g') {
      return energyValue / 100;
    }
    if (
      unit === 'unit' &&
      attrs.unitWeight !== undefined &&
      attrs.unitWeightUnit !== undefined
    ) {
      const grams =
        attrs.unitWeightUnit === 'kg'
          ? attrs.unitWeight * 1000
          : attrs.unitWeight;
      return (grams * energyValue) / 100;
    }
    return null;
  }
  // kcal par portion : seulement pour un stock compté en portions.
  return unit === 'unit' && attrs.countUnit === 'portion' ? energyValue : null;
}
