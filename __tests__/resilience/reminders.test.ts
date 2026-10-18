import { prepareDatabase } from '../../src/db/connection';
import { BagRepository, InventoryRepository } from '../../src/inventory';
import { addDays } from '../../src/lib/dates';
import {
  getExpiryAlerts,
  getResilienceReport,
} from '../../src/resilience/resilienceCalculator';
import {
  REMINDER_MAX,
  loadRemindersEnabled,
  reminderTimes,
  saveRemindersEnabled,
  syncReminders,
  type ReminderScheduler,
} from '../../src/resilience/reminders';
import { NodeSqliteDb } from '../db/sqlite';

const TODAY = '2026-10-15';
// 8 h, heure locale : les rappels du jour (9 h) sont encore à venir.
const NOW = new Date(2026, 9, 15, 8, 0, 0);
const in_ = (days: number) => addDays(TODAY, days);
const at9 = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d, 9, 0, 0).getTime();
};

async function setup() {
  const db = new NodeSqliteDb();
  await prepareDatabase(db);
  const repo = new InventoryRepository(db, { today: () => TODAY });
  const bags = new BagRepository(db, { today: () => TODAY });
  return { db, repo, bags };
}

function fakeScheduler() {
  const calls: Array<readonly number[] | 'cancel'> = [];
  const scheduler: ReminderScheduler = {
    available: true,
    requestPermission: async () => true,
    schedule: async times => {
      calls.push(times);
    },
    cancelAll: async () => {
      calls.push('cancel');
    },
  };
  return { scheduler, calls };
}

describe('rappels de péremption', () => {
  it('prévoit un rappel au seuil d’alerte et un le jour de la péremption', async () => {
    const { db, repo } = await setup();
    await repo.createItem(
      { name: 'Riz', category: 'food', unit: 'kg' },
      { quantity: 2, expirationDate: in_(40) },
    );
    await repo.createItem(
      { name: 'Lait', category: 'food', unit: 'L', alertDays: 5 },
      { quantity: 1, expirationDate: in_(12) },
    );
    // Seuil déjà dépassé : seul le jour de la péremption reste à venir.
    await repo.createItem(
      { name: 'Compote', category: 'food', unit: 'unit' },
      { quantity: 4, expirationDate: in_(3) },
    );
    // Déjà périmé, vide ou sans date : aucun rappel.
    await repo.createItem(
      { name: 'Pain', category: 'food', unit: 'unit' },
      { quantity: 1, expirationDate: in_(-2) },
    );
    await repo.createItem(
      { name: 'Sel', category: 'food', unit: 'kg' },
      { quantity: 1 },
    );

    expect(await reminderTimes(db, NOW)).toEqual([
      at9(in_(3)),
      at9(in_(7)),
      at9(in_(10)),
      at9(in_(12)),
      at9(in_(40)),
    ]);
  });

  it('ne garde que les prochains rappels, sans doublon', async () => {
    const { db, repo } = await setup();
    for (let i = 0; i < REMINDER_MAX; i++) {
      await repo.createItem(
        { name: `Lot ${i}`, category: 'food', unit: 'unit' },
        { quantity: 1, expirationDate: in_(31 + i) },
      );
    }
    await repo.createItem(
      { name: 'Double', category: 'food', unit: 'unit' },
      { quantity: 1, expirationDate: in_(31) },
    );
    const times = await reminderTimes(db, NOW);
    expect(times).toHaveLength(REMINDER_MAX);
    expect(new Set(times).size).toBe(REMINDER_MAX);
    expect(times[0]).toBe(at9(in_(1)));
  });

  it('suit le réglage : programme si activé, annule sinon', async () => {
    const { db, repo } = await setup();
    await repo.createItem(
      { name: 'Riz', category: 'food', unit: 'kg' },
      { quantity: 2, expirationDate: in_(40) },
    );
    const { scheduler, calls } = fakeScheduler();
    expect(await loadRemindersEnabled(db)).toBe(false);
    await syncReminders(db, scheduler, NOW);
    expect(calls).toEqual(['cancel']);

    await saveRemindersEnabled(db, true);
    await syncReminders(db, scheduler, NOW);
    expect(calls[1]).toEqual([at9(in_(10)), at9(in_(40))]);
  });

  it('ne fait rien sans service de rappels sur l’appareil', async () => {
    const { db } = await setup();
    const { scheduler, calls } = fakeScheduler();
    await saveRemindersEnabled(db, true);
    await syncReminders(db, { ...scheduler, available: false }, NOW);
    expect(calls).toEqual([]);
  });
});

describe('sacs d’évacuation', () => {
  it('range le contenu à part, hors autonomie, avec ses péremptions', async () => {
    const { db, repo, bags } = await setup();
    const bag = await bags.create({ name: 'Sac de Léa', owner: 'Léa' });
    await repo.createItem(
      { name: 'Eau du cellier', category: 'water', unit: 'L' },
      { quantity: 9 },
    );
    await repo.createItem(
      { name: 'Gourde', category: 'water', unit: 'L', bagId: bag.id },
      { quantity: 2 },
    );
    await repo.createItem(
      { name: 'Barres', category: 'food', unit: 'unit', bagId: bag.id },
      { quantity: 4, expirationDate: in_(10) },
    );
    await repo.createItem(
      { name: 'Compote', category: 'food', unit: 'unit', bagId: bag.id },
      { quantity: 2, expirationDate: in_(-1) },
    );

    expect((await repo.listItems({ bag: 'none' })).map(i => i.name)).toEqual([
      'Eau du cellier',
    ]);
    expect((await repo.listItems({ bag: bag.id })).map(i => i.name)).toEqual([
      'Barres',
      'Compote',
      'Gourde',
    ]);

    // L'autonomie du foyer ne compte que le stock général (9 L).
    const report = await getResilienceReport(db, TODAY);
    expect(report.water.available).toBe(9);

    const [summary] = await bags.list();
    expect(summary).toMatchObject({
      name: 'Sac de Léa',
      owner: 'Léa',
      itemCount: 3,
      expiredLots: 1,
      soonLots: 1,
      nextExpiration: in_(10),
    });

    // Les alertes nomment le sac.
    const alerts = await getExpiryAlerts(db, TODAY);
    expect(alerts.map(a => [a.itemName, a.bagName])).toEqual([
      ['Compote', 'Sac de Léa'],
      ['Barres', 'Sac de Léa'],
    ]);
  });

  it('garde le sac à la modification et rend le contenu au stock à la suppression', async () => {
    const { repo, bags } = await setup();
    const bag = await bags.create({ name: 'Sac voiture' });
    const item = await repo.createItem(
      { name: 'Lampe', category: 'energy', unit: 'unit', bagId: bag.id },
      { quantity: 1 },
    );
    const renamed = await repo.updateItem(item.id, { name: 'Lampe frontale' });
    expect(renamed.bagId).toBe(bag.id);

    await expect(bags.create({ name: '  ' })).rejects.toThrow(
      'Champ obligatoire',
    );
    await bags.update(bag.id, { name: 'Sac du coffre', owner: 'Voiture' });
    expect((await bags.get(bag.id)).name).toBe('Sac du coffre');

    await bags.delete(bag.id);
    expect(await bags.list()).toEqual([]);
    expect((await repo.getItem(item.id)).item.bagId).toBeNull();
  });
});
