import { petFoodDays, petFoodLabel } from '../../src/inventory/petFood';

const kibble = (attributes: object, unit: 'kg' | 'g' | 'unit' = 'kg') => ({
  category: 'pets' as const,
  subtype: 'food',
  unit,
  attributes,
});

describe('nourriture des animaux', () => {
  it('compte les jours entiers couverts par la ration indiquée', () => {
    expect(petFoodDays(kibble({ dailyRation: 300 }), 12)).toBe(40);
    expect(petFoodDays(kibble({ dailyRation: 170 }, 'g'), 3400)).toBe(20);
    expect(petFoodDays(kibble({ dailyRation: 300 }), 0.2)).toBe(0);
  });

  it('convertit les paquets grâce à leur poids', () => {
    expect(
      petFoodDays(
        kibble(
          { dailyRation: 250, unitWeight: 2, unitWeightUnit: 'kg' },
          'unit',
        ),
        3,
      ),
    ).toBe(24);
    expect(petFoodDays(kibble({ dailyRation: 250 }, 'unit'), 3)).toBeNull();
  });

  it('ne calcule rien sans ration ni hors de la nourriture des animaux', () => {
    expect(petFoodDays(kibble({}), 12)).toBeNull();
    expect(
      petFoodDays({ ...kibble({ dailyRation: 300 }), subtype: 'litter' }, 12),
    ).toBeNull();
    expect(
      petFoodDays({ ...kibble({ dailyRation: 300 }), category: 'food' }, 12),
    ).toBeNull();
  });

  it('accorde le libellé', () => {
    expect(petFoodLabel(1)).toBe('1 jour de nourriture');
    expect(petFoodLabel(40)).toBe('40 jours de nourriture');
  });
});
