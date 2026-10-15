/** Données d'exemple de la démo : inventaire du vrai coffre et fiches de survie. */
import type { SqlDatabase } from '../../src/db/types';
import { InventoryRepository, type ItemInput } from '../../src/inventory';
import { addDays, localToday } from '../../src/lib/dates';
import { saveHousehold } from '../../src/resilience/resilienceCalculator';

export const MASTER_PIN = '482915';
export const DURESS_PIN = '730264';

type Lot = [quantity: number, expiresInDays: number | null];

const REAL_STOCK: Array<[ItemInput, Lot[]]> = [
  [
    {
      name: 'Eau en bidons',
      category: 'water',
      unit: 'L',
      location: 'Garage',
      isCritical: true,
    },
    [
      [40, 300],
      [18, 12],
    ],
  ],
  [
    {
      name: 'Eau en bouteilles',
      category: 'water',
      unit: 'L',
      location: 'Cellier',
    },
    [[9, -4]],
  ],
  [
    {
      name: 'Riz',
      category: 'food',
      unit: 'kg',
      caloriesPerUnit: 3600,
      location: 'Cellier',
    },
    [
      [5, 400],
      [2, 25],
    ],
  ],
  [
    {
      name: 'Lentilles',
      category: 'food',
      unit: 'kg',
      caloriesPerUnit: 3500,
      location: 'Cellier',
    },
    [[3, 200]],
  ],
  [
    {
      name: 'Sardines en conserve',
      category: 'food',
      unit: 'unit',
      caloriesPerUnit: 190,
      location: 'Cellier',
    },
    [[12, 700]],
  ],
  [
    {
      name: 'Rations lyophilisées',
      category: 'food',
      unit: 'unit',
      caloriesPerUnit: 600,
      location: 'Sac d’évacuation',
      isCritical: true,
    },
    [[8, 55]],
  ],
  [
    {
      name: 'Miel',
      category: 'food',
      unit: 'kg',
      caloriesPerUnit: 3040,
      location: 'Cuisine',
    },
    [[1, null]],
  ],
  [
    {
      name: 'Pastilles de purification',
      category: 'medical',
      unit: 'unit',
      location: 'Sac d’évacuation',
      isCritical: true,
    },
    [[50, 45]],
  ],
  [
    {
      name: 'Garrot tourniquet',
      category: 'medical',
      unit: 'unit',
      location: 'Sac d’évacuation',
      isCritical: true,
    },
    [[1, null]],
  ],
  [
    {
      name: 'Compresses stériles',
      category: 'medical',
      unit: 'unit',
      location: 'Salle de bain',
    },
    [[40, 80]],
  ],
  [
    {
      name: 'Piles AA',
      category: 'energy',
      unit: 'unit',
      location: 'Tiroir entrée',
    },
    [[24, 1500]],
  ],
  [
    {
      name: 'Batterie externe 20 000 mAh',
      category: 'energy',
      unit: 'unit',
      location: 'Sac d’évacuation',
    },
    [[2, null]],
  ],
  [
    {
      name: 'Radio à manivelle',
      category: 'tool',
      unit: 'unit',
      location: 'Garage',
      isCritical: true,
    },
    [[1, null]],
  ],
];

export async function seedRealVault(db: SqlDatabase): Promise<void> {
  const today = localToday();
  const repo = new InventoryRepository(db);
  for (const [item, lots] of REAL_STOCK) {
    const created = await repo.createItem(item);
    for (const [quantity, days] of lots) {
      await repo.addLot(created.id, {
        quantity,
        acquiredAt: addDays(today, -60),
        expirationDate: days === null ? null : addDays(today, days),
      });
    }
  }
  await saveHousehold(db, {
    members: 3,
    waterLitersPerPersonDay: 3,
    kcalPerPersonDay: 2000,
  });
}

export { BUNDLED_GUIDES as SAMPLE_GUIDES } from '../../src/content/guides';
