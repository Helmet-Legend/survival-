import { prepareDatabase } from '../../src/db/connection';
import {
  ArmoryRepository,
  caloriesPerUnit,
  InventoryRepository,
  PhotoRepository,
  validateItemAttributes,
  validateWeaponAttributes,
} from '../../src/inventory';
import { NodeSqliteDb } from '../db/sqlite';

describe('validateItemAttributes', () => {
  it('garde les champs renseignés et ignore les vides', () => {
    expect(
      validateItemAttributes({
        potability: 'potable',
        treatment: 'none',
        dosage: '  ',
        lotNumber: ' AB12 ',
        checkedAt: '2026-10-20',
      }),
    ).toEqual({
      potability: 'potable',
      treatment: 'none',
      lotNumber: 'AB12',
      checkedAt: '2026-10-20',
    });
    expect(validateItemAttributes(null)).toEqual({});
  });

  it.each([
    ['valeur inconnue', { potability: 'buvable' as never }, 'potability'],
    ['date invalide', { treatedAt: '2026-02-30' }, 'treatedAt'],
    [
      'nombre négatif',
      { unitWeight: -1, unitWeightUnit: 'g' as const },
      'unitWeight',
    ],
    ['valeur sans référence', { energyValue: 350 }, 'energyValue'],
    ['poids sans unité', { unitWeight: 500 }, 'unitWeight'],
    ['capacité sans unité', { capacityValue: 10000 }, 'capacityValue'],
  ])('refuse %s', (_, attrs, field) => {
    expect(() => validateItemAttributes(attrs)).toThrow(
      expect.objectContaining({ field }),
    );
  });

  it('valide les champs d’une arme', () => {
    expect(
      validateWeaponAttributes({ condition: 'check', location: 'Coffre' }),
    ).toEqual({ condition: 'check', location: 'Coffre' });
    expect(() =>
      validateWeaponAttributes({ condition: 'cassée' as never }),
    ).toThrow();
  });
});

describe('caloriesPerUnit', () => {
  it.each([
    ['étiquette saisie', 'kg', 3600, {}, 3600],
    [
      'kcal/100 g en kg',
      'kg',
      null,
      { energyValue: 350, energyBasis: 'per100g' },
      3500,
    ],
    [
      'kcal/100 g en g',
      'g',
      null,
      { energyValue: 350, energyBasis: 'per100g' },
      3.5,
    ],
    [
      'pièce de poids connu',
      'unit',
      null,
      {
        energyValue: 200,
        energyBasis: 'per100g',
        unitWeight: 0.4,
        unitWeightUnit: 'kg',
      },
      800,
    ],
    [
      'portion',
      'unit',
      null,
      { energyValue: 600, energyBasis: 'perPortion', countUnit: 'portion' },
      600,
    ],
    [
      'pièce sans poids',
      'unit',
      null,
      { energyValue: 200, energyBasis: 'per100g' },
      null,
    ],
    [
      'kcal/portion en kg',
      'kg',
      null,
      { energyValue: 600, energyBasis: 'perPortion' },
      null,
    ],
    ['rien de saisi', 'kg', null, {}, null],
  ] as const)('%s', (_, unit, stored, attrs, expected) => {
    expect(caloriesPerUnit(unit, stored, attrs)).toBe(expected);
  });
});

describe('articles détaillés en base', () => {
  async function setup() {
    const db = new NodeSqliteDb();
    await prepareDatabase(db);
    return {
      repo: new InventoryRepository(db),
      armory: new ArmoryRepository(db),
      photos: new PhotoRepository(db),
    };
  }

  it('enregistre et relit les attributs, et accepte des photos d’article', async () => {
    const { repo, photos } = await setup();
    const item = await repo.createItem(
      {
        name: 'Bidon',
        category: 'water',
        unit: 'L',
        subtype: 'jerrycan',
        attributes: {
          potability: 'to_treat',
          treatment: 'tablets',
          treatedAt: '2026-10-01',
        },
      },
      { quantity: 20 },
    );
    expect(item.attributes).toEqual({
      potability: 'to_treat',
      treatment: 'tablets',
      treatedAt: '2026-10-01',
    });
    const updated = await repo.updateItem(item.id, {
      attributes: { ...item.attributes, potability: 'potable' },
    });
    expect(updated.attributes.potability).toBe('potable');

    await photos.add('item', item.id, 'AAAA');
    await repo.deleteItem(item.id);
    expect(await photos.list('item', item.id)).toEqual([]);
  });

  it('compte les cartouches en pièces ou en boîtes de contenance connue', async () => {
    const { repo, armory } = await setup();
    await armory.createWeapon({
      model: 'Browning',
      kind: 'shotgun',
      caliber: '12/70',
    });
    await repo.createItem(
      { name: 'Vrac', category: 'weapon', unit: 'unit', caliber: '12/70' },
      { quantity: 10 },
    );
    await repo.createItem(
      {
        name: 'Boîtes',
        category: 'weapon',
        unit: 'unit',
        caliber: '12/70',
        packageSize: 25,
        attributes: { countUnit: 'box', recordType: 'ammo' },
      },
      { quantity: 4 },
    );
    await repo.createItem(
      {
        name: 'Lot sans contenance',
        category: 'weapon',
        unit: 'unit',
        caliber: '12/70',
        attributes: { countUnit: 'lot' },
      },
      { quantity: 3 },
    );
    await repo.createItem(
      {
        name: 'Chargeur',
        category: 'weapon',
        unit: 'unit',
        caliber: '12/70',
        attributes: { recordType: 'accessory' },
      },
      { quantity: 2 },
    );
    expect((await armory.listWeapons())[0].rounds).toBe(10 + 100);
  });
});
