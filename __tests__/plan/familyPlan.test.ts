import { prepareDatabase } from '../../src/db/connection';
import {
  emptyPlan,
  isPlanEmpty,
  loadFamilyPlan,
  PlanError,
  planText,
  PMR446_CHANNELS,
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

  it('met le plan en texte, sans les rubriques vides', () => {
    const text = planText({
      ...emptyPlan(),
      contacts: [
        {
          name: 'Paul',
          phone: '06 12 34 56 78',
          relation: 'frère',
          outOfArea: true,
        },
      ],
      meetingFar: { place: 'Chez Paul', position: '31U DQ 48251 11932' },
      shutoffGas: 'Garage',
      lastDrill: '2026-03-15',
    });
    expect(text).toBe(
      [
        'PLAN FAMILIAL',
        'CONTACTS\n- Paul (frère) : 06 12 34 56 78 · hors zone',
        'POINTS DE REGROUPEMENT\nHors du quartier : Chez Paul (31U DQ 48251 11932)',
        'COUPURES\nGaz : Garage',
        'Dernier exercice : 15/03/2026',
        'Urgences : 112 · SAMU 15 · Pompiers 18 · Police 17 · SMS 114',
      ].join('\n\n'),
    );
  });

  it('garde le plan PACE et liste les 16 canaux PMR446', async () => {
    const db = await freshDb();
    await saveFamilyPlan(db, {
      ...emptyPlan(),
      comms: {
        ...emptyPlan().comms,
        primary: ' Téléphone ',
        contingency: 'Talkie PMR446',
        radio: 'Canal 8, CTCSS 12',
      },
    });
    const plan = await loadFamilyPlan(db);
    expect(plan.comms.primary).toBe('Téléphone');
    expect(isPlanEmpty(plan)).toBe(false);
    expect(planText(plan)).toContain(
      'COMMUNICATION\n1. Principal : Téléphone\n3. Secours : Talkie PMR446\nRadio : Canal 8, CTCSS 12',
    );
    expect(PMR446_CHANNELS).toHaveLength(16);
    expect(PMR446_CHANNELS[0]).toEqual({ channel: 1, mhz: '446,00625' });
    expect(PMR446_CHANNELS[15]).toEqual({ channel: 16, mhz: '446,19375' });
  });

  it('relit un ancien plan sans communication', async () => {
    const db = await freshDb();
    await db.execute('INSERT INTO family_plan (id, data) VALUES (1, ?)', [
      JSON.stringify({ routes: 'Par la D12' }),
    ]);
    const plan = await loadFamilyPlan(db);
    expect(plan.routes).toBe('Par la D12');
    expect(plan.comms.primary).toBe('');
  });
});
