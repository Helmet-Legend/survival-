/**
 * Traduction entre les valeurs saisies d'une fiche et les données
 * (articles, armes). Les champs vides restent absents : rien n'est
 * fabriqué. Les dates sont saisies en JJ/MM/AAAA et stockées en ISO.
 */
import type {
  InventoryItem,
  ItemCategory,
  ItemInput,
  LotInput,
  Weapon,
  WeaponInput,
  WeaponKind,
} from '../../inventory';
import type { ItemAttributes } from '../../inventory/attributes';
import { frToIso, isoToFr } from '../../lib/dates';
import { parseDecimal } from '../format';
import { FORMS, unitOptionFor, WATER_TREATED, type Values } from './config';

/** Erreur de saisie rattachée à un champ de la fiche. */
export class FormError extends Error {
  constructor(readonly field: string, message: string) {
    super(message);
    this.name = 'FormError';
  }
}

const DATE_KEYS = [
  'expiry',
  'treatedAt',
  'checkedAt',
  'lastServiceAt',
  'nextServiceAt',
] as const;

function text(values: Values, key: string): string | undefined {
  const value = values[key]?.trim();
  return value ? value : undefined;
}

function number(values: Values, key: string): number | undefined {
  const raw = text(values, key);
  if (raw === undefined) {
    return undefined;
  }
  const n = parseDecimal(raw);
  if (!Number.isFinite(n) || n <= 0) {
    throw new FormError(key, 'Nombre positif attendu');
  }
  return n;
}

function date(values: Values, key: string): string | undefined {
  const raw = text(values, key);
  if (raw === undefined) {
    return undefined;
  }
  const iso = frToIso(raw);
  if (iso === null) {
    throw new FormError(key, 'Date invalide (JJ/MM/AAAA)');
  }
  return iso;
}

/** Vérifie les dates et champs numériques avant tout enregistrement. */
function checkCommon(values: Values): void {
  DATE_KEYS.forEach(key => date(values, key));
  if (!text(values, 'name')) {
    throw new FormError('name', 'Champ obligatoire');
  }
}

export interface ItemDraft {
  input: ItemInput;
  /** Premier lot (création seulement). */
  lot: LotInput | null;
}

export function toItemDraft(
  category: ItemCategory,
  values: Values,
  isEdit: boolean,
): ItemDraft {
  checkCommon(values);
  const config = FORMS[category];
  const unitOption =
    config.units.find(x => x.value === values.unit) ?? config.units[0];
  const recordType =
    category === 'weapon'
      ? values.recordType === 'accessory'
        ? 'accessory'
        : 'ammo'
      : undefined;
  const attributes: ItemAttributes = {
    countUnit: unitOption.countUnit,
    recordType,
    potability: text(values, 'potability') as ItemAttributes['potability'],
    treatment: text(values, 'treatment') as ItemAttributes['treatment'],
    treatedAt: WATER_TREATED(values) ? date(values, 'treatedAt') : undefined,
    checkedAt: date(values, 'checkedAt'),
    unitWeight: number(values, 'unitWeight'),
    unitWeightUnit:
      text(values, 'unitWeight') !== undefined
        ? ((text(values, 'unitWeightUnit') ?? 'g') as 'g' | 'kg')
        : undefined,
    energyValue: number(values, 'energyValue'),
    energyBasis:
      text(values, 'energyValue') !== undefined
        ? ((text(values, 'energyBasis') ?? 'per100g') as
            | 'per100g'
            | 'perPortion')
        : undefined,
    storage: text(values, 'storage') as ItemAttributes['storage'],
    dosage: text(values, 'dosage'),
    lotNumber: text(values, 'lotNumber'),
    brandModel: text(values, 'brandModel'),
    condition: text(values, 'condition') as ItemAttributes['condition'],
    lastServiceAt: date(values, 'lastServiceAt'),
    nextServiceAt: date(values, 'nextServiceAt'),
    capacityValue: number(values, 'capacityValue'),
    capacityUnit:
      text(values, 'capacityValue') !== undefined
        ? ((text(values, 'capacityUnit') ??
            'other') as ItemAttributes['capacityUnit'])
        : undefined,
    weightDims: text(values, 'weightDims'),
  };
  const subtype =
    recordType === 'accessory'
      ? text(values, 'accessoryType')
      : text(values, 'subtype');

  let lot: LotInput | null = null;
  if (!isEdit) {
    const quantity = number(values, 'quantity');
    if (quantity === undefined) {
      throw new FormError('quantity', 'Quantité obligatoire');
    }
    lot = { quantity, expirationDate: date(values, 'expiry') ?? null };
  }
  const alertDays = text(values, 'alertDays');
  return {
    input: {
      name: text(values, 'name') ?? '',
      category,
      unit: unitOption.unit,
      location: text(values, 'location') ?? null,
      notes: text(values, 'notes') ?? null,
      minStock: number(values, 'minStock') ?? null,
      alertDays: alertDays === undefined ? null : Number(alertDays),
      caliber: category === 'weapon' ? text(values, 'caliber') ?? null : null,
      subtype: subtype ?? null,
      attributes,
      // Contenance : seulement pour les boîtes de munitions. Ailleurs, la
      // clé est omise pour garder une contenance déjà réglée (bidons).
      ...(recordType === 'ammo' && unitOption.countUnit === 'box'
        ? { packageSize: number(values, 'packageSize') ?? null }
        : {}),
    },
    lot,
  };
}

