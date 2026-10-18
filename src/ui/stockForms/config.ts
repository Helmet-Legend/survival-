/**
 * Configuration des six fiches de stock (pack « fiches ») : champs,
 * options, unités et textes par catégorie. Aucune logique d'affichage ici :
 * `StockFormScreen` lit cette configuration, `mapping.ts` la traduit en
 * données.
 */
import {
  BriefcaseMedical,
  FlaskConical,
  Hash,
  Ruler,
  Thermometer,
} from 'lucide-react-native';

import type { ItemCategory, ItemUnit } from '../../inventory';
import type { CountUnit } from '../../inventory/attributes';
import { CATEGORY_COLORS, CATEGORY_ICONS } from '../format';
import {
  AlertIcon,
  AmmoIcon,
  BarcodeIcon,
  BatteryIcon,
  BoxIcon,
  CaloriesIcon,
  DateIcon,
  EnergyIcon,
  ExpiryIcon,
  LocationIcon,
  ModelIcon,
  NotesIcon,
  QuantityIcon,
  StateIcon,
  TagIcon,
  ToolIcon,
  VolumeIcon,
  WeightIcon,
  type Icon,
} from '../icons';

export type Values = Record<string, string>;

export interface Option {
  value: string;
  label: string;
}

/** Unité proposée à la saisie : unité de mesure, ou pièce nommée. */
export interface UnitOption extends Option {
  unit: ItemUnit;
  countUnit?: CountUnit;
}

interface Base {
  label: string;
  icon: Icon;
  /** Champ affiché seulement si la condition est remplie. */
  visible?: (values: Values) => boolean;
}

export type Field =
  | (Base & {
      type: 'text';
      key: string;
      placeholder?: string;
      required?: boolean;
      multiline?: boolean;
      maxLength?: number;
      /** Donnée sensible : masquée dans les listes. */
      sensitive?: boolean;
    })
  | (Base & { type: 'quantity' })
  | (Base & {
      type: 'select';
      key: string;
      options: readonly Option[];
      placeholder?: string;
      required?: boolean;
      /** Liste déroulante plutôt que pastilles. */
      dropdown?: boolean;
    })
  /** Choix de l'unité de comptage, en champ à part (fiche médicale). */
  | (Base & { type: 'packaging'; options: readonly Option[] })
  | (Base & { type: 'date'; key: string; placeholder?: string })
  | (Base & {
      type: 'measure';
      key: string;
      unitKey: string;
      units: readonly Option[];
      placeholder?: string;
    })
  | (Base & { type: 'threshold' })
  | (Base & {
      type: 'number';
      key: string;
      placeholder?: string;
      suffix?: string;
    });

export interface FormConfig {
  title: string;
  subtitle: string;
  editTitle: string;
  icon: Icon;
  color: string;
  units: readonly UnitOption[];
  fields: readonly Field[];
  /** Unité à choisir explicitement (pas de valeur par défaut). */
  requireUnit?: boolean;
  /** Quantité en nombre entier (conditionnements). */
  integerQuantity?: boolean;
  /**
   * Mise en page stricte de la fiche médicale : listes déroulantes,
   * conditionnement et nombre côte à côte, carte « Stock total », sans
   * saisie rapide ni photo.
   */
  variant?: 'medical';
  /** Icône de l'en-tête (sinon celle de la catégorie). */
  headerIcon?: Icon;
}

const u = (
  value: string,
  label: string,
  unit: ItemUnit,
  countUnit?: CountUnit,
): UnitOption => ({ value, label, unit, countUnit });

export const UNIT_OPTIONS = {
  L: u('L', 'L', 'L'),
  mL: u('mL', 'mL', 'mL'),
  kg: u('kg', 'kg', 'kg'),
  g: u('g', 'g', 'g'),
  piece: u('piece', 'pièce(s)', 'unit', 'piece'),
  package: u('package', 'paquet(s)', 'unit', 'package'),
  box: u('box', 'boîte(s)', 'unit', 'box'),
  portion: u('portion', 'portion(s)', 'unit', 'portion'),
  dose: u('dose', 'dose(s)', 'unit', 'dose'),
  bottle: u('bottle', 'flacon(s)', 'unit', 'bottle'),
  lot: u('lot', 'lot(s)', 'unit', 'lot'),
  kit: u('kit', 'kit(s)', 'unit', 'kit'),
};

