/**
 * Lignes « libellé : valeur » d'un article ou d'une arme, d'après les
 * champs de sa fiche. Seules les données renseignées apparaissent.
 */
import {
  caloriesPerUnit,
  type InventoryItem,
  type Weapon,
} from '../../inventory';
import { isoToFr } from '../../lib/dates';
import { formatNumber, UNIT_LABELS, WEAPON_KIND_LABELS } from '../format';
import { optionLabel } from './config';

type Fact = [string, string];

const date = (iso?: string) => (iso ? isoToFr(iso) : undefined);

function push(facts: Fact[], label: string, value: string | null | undefined) {
  if (value) {
    facts.push([label, value]);
  }
}

export const COUNT_UNIT_LABELS: Record<string, [string, string]> = {
  piece: ['pièce', 'pièces'],
  package: ['paquet', 'paquets'],
  box: ['boîte', 'boîtes'],
  portion: ['portion', 'portions'],
  dose: ['dose', 'doses'],
  bottle: ['flacon', 'flacons'],
  lot: ['lot', 'lots'],
  kit: ['kit', 'kits'],
};

/** Unité affichée d'un article (« L », « boîtes », « cartouches »…). */
export function itemUnitLabel(
  item: Pick<InventoryItem, 'category' | 'unit' | 'attributes'>,
  count = 2,
): string {
  if (item.unit !== 'unit') {
    return UNIT_LABELS[item.unit];
  }
  const countUnit = item.attributes.countUnit ?? 'piece';
  if (
    item.category === 'weapon' &&
    countUnit === 'piece' &&
    item.attributes.recordType !== 'accessory'
  ) {
    return count > 1 ? 'cartouches' : 'cartouche';
  }
  const [one, many] = COUNT_UNIT_LABELS[countUnit] ?? ['pièce', 'pièces'];
  return count > 1 ? many : one;
}

/** Type affiché d'un article (« Conserve », « Jerrican / bidon »…). */
export function itemTypeLabel(item: InventoryItem): string | null {
  if (item.category === 'weapon') {
    const accessory = item.attributes.recordType === 'accessory';
    const kind = optionLabel(
      accessory ? 'weapon.accessory' : 'weapon.subtype',
      item.subtype,
    );
    return [accessory ? 'Accessoire' : 'Munition', kind]
      .filter(Boolean)
      .join(' · ');
  }
  return optionLabel(`${item.category}.subtype`, item.subtype);
}

export function itemFacts(item: InventoryItem): Fact[] {
  const a = item.attributes;
  const facts: Fact[] = [];
  push(facts, 'Type', itemTypeLabel(item));
  push(facts, 'Marque / modèle', a.brandModel);
  push(facts, 'Calibre', item.caliber);
  push(facts, 'Potabilité', optionLabel('potability', a.potability));
  push(facts, 'Traitement', optionLabel('treatment', a.treatment));
  push(facts, 'Date de traitement', date(a.treatedAt));
  push(facts, 'Dosage / contenance', a.dosage);
  push(facts, 'Lot', a.lotNumber);
  if (a.unitWeight !== undefined && a.unitWeightUnit !== undefined) {
    push(
      facts,
      'Poids unitaire',
      `${formatNumber(a.unitWeight)} ${a.unitWeightUnit}`,
    );
  }
  if (item.category === 'food') {
    if (a.energyValue !== undefined && a.energyBasis !== undefined) {
      push(
        facts,
        'Valeur énergétique',
        `${formatNumber(a.energyValue, 0)} kcal / ${
          a.energyBasis === 'per100g' ? '100 g' : 'portion'
        }`,
      );
    }
    const kcal = caloriesPerUnit(item.unit, item.caloriesPerUnit, a);
    push(
      facts,
      'Calories',
      kcal === null
        ? 'Données incomplètes : non comptées dans l’autonomie'
        : `${formatNumber(kcal, kcal < 10 ? 2 : 0)} kcal par ${itemUnitLabel(
            item,
            1,
          )}`,
    );
  }
  push(
    facts,
    'Conservation',
    optionLabel(`${item.category}.storage`, a.storage),
  );
  push(facts, 'État', optionLabel(`${item.category}.condition`, a.condition));
  if (a.capacityValue !== undefined && a.capacityUnit !== undefined) {
    push(
      facts,
      'Autonomie / capacité',
      `${formatNumber(a.capacityValue)} ${
        optionLabel(`${item.category}.capacityUnit`, a.capacityUnit) ??
        optionLabel('capacityUnit', a.capacityUnit) ??
        ''
      }`,
    );
  }
  push(facts, 'Date de contrôle', date(a.checkedAt));
  push(facts, 'Dernier entretien', date(a.lastServiceAt));
  push(facts, 'Prochain entretien', date(a.nextServiceAt));
  push(facts, 'Poids et dimensions', a.weightDims);
  push(
    facts,
    item.category === 'weapon' ? 'Emplacement sécurisé' : 'Emplacement',
    item.location,
  );
  push(facts, 'Notes', item.notes);
  return facts;
}

export function weaponFacts(weapon: Weapon): Fact[] {
  const a = weapon.attributes;
  const facts: Fact[] = [];
  push(facts, 'Type', WEAPON_KIND_LABELS[weapon.kind]);
  push(facts, 'Marque / modèle', a.brandModel);
  push(facts, 'Calibre', weapon.caliber);
  push(facts, 'État', optionLabel('weapon.condition', a.condition));
  push(facts, 'Date de contrôle', date(a.checkedAt));
  push(facts, 'Notes', weapon.notes);
  return facts;
}
