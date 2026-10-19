import { prepareDatabase } from '../../src/db/connection';
import {
  cardinal,
  describeFrom,
  formatDistance,
  planWaypoints,
  waypointMessage,
  WaypointRepository,
} from '../../src/geo/waypoints';
import { emptyPlan } from '../../src/plan/familyPlan';
import { NodeSqliteDb } from '../db/sqlite';

async function freshDb() {
  const db = new NodeSqliteDb();
  await prepareDatabase(db);
  return db;
}

describe('points de repère', () => {
  it('enregistre, modifie et supprime un point', async () => {
    const repo = new WaypointRepository(await freshDb());
    const home = await repo.create({
      label: '  Maison ',
      type: 'home',
      latitude: 45.83265,
      longitude: 6.86518,
      notes: '',
    });
    expect(home).toMatchObject({ label: 'Maison', type: 'home', notes: null });
    const source = await repo.create({
      label: 'Source du bois',
      type: 'water_source',
      latitude: 45.84,
      longitude: 6.87,
    });
    expect((await repo.list()).map(p => p.id).sort()).toEqual(
      [home.id, source.id].sort(),
    );
    const moved = await repo.update(source.id, {
      label: 'Source',
      type: 'water_source',
      latitude: 45.85,
      longitude: 6.87,
      notes: 'Débit faible en août',
    });
    expect(moved).toMatchObject({
      latitude: 45.85,
      notes: 'Débit faible en août',
    });
    await repo.remove(home.id);
    expect((await repo.list()).map(p => p.label)).toEqual(['Source']);
  });

  it('refuse un nom vide, une latitude impossible ou un type inconnu', async () => {
    const repo = new WaypointRepository(await freshDb());
    const base = {
      label: 'A',
      type: 'other' as const,
      latitude: 1,
      longitude: 1,
    };
    await expect(repo.create({ ...base, label: ' ' })).rejects.toThrow(
      'Champ obligatoire',
    );
    await expect(repo.create({ ...base, latitude: 91 })).rejects.toThrow(
      /Latitude/,
    );
    await expect(
      repo.create({ ...base, type: 'bunker' as never }),
    ).rejects.toThrow('Type inconnu');
  });

  it('garde les anciens points à la migration', async () => {
    const db = await freshDb();
    await db.execute(
      `INSERT INTO poi_locations (id, label, latitude, longitude, type)
       VALUES ('p', 'Cache', 45, 6, 'cache')`,
    );
    expect((await new WaypointRepository(db).list())[0].type).toBe('cache');
  });

  it('reprend les points de regroupement MGRS du plan familial', () => {
    const plan = emptyPlan();
    plan.meetingNear = {
      place: 'Parking de l’école',
      position: '32T LR 34199 77670',
    };
    plan.meetingFar = { place: 'Chez Paul', position: 'devant la mairie' };
    const points = planWaypoints(plan);
    expect(points).toHaveLength(1);
    expect(points[0]).toMatchObject({
      label: 'Parking de l’école',
      type: 'meeting',
      fromPlan: true,
    });
    expect(points[0].latitude).toBeCloseTo(45.83265, 4);
  });

  it('décrit distance et direction', () => {
    expect(cardinal(48)).toBe('nord-est');
    expect(cardinal(359)).toBe('nord');
    expect(cardinal(200, true)).toBe('S');
    expect(formatDistance(640.4)).toBe('640 m');
    expect(formatDistance(1234)).toBe('1,2 km');
    expect(formatDistance(23_600)).toBe('24 km');
    expect(
      describeFrom(
        { latitude: 45, longitude: 6 },
        { latitude: 45.01, longitude: 6 },
      ),
    ).toBe('1,1 km · nord (0°)');
    expect(
      waypointMessage({
        id: 'x',
        label: 'Maison',
        type: 'home',
        notes: null,
        createdAt: '',
        latitude: 45.83265,
        longitude: 6.86518,
      }),
    ).toBe('Maison : 45.83265, 6.86518 · MGRS 32T LR 34199 77670');
  });
});