const o = (value: string, label: string): Option => ({ value, label });

const CONDITION_TOOLS = [
  o('new', 'Neuf'),
  o('good', 'Bon état'),
  o('maintain', 'À entretenir'),
  o('repair', 'À réparer'),
  o('unavailable', 'Indisponible'),
];
const CONDITION_GEAR = [
  o('new', 'Neuf'),
  o('good', 'Bon état'),
  o('check', 'À contrôler'),
  o('repair', 'À réparer'),
  o('unavailable', 'Indisponible'),
];
const CONDITION_WEAPONS = [
  o('good', 'Bon état'),
  o('check', 'À contrôler'),
  o('unavailable', 'Indisponible'),
];

export const OPTION_LABELS: Record<string, Record<string, string>> = {};

function options(key: string, list: Option[]): Option[] {
  OPTION_LABELS[key] = Object.fromEntries(list.map(x => [x.value, x.label]));
  return list;
}

const name = (placeholder: string): Field => ({
  type: 'text',
  key: 'name',
  label: 'Nom / Description',
  icon: TagIcon,
  placeholder,
  required: true,
  maxLength: 120,
});
const quantity: Field = {
  type: 'quantity',
  label: 'Quantité',
  icon: QuantityIcon,
};
const location = (placeholder: string, label = 'Emplacement'): Field => ({
  type: 'text',
  key: 'location',
  label,
  icon: LocationIcon,
  placeholder,
  maxLength: 120,
  sensitive: label !== 'Emplacement',
});
const threshold: Field = {
  type: 'threshold',
  label: 'Seuil d’alerte',
  icon: AlertIcon,
};
const notes = (placeholder: string): Field => ({
  type: 'text',
  key: 'notes',
  label: 'Notes',
  icon: NotesIcon,
  placeholder,
  multiline: true,
  maxLength: 500,
});
const brandModel = (placeholder: string): Field => ({
  type: 'text',
  key: 'brandModel',
  label: 'Marque / Modèle',
  icon: ModelIcon,
  placeholder,
  maxLength: 120,
});

const isWeapon = (v: Values) => v.recordType === 'weapon';
const isAmmo = (v: Values) => v.recordType === 'ammo';
const isAccessory = (v: Values) => v.recordType === 'accessory';
const notWeapon = (v: Values) => !isWeapon(v);

export const WATER_TREATED = (v: Values) =>
  v.treatment !== undefined &&
  v.treatment !== '' &&
  v.treatment !== 'none' &&
  v.treatment !== 'unknown';

