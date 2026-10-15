import { prepareDatabase } from '../../src/db/connection';
import {
  ArmoryRepository,
  caliberKey,
  InventoryError,
  InventoryRepository,
} from '../../src/inventory';
import { NodeSqliteDb } from '../db/sqlite';

const TODAY = '2026-10-15';

async function setup() {
  const db = new NodeSqliteDb();
  await prepareDatabase(db);
  let n = 0;
  const newId = () => `id-${++n}`;
  const today = () => TODAY;
  return {
    armory: new ArmoryRepository(db, { newId, today }),
    repo: new InventoryRepository(db, { newId, today }),
  };
}

describe('caliberKey', () => {
  it.each([
    ['12/70', '12 / 70'],
    ['9x19', '9 X 19'],
    ['9x19', '9×19'],
    ['.22 LR', '.22lr'],
    ['7,62x39', '7.62 x 39'],
  ])('« %s » et « %s » sont le même calibre', (a, b) => {
    expect(caliberKey(a)).toBe(caliberKey(b));
  });

  it('distingue des calibres différents', () => {
    expect(caliberKey('12/70')).not.toBe(caliberKey('12/76'));
  });
});

describe('ArmoryRepository', () => {
  it('enregistre une arme et nettoie les champs', async () => {
    const { armory } = await setup();
    const weapon = await armory.createWeapon({
      model: '  Tikka T3x ',
      kind: 'rifle',
      caliber: ' .308 Win ',
      serialNumber: '',
      notes: '  ',
    });
    expect(weapon).toMatchObject({
      model: 'Tikka T3x',
      kind: 'rifle',
      caliber: '.308 Win',
      serialNumber: null,
      notes: null,
    });
  });

  it.each([
    ['modèle vide', { model: ' ' }, 'model'],
    ['calibre vide', { caliber: '' }, 'caliber'],
    ['type inconnu', { kind: 'cannon' as never }, 'kind'],
    ['n° de série trop long', { serialNumber: 'x'.repeat(61) }, 'serialNumber'],
  ])('refuse une arme invalide (%s)', async (_, patch, field) => {
    const { armory } = await setup();
    await expect(
      armory.createWeapon({
        model: 'Glock 17',
        kind: 'handgun',
        caliber: '9x19',
        ...patch,
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION', field });
  });

  it('compte les munitions utilisables du même calibre', async () => {
    const { armory, repo } = await setup();
    await armory.createWeapon({
      model: 'Browning B525',
      kind: 'shotgun',
      caliber: '12/70',
    });
    await armory.createWeapon({
      model: 'Glock 17',
      kind: 'handgun',
      caliber: '9x19',
    });
    const shells = await repo.createItem(
      {
        name: 'Cartouches',
        category: 'weapon',
        unit: 'unit',
        caliber: '12 / 70',
      },
      { quantity: 100 },
    );
    // Un lot périmé ne compte pas.
    await repo.addLot(shells.id, {
      quantity: 25,
      expirationDate: '2026-01-01',
      acquiredAt: '2025-01-01',
    });
    await repo.createItem(
      {
        name: 'Cartouches acier',
        category: 'weapon',
        unit: 'unit',
        caliber: '12/70',
      },
      { quantity: 50 },
    );
    // Un autre calibre, et un article sans calibre, ne comptent pas.
    await repo.createItem(
      { name: 'Balles', category: 'weapon', unit: 'unit', caliber: '.22 LR' },
      { quantity: 500 },
    );
    await repo.createItem(
      { name: 'Kit nettoyage', category: 'weapon', unit: 'unit' },
      { quantity: 2 },
    );

    const weapons = await armory.listWeapons();
    expect(weapons.map(w => [w.model, w.rounds])).toEqual([
      ['Browning B525', 150],
      ['Glock 17', 0],
    ]);
  });

  it('modifie et retire une arme sans toucher aux munitions', async () => {
    const { armory, repo } = await setup();
    const weapon = await armory.createWeapon({
      model: 'Glock 17',
      kind: 'handgun',
      caliber: '9x19',
    });
    await repo.createItem(
      { name: '9 mm FMJ', category: 'weapon', unit: 'unit', caliber: '9x19' },
      { quantity: 50 },
    );
    const updated = await armory.updateWeapon(weapon.id, {
      model: 'Glock 19',
      kind: 'handgun',
      caliber: '9x19',
      serialNumber: 'XYZ',
    });
    expect(updated).toMatchObject({ model: 'Glock 19', serialNumber: 'XYZ' });

    await armory.deleteWeapon(weapon.id);
    expect(await armory.listWeapons()).toEqual([]);
    expect(
      (await repo.listItems({ category: 'weapon' }))[0].usableQuantity,
    ).toBe(50);
    await expect(armory.deleteWeapon(weapon.id)).rejects.toBeInstanceOf(
      InventoryError,
    );
  });

  it('ignore le calibre hors de la catégorie armes', async () => {
    const { repo } = await setup();
    const rice = await repo.createItem({
      name: 'Riz',
      category: 'food',
      unit: 'kg',
      caliber: '12/70',
    });
    expect(rice.caliber).toBeNull();
    const ammo = await repo.createItem({
      name: 'Cartouches',
      category: 'weapon',
      unit: 'unit',
      caliber: '12/70',
    });
    // Passer en « Outils » efface le calibre au lieu d'échouer.
    expect(
      (await repo.updateItem(ammo.id, { category: 'tool' })).caliber,
    ).toBeNull();
  });
});
