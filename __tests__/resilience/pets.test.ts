import {
  petFoodDays,
  petFoodRation,
  petFoodSummary,
} from '../../src/inventory/petFood';
import { prepareDatabase } from '../../src/db/connection';
import {
  dailyWaterNeed,
  loadHousehold,
} from '../../src/resilience/resilienceCalculator';
import { NodeSqliteDb } from '../db/sqlite';
import {
  eatersOf,
  estimatedWater,
  parsePets,
  savePets,
  petsPotableWater,
  petsRawWater,
  petWater,
  type Pet,
} from '../../src/resilience/pets';

const pet = (over: Partial<Pet>): Pet => ({
  id: 'x',
  name: 'X',
  species: 'dog',
  weightKg: null,
  kibbleG: 0,
  wetG: 0,
  waterL: null,
  waterSource: 'potable',
  ...over,
});

const rex = pet({
  id: 'rex',
  name: 'Rex',
  weightKg: 20,
  kibbleG: 300,
  waterSource: 'raw',
});
const max = pet({ id: 'max', name: 'Max', weightKg: 8, kibbleG: 120 });
const mina = pet({
  id: 'mina',
  name: 'Mina',
  species: 'cat',
  weightKg: 4,
  kibbleG: 40,
  wetG: 85,
});
const pets = [rex, max, mina];

const food = (subtype: string, forPets?: string) => ({
  category: 'pets' as const,
  subtype,
  unit: 'kg' as const,
  attributes: forPets ? { forPets } : {},
});

describe('animaux du foyer', () => {
  it('estime l’eau d’après le poids, sauf saisie ou poids inconnu', () => {
    expect(estimatedWater(rex)).toBe(1.2);
    expect(estimatedWater(mina)).toBe(0.2);
    expect(estimatedWater(pet({}))).toBeNull();
    expect(estimatedWater(pet({ species: 'other', weightKg: 5 }))).toBeNull();
    expect(petWater({ ...rex, waterL: 2 })).toBe(2);
  });

  it('répartit l’eau entre potable et pluie / cuve', () => {
    expect(petsPotableWater(pets, true)).toBeCloseTo(0.68);
    expect(petsRawWater(pets, true)).toBeCloseTo(1.2);
    // Sans réserve non potable, Rex boit aussi l'eau potable.
    expect(petsPotableWater(pets, false)).toBeCloseTo(1.88);
    expect(petsRawWater(pets, false)).toBe(0);
  });

  it('additionne les rations des animaux choisis pour un aliment', () => {
    expect(eatersOf(pets, 'rex,max').map(p => p.name)).toEqual(['Rex', 'Max']);
    expect(eatersOf(pets, 'all')).toHaveLength(3);
    expect(petFoodRation(food('food', 'rex,max'), pets)).toBe(420);
    expect(petFoodDays(food('food', 'rex,max'), 12, pets)).toBe(28);
    // La pâtée ne compte que la ration de pâtée.
    expect(petFoodRation(food('wet'), pets)).toBe(85);
    expect(petFoodRation(food('wet', 'rex'), pets)).toBeNull();
  });

  it('résume les jours par animal et signale l’absence de stock', () => {
    const items = [
      { ...food('food', 'rex,max'), usableQuantity: 12 },
      { ...food('wet', 'mina'), usableQuantity: 3 },
    ];
    expect(petFoodSummary(items, pets).map(s => [s.pet.name, s.lines])).toEqual(
      [
        ['Rex', [{ subtype: 'food', days: 28 }]],
        ['Max', [{ subtype: 'food', days: 28 }]],
        [
          'Mina',
          [
            { subtype: 'food', days: null },
            { subtype: 'wet', days: 35 },
          ],
        ],
      ],
    );
  });

  it('ignore les animaux illisibles', () => {
    expect(parsePets('pas du json')).toEqual([]);
    expect(
      parsePets(JSON.stringify([{ id: 'a', name: 'A', species: 'lion' }, rex])),
    ).toEqual([rex]);
  });
});

describe('eau des animaux dans le besoin du foyer', () => {
  it('ajoute l’eau potable des animaux, et celle de la cuve s’il n’y en a pas', async () => {
    const db = new NodeSqliteDb();
    await prepareDatabase(db);
    const before = dailyWaterNeed(await loadHousehold(db));
    await savePets(db, [rex, max]);
    // Pas de cuve : Rex boit aussi l'eau potable.
    expect(dailyWaterNeed(await loadHousehold(db)) - before).toBeCloseTo(1.68);
    await db.execute(
      `INSERT INTO inventory_items (id, name, category, unit, attributes)
       VALUES ('cuve', 'Cuve', 'water', 'L', '{"potability":"non_potable"}')`,
    );
    await db.execute(
      `INSERT INTO inventory_lots (id, item_id, quantity, acquired_at)
       VALUES ('l', 'cuve', 60, '2026-01-01')`,
    );
    expect(dailyWaterNeed(await loadHousehold(db)) - before).toBeCloseTo(0.48);
  });
});