export const FORMS: Record<ItemCategory, FormConfig> = {
  water: {
    title: 'Ajouter de l’eau',
    editTitle: 'Modifier la réserve d’eau',
    subtitle: 'Enregistrez une réserve d’eau dans votre stock.',
    icon: CATEGORY_ICONS.water,
    color: CATEGORY_COLORS.water,
    units: [UNIT_OPTIONS.L, UNIT_OPTIONS.mL],
    fields: [
      name('Ex : Bidon eau potable'),
      quantity,
      {
        type: 'select',
        key: 'subtype',
        label: 'Type de contenant',
        icon: VolumeIcon,
        options: options('water.subtype', [
          o('bottle', 'Bouteille'),
          o('jerrycan', 'Jerrican / bidon'),
          o('tank', 'Cuve'),
          o('pouch', 'Poche'),
          o('filter', 'Filtre'),
          o('other', 'Autre'),
        ]),
      },
      {
        type: 'select',
        key: 'potability',
        label: 'Potabilité',
        icon: StateIcon,
        options: options('potability', [
          o('potable', 'Eau potable'),
          o('to_treat', 'À traiter'),
          o('not_potable', 'Non potable'),
          o('unknown', 'Inconnue'),
        ]),
      },
      {
        type: 'select',
        key: 'treatment',
        label: 'Traitement',
        icon: FlaskConical,
        options: options('treatment', [
          o('none', 'Aucun'),
          o('boiling', 'Ébullition'),
          o('filtration', 'Filtration'),
          o('tablets', 'Pastilles / produit'),
          o('other', 'Autre'),
          o('unknown', 'Non renseigné'),
        ]),
      },
      {
        type: 'date',
        key: 'treatedAt',
        label: 'Date de traitement',
        icon: DateIcon,
        visible: WATER_TREATED,
      },
      {
        type: 'date',
        key: 'checkedAt',
        label: 'Date de contrôle',
        icon: DateIcon,
      },
      {
        type: 'date',
        key: 'expiry',
        label: 'Date de péremption',
        icon: ExpiryIcon,
      },
      location('Ex : Cave'),
      threshold,
      notes('Ex : Eau de source, traitée au Micropur'),
    ],
  },
  food: {
    title: 'Ajouter de la nourriture',
    editTitle: 'Modifier l’aliment',
    subtitle: 'Enregistrez une réserve alimentaire dans votre stock.',
    icon: CATEGORY_ICONS.food,
    color: CATEGORY_COLORS.food,
    units: [
      UNIT_OPTIONS.piece,
      UNIT_OPTIONS.package,
      UNIT_OPTIONS.box,
      UNIT_OPTIONS.kg,
      UNIT_OPTIONS.g,
      UNIT_OPTIONS.portion,
    ],
    fields: [
      name('Ex : Pâtes, riz, conserve…'),
      quantity,
      {
        type: 'select',
        key: 'subtype',
        label: 'Type d’aliment',
        icon: BoxIcon,
        options: options('food.subtype', [
          o('canned', 'Conserve'),
          o('starch', 'Féculent'),
          o('cereal', 'Céréale'),
          o('freeze_dried', 'Lyophilisé'),
          o('legume', 'Légumineuse'),
          o('drink', 'Boisson'),
          o('other', 'Autre'),
        ]),
      },
      {
        type: 'measure',
        key: 'unitWeight',
        unitKey: 'unitWeightUnit',
        label: 'Poids unitaire',
        icon: WeightIcon,
        units: options('unitWeightUnit', [o('g', 'g'), o('kg', 'kg')]),
        placeholder: 'Ex : 500',
      },
      {
        type: 'measure',
        key: 'energyValue',
        unitKey: 'energyBasis',
        label: 'Valeur énergétique',
        icon: CaloriesIcon,
        units: options('energyBasis', [
          o('per100g', 'kcal / 100 g'),
          o('perPortion', 'kcal / portion'),
        ]),
        placeholder: 'Ex : 360',
      },
      {
        type: 'date',
        key: 'expiry',
        label: 'Date de péremption',
        icon: ExpiryIcon,
      },
      {
        type: 'select',
        key: 'storage',
        label: 'Conservation',
        icon: Thermometer,
        options: options('food.storage', [
          o('ambient', 'Température ambiante'),
          o('fresh', 'Frais'),
          o('fridge', 'Réfrigéré'),
          o('frozen', 'Congelé'),
          o('dry', 'Au sec, à l’abri de l’humidité'),
          o('other', 'Autre'),
        ]),
      },
      location('Ex : Placard cuisine'),
      threshold,
      notes('Ex : Marque, variété, préparation…'),
    ],
  },
  weapon: {
    title: 'Ajouter une arme / munition',
    editTitle: 'Modifier la fiche',
    subtitle: 'Enregistrez une arme, des munitions ou des accessoires.',
    icon: CATEGORY_ICONS.weapon,
    color: CATEGORY_COLORS.weapon,
    units: [UNIT_OPTIONS.piece, UNIT_OPTIONS.box, UNIT_OPTIONS.lot],
    fields: [
      {
        type: 'text',
        key: 'name',
        label: 'Nom / Modèle',
        icon: TagIcon,
        placeholder: 'Ex : Glock 17, AR15, 9 mm…',
        required: true,
        maxLength: 120,
      },
      {
        type: 'select',
        key: 'kind',
        label: 'Type',
        icon: BoxIcon,
        visible: isWeapon,
        options: options('weapon.kind', [
          o('handgun', 'Arme de poing'),
          o('rifle', 'Arme d’épaule (carabine)'),
          o('shotgun', 'Fusil (canon lisse)'),
          o('other', 'Autre'),
        ]),
      },
      {
        type: 'select',
        key: 'subtype',
        label: 'Type',
        icon: BoxIcon,
        visible: isAmmo,
        options: options('weapon.subtype', [
          o('bullet', 'Balles'),
          o('shot', 'Cartouches à plomb'),
          o('buckshot', 'Chevrotine / balle de fusil'),
          o('other', 'Autre'),
        ]),
      },
      {
        type: 'select',
        key: 'accessoryType',
        label: 'Type',
        icon: BoxIcon,
        visible: isAccessory,
        options: options('weapon.accessory', [
          o('optic', 'Optique'),
          o('magazine', 'Chargeur'),
          o('cleaning', 'Entretien'),
          o('case', 'Étui / rangement'),
          o('other', 'Autre'),
        ]),
      },
      brandModel('Ex : Glock, Browning…'),
      {
        type: 'text',
        key: 'caliber',
        label: 'Calibre',
        icon: AmmoIcon,
        placeholder: 'Ex : 9 mm, 12/70, .22 LR',
        maxLength: 40,
        required: true,
        visible: isWeapon,
      },
      {
        type: 'text',
        key: 'caliber',
        label: 'Calibre',
        icon: AmmoIcon,
        placeholder: 'Ex : 9 mm, 12/70, .22 LR',
        maxLength: 40,
        visible: isAmmo,
      },
      { ...quantity, visible: notWeapon },
      {
        type: 'number',
        key: 'packageSize',
        label: 'Cartouches par boîte',
        icon: Hash,
        placeholder: 'Ex : 25',
        visible: v => isAmmo(v) && v.unit === 'box',
      },
      {
        type: 'text',
        key: 'serial',
        label: 'Numéro de série',
        icon: BarcodeIcon,
        placeholder: 'Optionnel',
        maxLength: 60,
        sensitive: true,
        visible: isWeapon,
      },
      {
        type: 'select',
        key: 'condition',
        label: 'État',
        icon: StateIcon,
        options: options('weapon.condition', CONDITION_WEAPONS),
      },
      {
        type: 'date',
        key: 'checkedAt',
        label: 'Date de contrôle',
        icon: DateIcon,
      },
      location('Ex : Coffre-fort', 'Emplacement sécurisé'),
      { ...threshold, visible: notWeapon },
      notes('Ex : Accessoires, optique, chargeurs…'),
    ],
  },
  // Fiche médicale corrigée : stock compté en conditionnements (boîtes,
  // pièces, flacons, paquets), sans contenance ni dosage.
  medical: {
    title: 'Ajouter du médical',
    editTitle: 'Modifier le produit médical',
    subtitle: 'Enregistrez un médicament ou du matériel de premiers secours.',
    icon: CATEGORY_ICONS.medical,
    headerIcon: BriefcaseMedical,
    color: CATEGORY_COLORS.medical,
    units: [
      UNIT_OPTIONS.box,
      UNIT_OPTIONS.piece,
      UNIT_OPTIONS.bottle,
      UNIT_OPTIONS.package,
    ],
    requireUnit: true,
    integerQuantity: true,
    variant: 'medical',
    fields: [
      {
        type: 'text',
        key: 'name',
        label: 'Nom du produit',
        icon: TagIcon,
        placeholder: 'Ex. Compresses stériles',
        required: true,
        maxLength: 120,
      },
      {
        type: 'select',
        key: 'subtype',
        label: 'Catégorie',
        icon: BoxIcon,
        required: true,
        dropdown: true,
        options: options('medical.subtype', [
          o('dressing', 'Pansements'),
          o('medicine', 'Médicaments'),
          o('antiseptic', 'Antiseptiques'),
          o('protection', 'Protection'),
          o('diagnostic', 'Diagnostic'),
          o('hygiene', 'Hygiène'),
          o('other', 'Autre'),
        ]),
      },
      {
        type: 'packaging',
        label: 'Conditionnement',
        icon: BoxIcon,
        options: [
          o('box', 'Boîte'),
          o('piece', 'Pièce'),
          o('bottle', 'Flacon'),
          o('package', 'Paquet'),
        ],
      },
      { type: 'quantity', label: 'Nombre', icon: QuantityIcon },
      {
        type: 'date',
        key: 'expiry',
        label: 'Date de péremption',
        icon: ExpiryIcon,
        placeholder: 'Facultative — choisir une date',
      },
      location('Ex. Armoire médicale'),
    ],
  },
  tool: {
    title: 'Ajouter un outil',
    editTitle: 'Modifier l’outil',
    subtitle: 'Enregistrez un outil dans votre stock.',
    icon: CATEGORY_ICONS.tool,
    color: CATEGORY_COLORS.tool,
    units: [UNIT_OPTIONS.piece, UNIT_OPTIONS.lot, UNIT_OPTIONS.kit],
    fields: [
      name('Ex : Hache, scie, pince…'),
      {
        type: 'select',
        key: 'subtype',
        label: 'Type d’outil',
        icon: ToolIcon,
        options: options('tool.subtype', [
          o('cutting', 'Coupe'),
          o('clamping', 'Serrage'),
          o('measuring', 'Mesure'),
          o('repair', 'Réparation'),
          o('mechanical', 'Mécanique'),
          o('multitool', 'Multi-outil'),
          o('other', 'Autre'),
        ]),
      },
      quantity,
      brandModel('Ex : Fiskars'),
      {
        type: 'select',
        key: 'condition',
        label: 'État',
        icon: StateIcon,
        options: options('tool.condition', CONDITION_TOOLS),
      },
      {
        type: 'date',
        key: 'lastServiceAt',
        label: 'Dernier entretien',
        icon: DateIcon,
      },
      {
        type: 'date',
        key: 'nextServiceAt',
        label: 'Prochain entretien',
        icon: DateIcon,
      },
      location('Ex : Atelier / Véhicule'),
      threshold,
      notes('Ex : Longueur de lame, accessoires…'),
    ],
  },
  energy: {
    title: 'Ajouter du matériel',
    editTitle: 'Modifier le matériel',
    subtitle: 'Enregistrez un équipement dans votre stock.',
    icon: CATEGORY_ICONS.energy,
    color: CATEGORY_COLORS.energy,
    units: [UNIT_OPTIONS.piece, UNIT_OPTIONS.kit, UNIT_OPTIONS.lot],
    fields: [
      name('Ex : Tente, sac de couchage…'),
      {
        type: 'select',
        key: 'subtype',
        label: 'Type de matériel',
        icon: BoxIcon,
        options: options('energy.subtype', [
          o('shelter', 'Abri'),
          o('sleeping', 'Couchage'),
          o('cooking', 'Cuisson'),
          o('lighting', 'Éclairage'),
          o('communication', 'Communication'),
          o('navigation', 'Navigation'),
          o('transport', 'Transport'),
          o('protection', 'Protection'),
          o('other', 'Autre'),
        ]),
      },
      quantity,
      brandModel('Ex : Quechua, Petzl…'),
      {
        type: 'select',
        key: 'condition',
        label: 'État',
        icon: StateIcon,
        options: options('energy.condition', CONDITION_GEAR),
      },
      {
        type: 'measure',
        key: 'capacityValue',
        unitKey: 'capacityUnit',
        label: 'Autonomie / Capacité',
        icon: BatteryIcon,
        units: options('capacityUnit', [
          o('Wh', 'Wh'),
          o('mAh', 'mAh'),
          o('h', 'heures'),
          o('persons', 'personnes'),
          o('L', 'litres'),
          o('other', 'autre'),
        ]),
        placeholder: 'Ex : 10 000',
      },
      {
        type: 'date',
        key: 'lastServiceAt',
        label: 'Dernier contrôle / entretien',
        icon: DateIcon,
      },
      location('Ex : Garage'),
      threshold,
      {
        type: 'text',
        key: 'weightDims',
        label: 'Poids et dimensions',
        icon: Ruler,
        placeholder: 'Ex : 2,3 kg, 60 × 20 cm',
        maxLength: 120,
      },
      notes('Ex : Accessoires, remarques…'),
    ],
  },

  power: {
    title: 'Ajouter de l’énergie',
    editTitle: 'Modifier l’énergie',
    subtitle: 'Piles, batteries, carburant, gaz, bougies…',
    icon: CATEGORY_ICONS.power,
    color: CATEGORY_COLORS.power,
    units: [
      UNIT_OPTIONS.piece,
      UNIT_OPTIONS.lot,
      UNIT_OPTIONS.package,
      UNIT_OPTIONS.L,
      UNIT_OPTIONS.kg,
    ],
    fields: [
      name('Ex : Piles AA, bouteille de gaz…'),
      {
        type: 'select',
        key: 'subtype',
        label: 'Type d’énergie',
        icon: EnergyIcon,
        options: options('power.subtype', [
          o('battery', 'Piles / accus'),
          o('powerbank', 'Batterie externe'),
          o('fuel', 'Carburant'),
          o('gas', 'Gaz'),
          o('wood', 'Bois / charbon'),
          o('candle', 'Bougies'),
          o('solar', 'Solaire'),
          o('generator', 'Groupe électrogène'),
          o('other', 'Autre'),
        ]),
      },
      quantity,
      {
        type: 'date',
        key: 'expiry',
        label: 'Date de péremption',
        icon: ExpiryIcon,
        placeholder: 'Facultative — choisir une date',
      },
      {
        type: 'measure',
        key: 'capacityValue',
        unitKey: 'capacityUnit',
        label: 'Capacité',
        icon: BatteryIcon,
        units: options('power.capacityUnit', [
          o('mAh', 'mAh'),
          o('Wh', 'Wh'),
          o('L', 'litres'),
          o('kg', 'kg'),
          o('h', 'heures'),
          o('other', 'autre'),
        ]),
        placeholder: 'Ex : 20 000',
      },
      brandModel('Ex : Varta, Campingaz…'),
      {
        type: 'select',
        key: 'condition',
        label: 'État',
        icon: StateIcon,
        options: options('power.condition', CONDITION_GEAR),
      },
      location('Ex : Garage, abri de jardin'),
      threshold,
      notes('Ex : Format, appareil concerné…'),
    ],
  },
};

