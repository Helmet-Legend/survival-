/**
 * Configuration des six fiches de stock (pack « fiches ») : champs,
 * options, unités et textes par catégorie. Aucune logique d'affichage ici :
 * `StockFormScreen` lit cette configuration, `mapping.ts` la traduit en
 * données.
 */
import {
  Activity,
  Barcode,
  CalendarDays,
  Container,
  FlaskConical,
  Flame,
  Gauge,
  Hash,
  MapPin,
  Package,
  Ruler,
  Scale,
  ShieldCheck,
  StickyNote,
  Tag,
  Thermometer,
  TriangleAlert,
  Wrench,
  type LucideIcon,
} from 'lucide-react-native';

import type { ItemCategory, ItemUnit } from '../../inventory';
import type { CountUnit } from '../../inventory/attributes';
import { CATEGORY_COLORS, CATEGORY_ICONS } from '../format';

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
  icon: LucideIcon;
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
    })
  | (Base & { type: 'date'; key: string })
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
  icon: LucideIcon;
  color: string;
  units: readonly UnitOption[];
  fields: readonly Field[];
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
  icon: Tag,
  placeholder,
  required: true,
  maxLength: 120,
});
const quantity: Field = { type: 'quantity', label: 'Quantité', icon: Package };
const location = (placeholder: string, label = 'Emplacement'): Field => ({
  type: 'text',
  key: 'location',
  label,
  icon: MapPin,
  placeholder,
  maxLength: 120,
  sensitive: label !== 'Emplacement',
});
const threshold: Field = {
  type: 'threshold',
  label: 'Seuil d’alerte',
  icon: TriangleAlert,
};
const notes = (placeholder: string): Field => ({
  type: 'text',
  key: 'notes',
  label: 'Notes',
  icon: StickyNote,
  placeholder,
  multiline: true,
  maxLength: 500,
});
const brandModel = (placeholder: string): Field => ({
  type: 'text',
  key: 'brandModel',
  label: 'Marque / Modèle',
  icon: Tag,
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
        icon: Container,
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
        icon: ShieldCheck,
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
        icon: CalendarDays,
        visible: WATER_TREATED,
      },
      {
        type: 'date',
        key: 'checkedAt',
        label: 'Date de contrôle',
        icon: CalendarDays,
      },
      {
        type: 'date',
        key: 'expiry',
        label: 'Date de péremption',
        icon: CalendarDays,
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
        icon: Package,
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
        icon: Scale,
        units: options('unitWeightUnit', [o('g', 'g'), o('kg', 'kg')]),
        placeholder: 'Ex : 500',
      },
      {
        type: 'measure',
        key: 'energyValue',
        unitKey: 'energyBasis',
        label: 'Valeur énergétique',
        icon: Flame,
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
        icon: CalendarDays,
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
        icon: Tag,
        placeholder: 'Ex : Glock 17, AR15, 9 mm…',
        required: true,
        maxLength: 120,
      },
      {
        type: 'select',
        key: 'kind',
        label: 'Type',
        icon: Package,
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
        icon: Package,
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
        icon: Package,
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
        icon: Gauge,
        placeholder: 'Ex : 9 mm, 12/70, .22 LR',
        maxLength: 40,
        required: true,
        visible: isWeapon,
      },
      {
        type: 'text',
        key: 'caliber',
        label: 'Calibre',
        icon: Gauge,
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
        icon: Barcode,
        placeholder: 'Optionnel',
        maxLength: 60,
        sensitive: true,
        visible: isWeapon,
      },
      {
        type: 'select',
        key: 'condition',
        label: 'État',
        icon: ShieldCheck,
        options: options('weapon.condition', CONDITION_WEAPONS),
      },
      {
        type: 'date',
        key: 'checkedAt',
        label: 'Date de contrôle',
        icon: CalendarDays,
      },
      location('Ex : Coffre-fort', 'Emplacement sécurisé'),
      { ...threshold, visible: notWeapon },
      notes('Ex : Accessoires, optique, chargeurs…'),
    ],
  },
  medical: {
    title: 'Ajouter un produit médical',
    editTitle: 'Modifier le produit médical',
    subtitle: 'Enregistrez un médicament ou du matériel de premiers secours.',
    icon: CATEGORY_ICONS.medical,
    color: CATEGORY_COLORS.medical,
    units: [
      UNIT_OPTIONS.box,
      UNIT_OPTIONS.piece,
      UNIT_OPTIONS.dose,
      UNIT_OPTIONS.bottle,
      UNIT_OPTIONS.package,
    ],
    fields: [
      name('Ex : Paracétamol, compresses…'),
      {
        type: 'select',
        key: 'subtype',
        label: 'Type',
        icon: Package,
        options: options('medical.subtype', [
          o('medicine', 'Médicament'),
          o('dressing', 'Pansement'),
          o('antiseptic', 'Antiseptique'),
          o('diagnostic', 'Diagnostic'),
          o('protection', 'Protection'),
          o('hygiene', 'Hygiène'),
          o('other', 'Autre'),
        ]),
      },
      quantity,
      {
        type: 'text',
        key: 'dosage',
        label: 'Dosage / Contenance',
        icon: FlaskConical,
        placeholder: 'Ex : 500 mg (16 comprimés)',
        maxLength: 120,
      },
      {
        type: 'date',
        key: 'expiry',
        label: 'Date de péremption',
        icon: CalendarDays,
      },
      {
        type: 'number',
        key: 'alertDays',
        label: 'Prévenir avant péremption',
        icon: TriangleAlert,
        placeholder: '30 / 60 / 90',
        suffix: 'jours',
      },
      {
        type: 'text',
        key: 'lotNumber',
        label: 'Lot',
        icon: Hash,
        placeholder: 'Ex : n° de lot',
        maxLength: 60,
      },
      {
        type: 'select',
        key: 'storage',
        label: 'Conditions de conservation',
        icon: Thermometer,
        options: options('medical.storage', [
          o('ambient', 'Température ambiante'),
          o('fridge', 'Réfrigérée'),
          o('light_protected', 'Protégée de la lumière'),
          o('other', 'Autre'),
        ]),
      },
      location('Ex : Trousse principale'),
      threshold,
      notes('Ex : Indications, remarques…'),
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
        icon: Wrench,
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
        icon: ShieldCheck,
        options: options('tool.condition', CONDITION_TOOLS),
      },
      {
        type: 'date',
        key: 'lastServiceAt',
        label: 'Dernier entretien',
        icon: CalendarDays,
      },
      {
        type: 'date',
        key: 'nextServiceAt',
        label: 'Prochain entretien',
        icon: CalendarDays,
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
        icon: Package,
        options: options('energy.subtype', [
          o('shelter', 'Abri'),
          o('sleeping', 'Couchage'),
          o('cooking', 'Cuisson'),
          o('lighting', 'Éclairage'),
          o('energy', 'Énergie'),
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
        icon: ShieldCheck,
        options: options('energy.condition', CONDITION_GEAR),
      },
      {
        type: 'measure',
        key: 'capacityValue',
        unitKey: 'capacityUnit',
        label: 'Autonomie / Capacité',
        icon: Activity,
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
        icon: CalendarDays,
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
};

/** Libellés des anciens types (avant le pack), toujours lisibles. */
const LEGACY_SUBTYPES: Record<string, string> = {
  bottled: 'Bouteille',
  tap: 'Eau du robinet stockée',
  dry: 'Épicerie sèche',
  fresh: 'Frais',
  first_aid: 'Pansement / soin',
  equipment: 'Matériel',
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
  return FORMS[category].units.some(x => x.value === value)
    ? value
    : FORMS[category].units[0].value;
}