export function toWeaponInput(values: Values): WeaponInput {
  checkCommon(values);
  if (!text(values, 'caliber')) {
    throw new FormError('caliber', 'Champ obligatoire');
  }
  return {
    model: text(values, 'name') ?? '',
    kind: (text(values, 'kind') ?? 'other') as WeaponKind,
    caliber: text(values, 'caliber') ?? '',
    serialNumber: text(values, 'serial') ?? null,
    notes: text(values, 'notes') ?? null,
    attributes: {
      brandModel: text(values, 'brandModel'),
      condition: text(values, 'condition') as Weapon['attributes']['condition'],
      checkedAt: date(values, 'checkedAt'),
      location: text(values, 'location'),
    },
  };
}

/** Valeurs de départ d'une fiche vide. */
export function initialValues(
  category: ItemCategory,
  recordType?: 'weapon' | 'ammo' | 'accessory',
): Values {
  return {
    unit: FORMS[category].units[0].value,
    ...(category === 'weapon' ? { recordType: recordType ?? 'weapon' } : {}),
  };
}

const fr = (iso: string | undefined | null) => (iso ? isoToFr(iso) : '');
const str = (n: number | null | undefined) =>
  n === null || n === undefined ? '' : String(n).replace('.', ',');

/** Valeurs d'une fiche à partir d'un article existant. */
export function valuesFromItem(item: InventoryItem): Values {
  const a = item.attributes;
  const accessory = a.recordType === 'accessory';
  return {
    recordType:
      item.category === 'weapon' ? (accessory ? 'accessory' : 'ammo') : '',
    name: item.name,
    unit: unitOptionFor(item.category, item.unit, a.countUnit),
    subtype: accessory ? '' : item.subtype ?? '',
    accessoryType: accessory ? item.subtype ?? '' : '',
    caliber: item.caliber ?? '',
    packageSize: str(item.packageSize),
    location: item.location ?? '',
    notes: item.notes ?? '',
    minStock: str(item.minStock),
    alertDays: item.alertDays === null ? '' : String(item.alertDays),
    potability: a.potability ?? '',
    treatment: a.treatment ?? '',
    treatedAt: fr(a.treatedAt),
    checkedAt: fr(a.checkedAt),
    unitWeight: str(a.unitWeight),
    unitWeightUnit: a.unitWeightUnit ?? 'g',
    energyValue: str(a.energyValue),
    energyBasis: a.energyBasis ?? 'per100g',
    storage: a.storage ?? '',
    dosage: a.dosage ?? '',
    lotNumber: a.lotNumber ?? '',
    brandModel: a.brandModel ?? '',
    condition: a.condition ?? '',
    lastServiceAt: fr(a.lastServiceAt),
    nextServiceAt: fr(a.nextServiceAt),
    capacityValue: str(a.capacityValue),
    capacityUnit: a.capacityUnit ?? 'Wh',
    weightDims: a.weightDims ?? '',
  };
}

/** Valeurs d'une fiche à partir d'une arme existante. */
export function valuesFromWeapon(weapon: Weapon): Values {
  return {
    recordType: 'weapon',
    unit: 'piece',
    name: weapon.model,
    kind: weapon.kind,
    caliber: weapon.caliber,
    serial: weapon.serialNumber ?? '',
    notes: weapon.notes ?? '',
    brandModel: weapon.attributes.brandModel ?? '',
    condition: weapon.attributes.condition ?? '',
    checkedAt: fr(weapon.attributes.checkedAt),
    location: weapon.attributes.location ?? '',
  };
}

/** Champ de la fiche correspondant à une erreur du dépôt. */
export function formFieldFor(repoField: string): string {
  switch (repoField) {
    case 'model':
      return 'name';
    case 'serialNumber':
      return 'serial';
    case 'expirationDate':
      return 'expiry';
    default:
      return repoField;
  }
}