/** Libellés des anciens types (avant le pack), toujours lisibles. */
const LEGACY_SUBTYPES: Record<string, string> = {
  bottled: 'Bouteille',
  tap: 'Eau du robinet stockée',
  dry: 'Épicerie sèche',
  fresh: 'Frais',
  first_aid: 'Pansement / soin',
  equipment: 'Matériel',
  energy: 'Énergie',
  battery: 'Piles / batteries',
  fuel: 'Carburant',
  gas: 'Gaz',
};

export function optionLabel(
  group: string,
  value: string | null | undefined,
): string | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  return OPTION_LABELS[group]?.[value] ?? LEGACY_SUBTYPES[value] ?? null;
}

/** Unité de saisie correspondant à un article existant. */
export function unitOptionFor(
  category: ItemCategory,
  unit: ItemUnit,
  countUnit: CountUnit | undefined,
): string {
  if (unit !== 'unit') {
    return unit;
  }
  const value = countUnit ?? 'piece';
  if (FORMS[category].units.some(x => x.value === value)) {
    return value;
  }
  // Unité qui n'est plus proposée (ex. « dose ») : à choisir à nouveau
  // plutôt que remplacée en silence.
  return FORMS[category].requireUnit ? '' : FORMS[category].units[0].value;
}

/** Identifiant d'un champ (sa clé, ou son type pour quantité et seuil). */
export function fieldId(field: Field): string {
  return field.type === 'quantity' ||
    field.type === 'threshold' ||
    field.type === 'packaging'
    ? field.type
    : field.key;
}

