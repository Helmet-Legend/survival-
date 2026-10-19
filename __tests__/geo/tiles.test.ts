import { prepareDatabase } from '../../src/db/connection';
import {
  AREA_RADII,
  downloadArea,
  formatBytes,
  IGN_PLAN,
  MapTileStore,
  planArea,
  project,
  unproject,
} from '../../src/geo/tiles';
import { NodeSqliteDb } from '../db/sqlite';

async function freshStore() {
  const db = new NodeSqliteDb();
  await prepareDatabase(db);
  let n = 0;
  return { db, store: new MapTileStore(db, { newId: () => `area-${++n}` }) };
}

const CHAMONIX = { latitude: 45.92, longitude: 6.87 };

describe('cartes hors ligne', () => {
  it('projette et retrouve une position', () => {
    const p = project(CHAMONIX, 14);
    expect(Math.floor(p.x / 256)).toBe(8504);
    const back = unproject(p.x, p.y, 14);
    expect(back.latitude).toBeCloseTo(CHAMONIX.latitude, 9);
    expect(back.longitude).toBeCloseTo(CHAMONIX.longitude, 9);
  });

  it('compte les tuiles d’une zone et reste sous la limite', () => {
    const plan = planArea(CHAMONIX, 2, 17);
    expect(plan.ranges[0].z).toBe(8);
    expect(plan.ranges[plan.ranges.length - 1].z).toBe(17);
    expect(plan.tiles).toBeGreaterThan(300);
    for (const { km, maxZoom } of AREA_RADII) {
      expect(planArea(CHAMONIX, km, maxZoom).tiles).toBeLessThan(8000);
    }
    expect(formatBytes(2_400_000)).toBe('2,4 Mo');
    expect(formatBytes(800)).toBe('1 Ko');
  });

  it('construit l’adresse WMTS du Plan IGN', () => {
    expect(IGN_PLAN.url(14, 8504, 5843)).toContain(
      'TILEMATRIX=14&TILEROW=5843&TILECOL=8504',
    );
  });

  it('télécharge une zone, saute les tuiles déjà là et agrandit un ancêtre', async () => {
    const { store } = await freshStore();
    const area = await store.createArea({
      label: 'Chamonix',
      center: CHAMONIX,
      radiusKm: 1,
      maxZoom: 12,
      source: IGN_PLAN,
    });
    const urls: string[] = [];
    const fetchTile = async (url: string) => {
      urls.push(url);
      return 'data:image/png;base64,AAAA';
    };
    const progress = await downloadArea(store, area, IGN_PLAN, fetchTile);
    expect(progress.failed).toBe(0);
    expect(progress.done).toBe(progress.total);
    expect(urls).toHaveLength(progress.total);
    const [saved] = await store.listAreas();
    expect(saved).toMatchObject({ complete: true, tiles: progress.total });

    urls.length = 0;
    await downloadArea(store, area, IGN_PLAN, fetchTile);
    expect(urls).toHaveLength(0);

    const p = project(CHAMONIX, 14);
    const found = await store.findTile(
      14,
      Math.floor(p.x / 256),
      Math.floor(p.y / 256),
    );
    expect(found).toMatchObject({ up: 2, data: 'data:image/png;base64,AAAA' });
    expect(await store.storedBytes()).toBeGreaterThan(0);
  });

  it('s’arrête sans réseau', async () => {
    const { store } = await freshStore();
    const area = await store.createArea({
      label: 'Zone',
      center: CHAMONIX,
      radiusKm: 2,
      maxZoom: 13,
      source: IGN_PLAN,
    });
    await expect(
      downloadArea(store, area, IGN_PLAN, async () => {
        throw new Error('offline');
      }),
    ).rejects.toThrow('vérifiez la connexion');
    expect((await store.listAreas())[0].complete).toBe(false);
  });

  it('supprime une zone sans toucher aux tuiles d’une autre', async () => {
    const { store } = await freshStore();
    const fetchTile = async () => 'data:image/png;base64,AAAA';
    const a = await store.createArea({
      label: 'A',
      center: CHAMONIX,
      radiusKm: 1,
      maxZoom: 11,
      source: IGN_PLAN,
    });
    await downloadArea(store, a, IGN_PLAN, fetchTile);
    const b = await store.createArea({
      label: 'B',
      center: { latitude: 48.85, longitude: 2.35 },
      radiusKm: 1,
      maxZoom: 11,
      source: IGN_PLAN,
    });
    await downloadArea(store, b, IGN_PLAN, fetchTile);
    await store.deleteArea(a.id);
    const pa = project(CHAMONIX, 11);
    const pb = project({ latitude: 48.85, longitude: 2.35 }, 11);
    expect(
      await store.hasTile(11, Math.floor(pa.x / 256), Math.floor(pa.y / 256)),
    ).toBe(false);
    expect(
      await store.hasTile(11, Math.floor(pb.x / 256), Math.floor(pb.y / 256)),
    ).toBe(true);
    // Au zoom 8, les deux zones partagent peut-être des tuiles : B garde les siennes.
    const pb8 = project({ latitude: 48.85, longitude: 2.35 }, 8);
    expect(
      await store.hasTile(8, Math.floor(pb8.x / 256), Math.floor(pb8.y / 256)),
    ).toBe(true);
    expect((await store.listAreas()).map(x => x.label)).toEqual(['B']);
  });
});
