import { prepareDatabase } from '../../src/db/connection';
import {
  BagRepository,
  BoxRepository,
  boxQr,
  InventoryRepository,
  parseBoxQr,
} from '../../src/inventory';
import { loadConsumableLots } from '../../src/resilience/resilienceCalculator';
import { NodeSqliteDb } from '../db/sqlite';

const TODAY = '2026-10-15';

async function setup() {
  const db = new NodeSqliteDb();
  await prepareDatabase(db);
  const repo = new InventoryRepository(db, { today: () => TODAY });
  const boxes = new BoxRepository(db, { today: () => TODAY });
  return { db, repo, boxes };
}

describe('boîtes étiquetées', () => {
  it('numérote les boîtes à la suite, sans limite', async () => {
    const { boxes } = await setup();
    for (let i = 0; i < 15; i++) {
      await boxes.create();
    }
    const list = await boxes.list();
    expect(list.map(b => b.labelNo)).toEqual(
      Array.from({ length: 15 }, (_, i) => i + 1),
    );
  });

  it('lit seulement ses propres étiquettes', () => {
    expect(parseBoxQr(boxQr('abc-123'))).toBe('abc-123');
    expect(parseBoxQr(' fenrir:boite:abc \n')).toBe('abc');
    expect(parseBoxQr('fenrir:boite:')).toBeNull();
    expect(parseBoxQr('fenrir:boite:a b')).toBeNull();
    expect(parseBoxQr('https://exemple.fr')).toBeNull();
  });

  it('répartit un article entre boîtes sans changer le stock', async () => {
    const { db, repo, boxes } = await setup();
    const one = await boxes.create();
    const two = await boxes.create();
    const tuna = await repo.createItem(
      { name: 'Thon', category: 'food', unit: 'unit', caloriesPerUnit: 200 },
      { quantity: 10, expirationDate: '2027-01-01' },
    );
    await repo.addLot(tuna.id, { quantity: 14, expirationDate: '2028-06-01' });

    // Les lots qui périment le plus tard partent en boîte.
    await boxes.put(one.id, tuna.id, 6);
    await boxes.put(two.id, tuna.id, 10);
    expect(await boxes.contents(one.id)).toEqual([
      expect.objectContaining({
        name: 'Thon',
        quantity: 6,
        nextExpiration: '2028-06-01',
      }),
    ]);
    expect((await boxes.contents(two.id))[0]).toMatchObject({
      quantity: 10,
      nextExpiration: '2027-01-01',
    });
    const [candidate] = await boxes.candidates(one.id);
    expect(candidate).toMatchObject({ loose: 8, inBox: 6 });
    await expect(boxes.put(one.id, tuna.id, 9)).rejects.toThrow(
      'Quantité insuffisante',
    );

    // Fiche et total inchangés ; le stock de la maison compte tout.
    const [item] = await repo.listItems({ bag: 'none' });
    expect(item.totalQuantity).toBe(24);
    const lots = await loadConsumableLots(db);
    expect(lots.reduce((sum, l) => sum + l.quantity, 0)).toBe(24);

    // On consomme d'abord hors boîte.
    await repo.consume(tuna.id, 8);
    expect((await boxes.contents(one.id))[0].quantity).toBe(6);
    expect((await boxes.contents(two.id))[0].quantity).toBe(10);

    // Sortir de la boîte puis remettre ne crée pas de lots en double.
    await boxes.take(one.id, tuna.id, 2);
    await boxes.put(one.id, tuna.id, 2);
    const { lots: after } = await repo.getItem(tuna.id);
    expect(after).toHaveLength(3);

    const summary = await boxes.summary(one.id);
    expect(summary).toMatchObject({
      labelNo: 1,
      itemCount: 1,
      nextExpiration: '2028-06-01',
    });

    // Supprimer la boîte remet son contenu hors boîte.
    await boxes.delete(two.id);
    expect((await boxes.candidates(one.id))[0]).toMatchObject({
      loose: 10,
      inBox: 6,
    });
    expect((await repo.listItems())[0].totalQuantity).toBe(16);
  });

  it('ne met en boîte ni le périmé ni le contenu des sacs', async () => {
    const { db, repo, boxes } = await setup();
    const box = await boxes.create();
    const bag = await new BagRepository(db).create({ name: 'Sac' });
    await repo.createItem(
      { name: 'Barres', category: 'food', unit: 'unit', bagId: bag.id },
      { quantity: 4 },
    );
    const old = await repo.createItem(
      { name: 'Biscuits', category: 'food', unit: 'unit' },
      { quantity: 3, expirationDate: '2026-01-01', acquiredAt: '2025-01-01' },
    );
    expect(await boxes.candidates(box.id)).toEqual([]);
    await expect(boxes.put(box.id, old.id, 1)).rejects.toThrow(
      'Quantité insuffisante',
    );
    await expect(boxes.summary('inconnue')).rejects.toThrow(
      'Boîte introuvable',
    );
  });
});
