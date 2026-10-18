import { prepareDatabase } from '../../src/db/connection';
import {
  emptyPlan,
  isPlanEmpty,
  loadFamilyPlan,
  PlanError,
  saveFamilyPlan,
} from '../../src/plan/familyPlan';
import { NodeSqliteDb } from '../db/sqlite';

async function freshDb() {
  const db = new NodeSqliteDb();
  await prepareDatabase(db);
  return db;
}

describe('plan familial', () => {
  it('enregistre, nettoie et relit le plan', async () => {
    const db = await freshDb();
    expect(isPlanEmpty(await loadFamilyPlan(db))).toBe(true);
    await saveFamilyPlan(db, {
      ...emptyPlan(),
      contacts: [
        {
          name: ' Paul ',
          phone: '06 12 34 56 78',
          relation: 'frère',
          outOfArea: true,
        },
        { name: '', phone: '', relation: '', outOfArea: false },
      ],
      meetingNear: { place: 'Parking de l’école', position: '' },
      shutoffGas: 'Garage',
      lastDrill: '2026-03-15',
    });
    const plan = await loadFamilyPlan(db);
    expect(plan.contacts).toEqual([
      {
        name: 'Paul',
        phone: '06 12 34 56 78',
        relation: 'frère',
        outOfArea: true,
      },
    ]);
    expect(plan.meetingNear.place).toBe('Parking de l’école');
    expect(plan.lastDrill).toBe('2026-03-15');
    expect(isPlanEmpty(plan)).toBe(false);
  });

  it('refuse un numéro ou une date invalides', async () => {
    const db = await freshDb();
    await expect(
      saveFamilyPlan(db, {
        ...emptyPlan(),
        contacts: [{ name: 'X', phone: 'abc', relation: '', outOfArea: false }],
      }),
    ).rejects.toBeInstanceOf(PlanError);
    await expect(
      saveFamilyPlan(db, { ...emptyPlan(), lastDrill: '2026-02-30' }),
    ).rejects.toMatchObject({ field: 'lastDrill' });
  });
});
