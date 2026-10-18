import { BUNDLED_GUIDES } from '../../src/content/guides';
import { CRISES, crisisById, simulateCrisis } from '../../src/plan/crisis';
import type { StockLot } from '../../src/resilience/resilienceCalculator';

const TODAY = '2026-10-18';
const HOUSEHOLD = {
  members: 2,
  waterLitersPerPersonDay: 3,
  kcalPerPersonDay: 2000,
};

function lot(
  partial: Partial<StockLot> & Pick<StockLot, 'itemName'>,
): StockLot {
  return {
    lotId: partial.itemName,
    itemId: partial.itemName,
    category: 'food',
    unit: 'unit',
    quantity: 1,
    caloriesPerUnit: null,
    expirationDate: null,
    ...partial,
  };
}

const WATER = lot({
  itemName: 'Eau',
  category: 'water',
  unit: 'L',
  quantity: 15,
});
const PASTA = lot({ itemName: 'Pâtes', quantity: 4, caloriesPerUnit: 3500 });
const HAM = lot({
  itemName: 'Jambon',
  quantity: 1,
  caloriesPerUnit: 4000,
  storage: 'fridge',
});
const PEAS = lot({
  itemName: 'Petits pois surgelés',
  quantity: 1,
  caloriesPerUnit: 5000,
  storage: 'frozen',
});

describe('simulateur de crise', () => {
  it('déroule l’eau jour par jour et date le premier manque', () => {
    const result = simulateCrisis({
      scenario: crisisById('waterCut'),
      days: 3,
      household: HOUSEHOLD,
      lots: [WATER],
      usableWh: null,
      whPerPersonDay: 15,
      lights: 0,
      asOf: TODAY,
    });
    expect(
      result.days.map(d => [d.water.start, d.water.end, d.water.short]),
    ).toEqual([
      [15, 9, 0],
      [9, 3, 0],
      [3, 0, 3],
    ]);
    expect(result.water).toEqual({
      dailyNeed: 6,
      coveredDays: 2,
      firstShortDay: 3,
      missing: 3,
    });
    // Courant disponible : ni énergie ni éclairage simulés.
    expect(result.energy).toBeNull();
    expect(result.lights).toBeNull();
    expect(result.days[2].events.map(e => e.link?.label)).toContain(
      'Rendre l’eau potable',
    );
  });

  it('perd le froid en coupure de courant et mange d’abord le frais', () => {
    const result = simulateCrisis({
      scenario: crisisById('blackout'),
      days: 3,
      household: { ...HOUSEHOLD, members: 1 },
      lots: [PASTA, HAM, PEAS],
      usableWh: 40,
      whPerPersonDay: 15,
      lights: 0,
      asOf: TODAY,
    });
    // Jour 1 : le jambon (2 000 kcal sur 4 000) ; jour 2 : les surgelés.
    expect(result.days[0].food).toEqual({ start: 23000, end: 21000, short: 0 });
    expect(result.days[1].lost).toEqual(['Jambon (froid perdu)']);
    expect(result.days[1].food.start).toBe(19000);
    expect(result.days[2].lost).toEqual(['Petits pois surgelés (froid perdu)']);
    expect(result.days[2].food.start).toBe(14000);
    // 40 Wh pour 15 Wh par jour : manque 5 Wh le troisième jour.
    expect(result.energy).toEqual({
      dailyNeed: 15,
      coveredDays: 2,
      firstShortDay: 3,
      missing: 5,
    });
    expect(result.lights).toEqual({ count: 0, members: 1 });
  });

  it('garde le froid quand le courant reste disponible', () => {
    const result = simulateCrisis({
      scenario: crisisById('lockdown'),
      days: 7,
      household: { ...HOUSEHOLD, members: 1 },
      lots: [HAM],
      usableWh: 100,
      whPerPersonDay: 15,
      lights: 1,
      asOf: TODAY,
    });
    expect(result.days.flatMap(d => d.lost)).toEqual([]);
    expect(result.food.coveredDays).toBe(2);
  });

  it('écarte les lots périmés et perd ceux qui périment en cours', () => {
    const result = simulateCrisis({
      scenario: crisisById('waterCut'),
      days: 3,
      household: { ...HOUSEHOLD, members: 1 },
      lots: [
        lot({
          itemName: 'Vieux riz',
          quantity: 1,
          caloriesPerUnit: 9000,
          expirationDate: '2026-10-01',
        }),
        lot({
          itemName: 'Pain',
          quantity: 1,
          caloriesPerUnit: 5000,
          expirationDate: '2026-10-18',
        }),
      ],
      usableWh: null,
      whPerPersonDay: 15,
      lights: 0,
      asOf: TODAY,
    });
    expect(result.days[0].food.start).toBe(5000);
    expect(result.days[1].lost).toEqual(['Pain (périmé)']);
    expect(result.food.firstShortDay).toBe(2);
  });

  it('compte une seule personne pour un sac', () => {
    const result = simulateCrisis({
      scenario: crisisById('evacuation'),
      days: 3,
      household: { ...HOUSEHOLD, members: 4 },
      lots: [WATER],
      usableWh: null,
      whPerPersonDay: 15,
      lights: 1,
      asOf: TODAY,
    });
    expect(result.members).toBe(1);
    expect(result.water.dailyNeed).toBe(3);
    // Capacité inconnue : l'énergie n'est pas simulée.
    expect(result.energy).toBeNull();
  });

  it('place les événements de fin au dernier jour et renvoie à des fiches existantes', () => {
    const slugs = new Set(BUNDLED_GUIDES.map(f => f.slug));
    for (const crisis of CRISES) {
      for (const event of crisis.events) {
        if (event.link?.kind === 'guide') {
          expect(slugs).toContain(event.link.slug);
        }
      }
      expect(crisis.durations).toContain(crisis.defaultDays);
    }
    const short = simulateCrisis({
      scenario: crisisById('blackout'),
      days: 3,
      household: HOUSEHOLD,
      lots: [],
      usableWh: null,
      whPerPersonDay: 15,
      lights: 0,
      asOf: TODAY,
    });
    expect(short.days[2].events.map(e => e.link?.label)).toContain(
      'Après la crise',
    );
  });
});
