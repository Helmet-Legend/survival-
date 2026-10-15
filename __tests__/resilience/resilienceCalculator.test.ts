import { prepareDatabase } from '../../src/db/connection';
import {
  addDays,
  computeResilience,
  daysBetween,
  EXPIRY_ALERTS_SQL,
  expiryBucket,
  getExpiryAlerts,
  getResilienceReport,
  loadHousehold,
  localToday,
  saveHousehold,
  type HouseholdSettings,
  type StockLot,
} from '../../src/resilience/resilienceCalculator';
import { NodeSqliteDb } from '../db/sqlite';

const TODAY = '2026-10-15';
const ONE: HouseholdSettings = {
  members: 1,
  waterLitersPerPersonDay: 3,
  kcalPerPersonDay: 2000,
};

let seq = 0;
function lot(partial: Partial<StockLot>): StockLot {
  seq++;
  return {
    lotId: `lot-${seq}`,
    itemId: `item-${seq}`,
    itemName: `Article ${seq}`,
    category: 'water',
    unit: 'L',
    quantity: 0,
    caloriesPerUnit: null,
    expirationDate: null,
    ...partial,
  };
}

const water = (
  quantity: number,
  expirationDate: string | null = null,
  unit: 'L' | 'mL' = 'L',
) => lot({ category: 'water', unit, quantity, expirationDate });
const food = (kcal: number, expirationDate: string | null = null) =>
  lot({
    category: 'food',
    unit: 'unit',
    quantity: 1,
    caloriesPerUnit: kcal,
    expirationDate,
  });

