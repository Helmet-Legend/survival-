/**
 * Contenu de la base factice (mode sous contrainte).
 *
 * Le leurre doit ressembler à l'inventaire d'un foyer ordinaire un peu
 * prévoyant, et non à une base vide, qui serait suspecte. Les quantités et
 * les dates varient d'une installation à l'autre pour que deux téléphones ne
 * montrent pas le même leurre à l'identique.
 */
import { systemRandom } from '../crypto/native/random';
import type { RandomSource } from '../crypto/types';
import type { SqlDatabase } from '../db/types';
import { addDays, localToday } from '../lib/dates';
import { InventoryRepository, type ItemInput } from './inventoryRepository';

interface DecoyTemplate {
  item: ItemInput;
  /** Quantité min et max. */
  quantity: [number, number];
  /** Péremption min et max en jours, ou null si non périssable. */
  shelfLifeDays: [number, number] | null;
}

const TEMPLATES: readonly DecoyTemplate[] = [
  {
    item: {
      name: 'Eau minérale',
      category: 'water',
      unit: 'L',
      location: 'Cellier',
    },
    quantity: [6, 12],
    shelfLifeDays: [120, 400],
  },
  {
    item: {
      name: 'Pâtes',
      category: 'food',
      unit: 'kg',
      caloriesPerUnit: 3500,
      location: 'Placard cuisine',
    },
    quantity: [1, 3],
    shelfLifeDays: [150, 500],
  },
  {
    item: {
      name: 'Riz',
      category: 'food',
      unit: 'kg',
      caloriesPerUnit: 3600,
      location: 'Placard cuisine',
    },
    quantity: [1, 2],
    shelfLifeDays: [200, 600],
  },
  {
    item: {
      name: 'Conserves de thon',
      category: 'food',
      unit: 'unit',
      caloriesPerUnit: 190,
      location: 'Placard cuisine',
    },
    quantity: [2, 6],
    shelfLifeDays: [300, 900],
  },
  {
    item: {
      name: 'Biscuits',
      category: 'food',
      unit: 'unit',
      caloriesPerUnit: 900,
      location: 'Placard cuisine',
    },
    quantity: [1, 3],
    shelfLifeDays: [40, 160],
  },
  {
    item: {
      name: 'Paracétamol 500 mg',
      category: 'medical',
      unit: 'unit',
      location: 'Salle de bain',
    },
    quantity: [8, 16],
    shelfLifeDays: [200, 700],
  },
  {
    item: {
      name: 'Pansements',
      category: 'medical',
      unit: 'unit',
      location: 'Salle de bain',
    },
    quantity: [10, 30],
    shelfLifeDays: null,
  },
  {
    item: {
      name: 'Piles AA',
      category: 'energy',
      unit: 'unit',
      location: 'Tiroir entrée',
    },
    quantity: [4, 12],
    shelfLifeDays: [700, 1800],
  },
  {
    item: {
      name: 'Lampe de poche',
      category: 'tool',
      unit: 'unit',
      location: 'Tiroir entrée',
    },
    quantity: [1, 1],
    shelfLifeDays: null,
  },
];

function pick(random: RandomSource, [min, max]: [number, number]): number {
  const r = random.bytes(2);
  const fraction = (r[0] * 256 + r[1]) / 65_536;
  return min + Math.floor(fraction * (max - min + 1));
}

export async function seedDecoyInventory(
  db: SqlDatabase,
  options: { today?: string; random?: RandomSource } = {},
): Promise<void> {
  const today = options.today ?? localToday();
  const random = options.random ?? systemRandom;
  const repo = new InventoryRepository(db, { today: () => today });

  for (const template of TEMPLATES) {
    const acquiredAt = addDays(today, -pick(random, [3, 120]));
    await repo.createItem(template.item, {
      quantity: pick(random, template.quantity),
      acquiredAt,
      expirationDate:
        template.shelfLifeDays === null
          ? null
          : addDays(today, pick(random, template.shelfLifeDays)),
    });
  }
}
