import type { ItemSummary } from '../../src/inventory';
import { sortItems } from '../../src/ui/screens/StockScreen';
import { periodStart } from '../../src/ui/screens/HistoryScreen';

const item = (
  name: string,
  usableQuantity: number,
  nextExpiration: string | null,
  totalQuantity = usableQuantity,
) =>
  ({
    name,
    usableQuantity,
    totalQuantity,
    nextExpiration,
  } as ItemSummary);

describe('tri de la liste des stocks', () => {
  const list = [
    item('Riz', 5, '2027-01-01'),
    item('Eau', 20, null),
    item('Lait', 1, '2026-11-10'),
    item('Pain', 2, '2026-12-01', 3),
  ];

  it('garde l’ordre de la base pour « Nom »', () => {
    expect(sortItems(list, 'name').map(i => i.name)).toEqual([
      'Riz',
      'Eau',
      'Lait',
      'Pain',
    ]);
  });

  it('met les lots périmés puis la péremption la plus proche en tête', () => {
    expect(sortItems(list, 'expiry').map(i => i.name)).toEqual([
      'Pain',
      'Lait',
      'Riz',
      'Eau',
    ]);
  });

  it('classe du moins au plus en stock', () => {
    expect(sortItems(list, 'quantity').map(i => i.name)).toEqual([
      'Lait',
      'Pain',
      'Riz',
      'Eau',
    ]);
  });
});

describe('périodes de l’historique', () => {
  it('part de minuit, heure locale', () => {
    const now = new Date(2026, 10, 5, 15, 30);
    expect(periodStart('all', now)).toBeUndefined();
    expect(periodStart('week', now)).toBe(new Date(2026, 9, 30).toISOString());
    expect(periodStart('days30', now)).toBe(new Date(2026, 9, 7).toISOString());
    expect(periodStart('month', now)).toBe(new Date(2026, 10, 1).toISOString());
  });
});