describe('dates calendaires', () => {
  it('compte les jours sans dépendre du fuseau', () => {
    expect(daysBetween('2028-02-28', '2028-03-01')).toBe(2); // année bissextile
    expect(daysBetween('2026-03-28', '2026-03-30')).toBe(2); // passage à l'heure d'été
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(localToday(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05');
  });

  it('refuse une date invalide', () => {
    expect(() => daysBetween('2026-02-30', TODAY)).toThrow(/inexistante/);
    expect(() => daysBetween('15/10/2026', TODAY)).toThrow(/invalide/);
  });

  it.each([
    [-1, 'expired'],
    [0, 'within30'],
    [30, 'within30'],
    [31, 'within60'],
    [60, 'within60'],
    [90, 'within90'],
    [91, null],
  ])('%d jours restants → %s', (days, bucket) => {
    expect(expiryBucket(days)).toBe(bucket);
  });
});

describe('computeResilience', () => {
  it('applique la formule du cahier des charges', () => {
    const report = computeResilience(
      [water(60), food(30_000), food(10_000)],
      { ...ONE, members: 2 },
      TODAY,
    );
    // Eau : 60 / (2 × 3) = 10 j ; vivres : 40 000 / (2 × 2 000) = 10 j.
    expect(report.water).toMatchObject({
      available: 60,
      dailyNeed: 6,
      naiveDays: 10,
      days: 10,
    });
    expect(report.food).toMatchObject({
      available: 40_000,
      dailyNeed: 4000,
      days: 10,
    });
    expect(report.days).toBe(10);
  });

  it("identifie la ressource limitante et la date d'épuisement", () => {
    const report = computeResilience([water(9), food(20_000)], ONE, TODAY);
    expect(report.water.days).toBe(3);
    expect(report.food.days).toBe(10);
    expect(report.days).toBe(3);
    expect(report.limitingFactor).toBe('water');
    expect(report.water.depletionDate).toBe('2026-10-18');
  });

  it('convertit les mL et les kcal par gramme', () => {
    const report = computeResilience(
      [
        water(4500, null, 'mL'),
        water(1500, null, 'mL'),
        lot({ category: 'food', unit: 'g', quantity: 500, caloriesPerUnit: 4 }), // 2 000 kcal
      ],
      ONE,
      TODAY,
    );
    expect(report.water.available).toBeCloseTo(6, 10);
    expect(report.water.days).toBe(2);
    expect(report.food.available).toBe(2000);
    expect(report.food.days).toBe(1);
  });

  it('ignore les articles sans calories ou non alimentaires', () => {
    const report = computeResilience(
      [
        lot({
          category: 'food',
          unit: 'unit',
          quantity: 10,
          caloriesPerUnit: null,
        }),
        lot({
          category: 'medical',
          unit: 'unit',
          quantity: 3,
          caloriesPerUnit: 500,
        }),
        lot({
          category: 'food',
          unit: 'kg',
          quantity: 2,
          caloriesPerUnit: 3500,
        }),
      ],
      ONE,
      TODAY,
    );
    expect(report.food.available).toBe(7000);
  });

  it('exclut les lots périmés et les compte comme perdus', () => {
    const report = computeResilience(
      [water(30, '2026-10-14'), water(9, '2026-10-15')], // hier / aujourd'hui
      ONE,
      TODAY,
    );
    expect(report.water.available).toBe(9);
    expect(report.water.days).toBe(1); // utilisable jusqu'à ce soir seulement
    expect(report.water.wasted).toBeCloseTo(36, 10); // 30 périmés + 6 non consommés à temps
  });

  it('tient compte des péremptions futures (autonomie réelle < formule simple)', () => {
    // 60 L, 3 L/j → 20 jours théoriques, mais périmé dans 9 jours.
    const report = computeResilience(
      [water(60, addDays(TODAY, 9))],
      ONE,
      TODAY,
    );
    expect(report.water.naiveDays).toBe(20);
    expect(report.water.days).toBe(10);
    expect(report.water.wasted).toBeCloseTo(30, 10);
  });

  it('consomme les lots les plus périssables en premier (FEFO)', () => {
    // 15 L périmant dans 4 j (5 jours utilisables) + 30 L non périssables.
    const report = computeResilience(
      [water(30), water(15, addDays(TODAY, 4))],
      ONE,
      TODAY,
    );
    expect(report.water.days).toBe(15);
    expect(report.water.wasted).toBe(0);
  });

  it('ne perd pas un jour sur des arrondis flottants', () => {
    // En flottants, 0.7/3 + 2.3/3 = 0.9999999999999999.
    const report = computeResilience([water(0.7), water(2.3)], ONE, TODAY);
    expect(report.water.days).toBe(1);
  });

  it('renvoie 0 jour sans stock', () => {
    const report = computeResilience([], ONE, TODAY);
    expect(report.days).toBe(0);
    expect(report.water.depletionDate).toBe(TODAY);
  });

  it.each([
    [{ ...ONE, members: 0 }],
    [{ ...ONE, members: 1.5 }],
    [{ ...ONE, waterLitersPerPersonDay: 0 }],
    [{ ...ONE, kcalPerPersonDay: NaN }],
  ])('refuse des réglages de foyer invalides (%j)', household => {
    expect(() => computeResilience([], household, TODAY)).toThrow();
  });
});

describe('accès à la base', () => {
  async function seededDb() {
    const db = new NodeSqliteDb();
    await prepareDatabase(db);
    const items: Array<
      [string, string, string, string, number | null, number]
    > = [
      ['eau', 'Eau en bouteille', 'water', 'L', null, 1],
      ['riz', 'Riz', 'food', 'kg', 3600, 0],
      ['pansements', 'Pansements', 'medical', 'unit', null, 1],
      ['piles', 'Piles AA', 'energy', 'unit', null, 0],
    ];
    for (const [id, name, category, unit, kcal, critical] of items) {
      await db.execute(
        `INSERT INTO inventory_items (id, name, category, unit, calories_per_unit, is_critical)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [id, name, category, unit, kcal, critical],
      );
    }
    const lots: Array<[string, string, number, string | null]> = [
      ['l1', 'eau', 24, addDays(TODAY, 200)],
      ['l2', 'eau', 6, addDays(TODAY, 20)],
      ['l3', 'riz', 5, addDays(TODAY, 45)],
      ['l4', 'pansements', 50, addDays(TODAY, -3)],
      ['l5', 'piles', 8, addDays(TODAY, 80)],
      ['l6', 'piles', 0, addDays(TODAY, 5)], // lot vide : ignoré
      ['l7', 'riz', 2, null], // non périssable
    ];
    for (const [id, itemId, quantity, expiration] of lots) {
      await db.execute(
        `INSERT INTO inventory_lots (id, item_id, quantity, acquired_at, expiration_date)
         VALUES (?, ?, ?, '2026-01-01', ?)`,
        [id, itemId, quantity, expiration],
      );
    }
    return db;
  }

  it('lit et enregistre les réglages du foyer', async () => {
    const db = await seededDb();
    expect(await loadHousehold(db)).toEqual(ONE);
    await saveHousehold(db, {
      members: 4,
      waterLitersPerPersonDay: 4,
      kcalPerPersonDay: 2200,
    });
    expect(await loadHousehold(db)).toEqual({
      members: 4,
      waterLitersPerPersonDay: 4,
      kcalPerPersonDay: 2200,
    });
  });

  it('refuse des réglages corrompus en base', async () => {
    const db = await seededDb();
    await db.execute(
      "UPDATE settings SET value = 'deux' WHERE key = 'household_members'",
    );
    await expect(loadHousehold(db)).rejects.toThrow(/au moins une personne/);
  });

  it("calcule l'autonomie à partir de l'inventaire", async () => {
    const db = await seededDb();
    await saveHousehold(db, { ...ONE, members: 2 });
    const report = await getResilienceReport(db, TODAY);
    expect(report.water.available).toBe(30);
    expect(report.water.days).toBe(5); // 30 L / 6 L par jour
    expect(report.food.available).toBe(7 * 3600);
    expect(report.food.days).toBe(6); // 25 200 / 4 000
    expect(report.days).toBe(5);
  });

  it('classe les alertes de péremption par urgence', async () => {
    const db = await seededDb();
    const alerts = await getExpiryAlerts(db, TODAY);
    expect(alerts.map(a => [a.lotId, a.bucket, a.daysLeft])).toEqual([
      ['l4', 'expired', -3],
      ['l2', 'within30', 20],
      ['l3', 'within60', 45],
      ['l5', 'within90', 80],
    ]);
    expect(alerts[0]).toMatchObject({
      itemName: 'Pansements',
      isCritical: true,
      unit: 'unit',
    });
  });

  it("utilise l'index partiel pour la requête d'alertes", async () => {
    const db = await seededDb();
    const { rows } = await db.execute(
      `EXPLAIN QUERY PLAN ${EXPIRY_ALERTS_SQL}`,
      [TODAY],
    );
    expect(rows.map(r => String(r.detail)).join('\n')).toContain(
      'idx_inventory_lots_expiration',
    );
  });
});
