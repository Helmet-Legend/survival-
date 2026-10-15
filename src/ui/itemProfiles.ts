/**
 * Saisie propre à chaque catégorie : une fiche de munitions ne se remplit
 * pas comme une fiche d'eau. Unités proposées, contenant (bidon, boîte),
 * calories, calibre et libellés.
 */
import type { InventoryItem, ItemCategory, ItemUnit } from '../inventory';
import { formatNumber, UNIT_LABELS } from './format';

export interface Container {
  one: string;
  many: string;
}

export interface Subtype {
  id: string;
  label: string;
  /** Conseil affiché sous le choix. */
  hint?: string;
  /** Durée de conservation conseillée (jours), pour proposer une date. */
  renewDays?: number;
}

export interface CategoryProfile {
  /** Titre du formulaire d'ajout. */
  formTitle: string;
  namePlaceholder: string;
  subtypes: readonly Subtype[];
  /** Libellé de la date, ou null si elle n'a pas de sens (munitions). */
  expiryLabel: string | null;
  notesLabel: string;
  notesPlaceholder: string;
  locationPlaceholder: string;
  /** Unités proposées ; la première est celle par défaut. */
  units: readonly ItemUnit[];
  /** Contenant habituel (saisie « contenance × nombre »). */
  container: Container | null;
  /** Nom d'une pièce quand l'unité est `unit` (ex. cartouche). */
  piece: Container | null;
  calories: boolean;
  caliber: boolean;
}

export const PROFILES: Record<ItemCategory, CategoryProfile> = {
  water: {
    formTitle: 'Nouvelle réserve d’eau',
    namePlaceholder: 'Ex. Bidons garage',
    subtypes: [
      {
        id: 'bottled',
        label: 'Eau en bouteille',
        hint: 'Date indiquée sur l’étiquette (DDM).',
      },
      {
        id: 'tap',
        label: 'Eau du robinet stockée',
        hint: 'À renouveler tous les 6 mois, au frais et à l’abri de la lumière.',
        renewDays: 182,
      },
      { id: 'other', label: 'Autre (citerne, récupération…)' },
    ],
    expiryLabel: 'À renouveler avant le (AAAA-MM-JJ, facultatif)',
    notesLabel: 'Notes (facultatif)',
    notesPlaceholder: 'Traitement, origine…',
    locationPlaceholder: 'Ex. Garage, cave',
    units: ['L', 'mL'],
    container: { one: 'bidon', many: 'bidons' },
    piece: null,
    calories: false,
    caliber: false,
  },
  food: {
    formTitle: 'Nouvel aliment',
    namePlaceholder: 'Ex. Riz basmati, cassoulet',
    subtypes: [
      { id: 'dry', label: 'Épicerie sèche' },
      { id: 'canned', label: 'Conserve' },
      { id: 'freeze_dried', label: 'Lyophilisé / ration' },
      { id: 'fresh', label: 'Frais' },
      { id: 'other', label: 'Autre' },
    ],
    expiryLabel: 'À consommer avant le (AAAA-MM-JJ, facultatif)',
    notesLabel: 'Notes (facultatif)',
    notesPlaceholder: 'Allergènes, préparation…',
    locationPlaceholder: 'Ex. Placard cuisine, cellier',
    units: ['kg', 'g', 'unit'],
    container: null,
    piece: null,
    calories: true,
    caliber: false,
  },
  medical: {
    formTitle: 'Nouveau produit de santé',
    namePlaceholder: 'Ex. Paracétamol 500 mg',
    subtypes: [
      { id: 'medicine', label: 'Médicament' },
      { id: 'first_aid', label: 'Pansement / soin' },
      { id: 'hygiene', label: 'Hygiène / désinfection' },
      { id: 'equipment', label: 'Matériel' },
      { id: 'other', label: 'Autre' },
    ],
    expiryLabel: 'Date de péremption (AAAA-MM-JJ, facultatif)',
    notesLabel: 'Posologie, indication (facultatif)',
    notesPlaceholder: 'Ex. 1 comprimé toutes les 6 h, fièvre et douleur',
    locationPlaceholder: 'Ex. Trousse de secours, salle de bain',
    units: ['unit'],
    container: null,
    piece: null,
    calories: false,
    caliber: false,
  },
  energy: {
    formTitle: 'Nouvel article d’énergie',
    namePlaceholder: 'Ex. Piles AA, gazole',
    subtypes: [
      { id: 'battery', label: 'Piles / batteries' },
      { id: 'fuel', label: 'Carburant' },
      { id: 'gas', label: 'Gaz' },
      { id: 'lighting', label: 'Bougies / éclairage' },
      { id: 'other', label: 'Autre' },
    ],
    expiryLabel: 'À utiliser avant le (AAAA-MM-JJ, facultatif)',
    notesLabel: 'Notes (facultatif)',
    notesPlaceholder: 'Format, appareil concerné…',
    locationPlaceholder: 'Ex. Tiroir entrée, abri de jardin',
    units: ['unit', 'L'],
    container: null,
    piece: null,
    calories: false,
    caliber: false,
  },
  tool: {
    formTitle: 'Nouvel outil',
    namePlaceholder: 'Ex. Lampe frontale',
    subtypes: [],
    expiryLabel: null,
    notesLabel: 'Notes (facultatif)',
    notesPlaceholder: 'Entretien, accessoires…',
    locationPlaceholder: 'Ex. Atelier, sac d’évacuation',
    units: ['unit'],
    container: null,
    piece: null,
    calories: false,
    caliber: false,
  },
  weapon: {
    formTitle: 'Nouvelles munitions',
    namePlaceholder: 'Ex. Plomb n° 7 Sellier & Bellot',
    subtypes: [
      { id: 'bullet', label: 'Balles (carabine, poing)' },
      { id: 'shot', label: 'Cartouches à plomb' },
      { id: 'buckshot', label: 'Chevrotine / balle de fusil' },
      { id: 'other', label: 'Autre' },
    ],
    expiryLabel: null,
    notesLabel: 'Charge, marque (facultatif)',
    notesPlaceholder: 'Ex. 36 g, culot de 16 mm',
    locationPlaceholder: 'Ex. Coffre-fort',
    units: ['unit'],
    container: { one: 'boîte', many: 'boîtes' },
    piece: { one: 'cartouche', many: 'cartouches' },
    calories: false,
    caliber: true,
  },
};

function plural(count: number, noun: Container): string {
  return count > 1 ? noun.many : noun.one;
}

/** Unité affichée : « cartouches » plutôt que « pièce(s) » pour les munitions. */
export function unitLabel(
  category: ItemCategory,
  unit: ItemUnit,
  count = 2,
): string {
  const piece = PROFILES[category].piece;
  return unit === 'unit' && piece !== null
    ? plural(count, piece)
    : UNIT_LABELS[unit];
}

/** « 3 bidons de 10 L », ou null sans contenance connue. */
export function packageSummary(
  item: Pick<InventoryItem, 'category' | 'unit' | 'packageSize'>,
  quantity: number,
): string | null {
  const container = PROFILES[item.category].container;
  if (item.packageSize === null || container === null) {
    return null;
  }
  const count = quantity / item.packageSize;
  return `${formatNumber(count)} ${plural(count, container)} de ${formatNumber(
    item.packageSize,
  )} ${unitLabel(item.category, item.unit, item.packageSize)}`;
}

/** Libellé du type d'un article, ou null. */
export function subtypeLabel(
  category: ItemCategory,
  subtype: string | null,
): string | null {
  if (subtype === null) {
    return null;
  }
  return PROFILES[category].subtypes.find(t => t.id === subtype)?.label ?? null;
}
