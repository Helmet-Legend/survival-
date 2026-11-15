import type { InventoryItem } from '../../src/inventory';
import { itemFacts } from '../../src/ui/stockForms/details';

const croquettes = (attributes: InventoryItem['attributes']) =>
  ({
    id: 'a',
    name: 'Croquettes',
    category: 'pets',
    subtype: 'food',
    unit: 'kg',
    caloriesPerUnit: null,
    location: null,
    isCritical: false,
    notes: null,
    minStock: null,
    alertDays: null,
    caliber: null,
    packageSize: null,
    attributes,
  } as unknown as InventoryItem);

const fact = (item: InventoryItem, label: string, usable?: number) =>
  itemFacts(item, usable).find(([l]) => l === label)?.[1];

describe('détail de la nourriture des animaux', () => {
  it('montre la ration, sans répéter les jours affichés en tête', () => {
    const item = croquettes({ dailyRation: 300 });
    expect(fact(item, 'Ration journalière', 5)).toBe('300 g / jour');
    expect(fact(item, 'Autonomie', 5)).toBeUndefined();
  });

  it('dit ce qui manque pour calculer des paquets', () => {
    const item = {
      ...croquettes({ dailyRation: 300 }),
      unit: 'unit',
    } as InventoryItem;
    expect(fact(item, 'Autonomie', 3)).toMatch(/poids d’un paquet/);
  });

  it('invite à renseigner la ration quand elle manque', () => {
    const item = croquettes({});
    expect(fact(item, 'Ration journalière', 5)).toMatch(/À renseigner/);
    expect(fact(item, 'Autonomie', 5)).toBeUndefined();
  });
});