/**
 * Champs montrés d'emblée ; les autres restent sous « Plus de détails »
 * (tous facultatifs) pour qu'une saisie rapide tienne sur un écran.
 */
export const ESSENTIAL: Record<ItemCategory, readonly string[]> = {
  water: ['name', 'quantity', 'potability', 'expiry'],
  food: ['name', 'quantity', 'expiry', 'energyValue'],
  // Arme : nom, type, calibre, n° de série ; munitions : nom, calibre,
  // quantité, contenance des boîtes ; accessoire : nom, type, quantité.
  weapon: [
    'name',
    'kind',
    'accessoryType',
    'caliber',
    'quantity',
    'packageSize',
    'serial',
  ],
  medical: ['name', 'subtype', 'packaging', 'quantity', 'expiry', 'location'],
  tool: ['name', 'quantity', 'condition'],
  energy: ['name', 'quantity', 'condition'],
  power: ['name', 'subtype', 'quantity', 'expiry'],
};

/** Saisie rapide : un appui remplit le nom, le type et l'unité usuels. */
export interface QuickPick {
  label: string;
  values: Values;
}

const pick = (label: string, values: Values): QuickPick => ({
  label,
  values: { name: label, ...values },
});

export const QUICK_PICKS: Record<ItemCategory, readonly QuickPick[]> = {
  water: [
    pick('Bouteilles d’eau', { subtype: 'bottle', unit: 'L' }),
    pick('Jerrican', { subtype: 'jerrycan', unit: 'L' }),
    pick('Cuve', { subtype: 'tank', unit: 'L' }),
    pick('Poche à eau', { subtype: 'pouch', unit: 'L' }),
  ],
  food: [
    pick('Riz', { subtype: 'starch', unit: 'kg' }),
    pick('Pâtes', { subtype: 'starch', unit: 'kg' }),
    pick('Conserves', { subtype: 'canned', unit: 'box' }),
    pick('Lentilles', { subtype: 'legume', unit: 'kg' }),
    pick('Farine', { subtype: 'cereal', unit: 'kg' }),
    pick('Ration lyophilisée', { subtype: 'freeze_dried', unit: 'portion' }),
  ],
  weapon: [],
  // Fiche médicale stricte : pas de saisie rapide.
  medical: [],
  tool: [
    pick('Couteau', { subtype: 'cutting', unit: 'piece' }),
    pick('Hache', { subtype: 'cutting', unit: 'piece' }),
    pick('Scie', { subtype: 'cutting', unit: 'piece' }),
    pick('Multi-outil', { subtype: 'multitool', unit: 'piece' }),
    pick('Pince', { subtype: 'clamping', unit: 'piece' }),
  ],
  energy: [
    pick('Lampe frontale', { subtype: 'lighting', unit: 'piece' }),
    pick('Réchaud', { subtype: 'cooking', unit: 'piece' }),
    pick('Tente', { subtype: 'shelter', unit: 'piece' }),
    pick('Sac de couchage', { subtype: 'sleeping', unit: 'piece' }),
    pick('Radio', { subtype: 'communication', unit: 'piece' }),
  ],
  power: [
    pick('Piles AA', { subtype: 'battery', unit: 'lot' }),
    pick('Batterie externe', { subtype: 'powerbank', unit: 'piece' }),
    pick('Bouteille de gaz', { subtype: 'gas', unit: 'piece' }),
    pick('Jerrican d’essence', { subtype: 'fuel', unit: 'L' }),
    pick('Bougies', { subtype: 'candle', unit: 'package' }),
  ],
};

/** Calibres courants proposés sous le champ « Calibre ». */
export const COMMON_CALIBERS = [
  '9 mm',
  '12/70',
  '.22 LR',
  '.223 Rem',
  '.308 Win',
  '7,62×39',
] as const;
