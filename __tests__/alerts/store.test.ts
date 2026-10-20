import {
  loadAlertCache,
  refreshAlerts,
  saveAlertSettings,
} from '../../src/alerts/store';
import type { AlertFetch } from '../../src/alerts/types';
import { prepareDatabase } from '../../src/db/connection';
import { NodeSqliteDb } from '../db/sqlite';

const meteo = {
  warnings: [
    {
      alert: {
        info: [
          {
            language: 'fr-FR',
            parameter: [
              { valueName: 'awareness_level', value: '3; orange; Severe' },
              { valueName: 'awareness_type', value: '13; rain-flood' },
            ],
            area: [{ areaDesc: 'Gard' }],
            expires: '2026-10-22T00:00:00+00:00',
          },
        ],
      },
    },
  ],
};

function fakeFetch(fail = false) {
  const calls: string[] = [];
  const fetch: AlertFetch = async url => {
    calls.push(url);
    if (fail) {
      throw new Error('Délai dépassé');
    }
    const body = url.includes('meteoalarm')
      ? meteo
      : url.includes('vigieau')
      ? [{ code: '30', niveauGraviteMax: 'alerte_renforcee' }]
      : url.includes('ecogaz')
      ? { results: [] }
      : [];
    return { ok: true, status: 200, text: async () => JSON.stringify(body) };
  };
  return { fetch, calls };
}

async function setup() {
  const db = new NodeSqliteDb();
  await prepareDatabase(db);
  return db;
}

describe('relevé des alertes', () => {
  it('ne télécharge rien tant que les alertes sont désactivées', async () => {
    const db = await setup();
    const { fetch, calls } = fakeFetch();
    expect(await refreshAlerts(db, fetch)).toEqual([]);
    expect(calls).toEqual([]);
  });

  it('relève chaque source à son rythme et garde le dernier relevé hors ligne', async () => {
    const db = await setup();
    await saveAlertSettings(db, { enabled: true, departments: ['30'] });
    const now = new Date('2026-10-20T19:30:00Z');
    const online = fakeFetch();
    const alerts = await refreshAlerts(db, online.fetch, { now });
    expect(alerts.map(a => [a.title, a.level])).toEqual([
      ['Vigilance orange pluie-inondation', 'orange'],
      ['Restrictions d’eau : alerte renforcée', 'orange'],
    ]);
    // Ni stock à code-barres ni domicile : rappels, médicaments et séismes
    // ne sont pas demandés.
    expect(online.calls.some(u => u.includes('rappelconso'))).toBe(false);
    expect(online.calls.some(u => u.includes('seismicportal'))).toBe(false);
    expect(online.calls.some(u => u.includes('startswith'))).toBe(true);

    // Dix minutes plus tard : rien n'est dû.
    const again = fakeFetch();
    await refreshAlerts(db, again.fetch, {
      now: new Date(now.getTime() + 10 * 60_000),
    });
    expect(again.calls).toEqual([]);

    // Une heure plus tard, hors ligne : l'alerte reste, l'erreur est notée.
    const offline = fakeFetch(true);
    const kept = await refreshAlerts(db, offline.fetch, {
      now: new Date(now.getTime() + 60 * 60_000),
    });
    expect(kept).toHaveLength(2);
    const cache = await loadAlertCache(db);
    expect(cache.feeds.meteo?.error).toBe('Délai dépassé');
    expect(cache.feeds.meteo?.at).toBe(now.toISOString());

    // Désactivées : le relevé est effacé.
    await saveAlertSettings(db, { enabled: false, departments: ['30'] });
    expect((await loadAlertCache(db)).feeds).toEqual({});
  });
});
