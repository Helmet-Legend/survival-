/**
 * Réglages et relevés des alertes. Désactivées par défaut : rien n'est
 * téléchargé tant que l'utilisateur ne les a pas activées. Chaque source a
 * son rythme ; une source injoignable garde son dernier relevé, daté.
 */
import type { SqlDatabase } from '../db/types';
import type { LatLon } from '../geo/geoConverter';
import { localToday } from '../lib/dates';
import { parseMeteo, METEO_URL } from './meteo';
import { MEDICINE_DISPO_URL, parseMedicineDispo } from './medicines';
import { parseQuakes, quakeUrl } from './quakes';
import {
  parseRecalls,
  RECALL_DAYS,
  recallUrl,
  type StockCode,
} from './recalls';
import {
  fuelUrl,
  GAS_URL,
  parseFuel,
  parseGas,
  parseWater,
  WATER_URL,
} from './supply';
import { sortAlerts, type Alert, type AlertFetch } from './types';

const KEY_ENABLED = 'alerts_enabled';
const KEY_DEPARTMENTS = 'alerts_departments';
const KEY_CACHE = 'alerts_cache';

export interface AlertSettings {
  enabled: boolean;
  departments: string[];
}

export type FeedId =
  | 'meteo'
  | 'recalls'
  | 'medicines'
  | 'quakes'
  | 'water'
  | 'gas'
  | 'fuel';

/** Nom affiché, et intervalle minimal entre deux téléchargements. */
export const FEEDS: Record<FeedId, { label: string; minutes: number }> = {
  meteo: {
    label: 'Vigilance météo (Météo-France via MeteoAlarm)',
    minutes: 30,
  },
  recalls: { label: 'Rappels de produits (RappelConso)', minutes: 360 },
  medicines: { label: 'Ruptures de médicaments (ANSM)', minutes: 720 },
  quakes: { label: 'Séismes (EMSC, RéNaSS)', minutes: 30 },
  water: { label: 'Restrictions d’eau (VigiEau)', minutes: 720 },
  gas: { label: 'Signal gaz (Ecogaz)', minutes: 360 },
  fuel: { label: 'Carburants (prix-carburants.gouv.fr)', minutes: 60 },
};

export interface FeedState {
  /** Dernier relevé réussi. */
  at: string | null;
  /** Dernière tentative, réussie ou non. */
  tried: string | null;
  error: string | null;
  alerts: Alert[];
}

export interface AlertCache {
  feeds: Partial<Record<FeedId, FeedState>>;
}

async function readSetting(
  db: SqlDatabase,
  key: string,
): Promise<string | null> {
  const { rows } = await db.execute(
    'SELECT value FROM settings WHERE key = ?',
    [key],
  );
  return rows.length === 0 ? null : String(rows[0].value);
}

async function writeSetting(
  db: SqlDatabase,
  key: string,
  value: string,
): Promise<void> {
  await db.execute(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
    [key, value],
  );
}

export async function loadAlertSettings(
  db: SqlDatabase,
): Promise<AlertSettings> {
  const [enabled, departments] = await Promise.all([
    readSetting(db, KEY_ENABLED),
    readSetting(db, KEY_DEPARTMENTS),
  ]);
  return {
    enabled: enabled === 'on',
    departments: (departments ?? '').split(',').filter(Boolean),
  };
}

export async function saveAlertSettings(
  db: SqlDatabase,
  settings: AlertSettings,
): Promise<void> {
  await writeSetting(db, KEY_ENABLED, settings.enabled ? 'on' : 'off');
  await writeSetting(db, KEY_DEPARTMENTS, settings.departments.join(','));
  if (!settings.enabled) {
    // Désactivées : plus rien d'affiché ni de gardé.
    await db.execute('DELETE FROM settings WHERE key = ?', [KEY_CACHE]);
  }
}

export async function loadAlertCache(db: SqlDatabase): Promise<AlertCache> {
  const raw = await readSetting(db, KEY_CACHE);
  if (raw === null) {
    return { feeds: {} };
  }
  try {
    const parsed = JSON.parse(raw) as AlertCache;
    return { feeds: parsed.feeds ?? {} };
  } catch {
    return { feeds: {} };
  }
}

/** Toutes les alertes en cours, les plus graves d'abord. */
export function currentAlerts(cache: AlertCache, now: Date): Alert[] {
  const iso = now.toISOString();
  const all = Object.values(cache.feeds).flatMap(f => f?.alerts ?? []);
  return sortAlerts(
    all.filter(a => a.end === null || a.end.length <= 10 || a.end > iso),
  );
}

/** Codes-barres des articles encore en stock. */
async function stockCodes(db: SqlDatabase): Promise<StockCode[]> {
  const { rows } = await db.execute(
    `SELECT b.code, i.id, i.name
       FROM barcode_products AS b
       JOIN inventory_items AS i ON i.id = b.item_id
      WHERE EXISTS (SELECT 1 FROM inventory_lots AS l
                     WHERE l.item_id = i.id AND l.quantity > 0)`,
  );
  return rows.map(r => ({
    code: String(r.code),
    itemId: String(r.id),
    itemName: String(r.name),
  }));
}

/** Premier point « Domicile » enregistré, pour les séismes. */
async function homePoint(db: SqlDatabase): Promise<LatLon | null> {
  const { rows } = await db.execute(
    `SELECT latitude, longitude FROM poi_locations
      WHERE type = 'home' ORDER BY created_at LIMIT 1`,
  );
  return rows.length === 0
    ? null
    : {
        latitude: Number(rows[0].latitude),
        longitude: Number(rows[0].longitude),
      };
}

async function getText(fetch: AlertFetch, url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return response.text();
}

async function getJson(fetch: AlertFetch, url: string): Promise<unknown> {
  return JSON.parse(await getText(fetch, url));
}

function daysAgo(now: Date, days: number): string {
  return new Date(now.getTime() - days * 86_400_000).toISOString().slice(0, 10);
}

/**
 * Télécharge les sources dont le dernier relevé est trop ancien (ou toutes
 * avec `force`) et garde le résultat. Ne fait rien si les alertes sont
 * désactivées. Renvoie les alertes en cours.
 */
export async function refreshAlerts(
  db: SqlDatabase,
  fetch: AlertFetch,
  options: { now?: Date; force?: boolean } = {},
): Promise<Alert[]> {
  const now = options.now ?? new Date();
  const settings = await loadAlertSettings(db);
  if (!settings.enabled) {
    return [];
  }
  const cache = await loadAlertCache(db);
  const today = localToday(now);
  const deps = settings.departments;
  const due = (id: FeedId) => {
    const tried = cache.feeds[id]?.tried;
    return (
      options.force === true ||
      tried === null ||
      tried === undefined ||
      now.getTime() - new Date(tried).getTime() >= FEEDS[id].minutes * 60_000
    );
  };
  const [stock, home] = await Promise.all([stockCodes(db), homePoint(db)]);
  const tasks: Record<FeedId, () => Promise<Alert[]>> = {
    meteo: async () => parseMeteo(await getJson(fetch, METEO_URL), deps, now),
    recalls: async () =>
      stock.length === 0
        ? []
        : parseRecalls(
            await getJson(fetch, recallUrl(daysAgo(now, RECALL_DAYS))),
            stock,
            today,
          ),
    medicines: async () =>
      stock.some(s => s.code.startsWith('340'))
        ? parseMedicineDispo(await getText(fetch, MEDICINE_DISPO_URL), stock)
        : [],
    quakes: async () =>
      home === null
        ? []
        : parseQuakes(await getJson(fetch, quakeUrl(daysAgo(now, 3))), home),
    water: async () =>
      deps.length === 0
        ? []
        : parseWater(await getJson(fetch, WATER_URL), deps),
    gas: async () => parseGas(await getJson(fetch, GAS_URL), today),
    fuel: async () => {
      const all: Alert[] = [];
      for (const d of deps) {
        all.push(...parseFuel(await getJson(fetch, fuelUrl(d)), d, now));
      }
      return all;
    },
  };
  const ids = (Object.keys(tasks) as FeedId[]).filter(due);
  const results = await Promise.all(
    ids.map(async id => {
      try {
        return [id, { alerts: await tasks[id](), error: null }] as const;
      } catch (e) {
        return [
          id,
          { alerts: null, error: e instanceof Error ? e.message : String(e) },
        ] as const;
      }
    }),
  );
  const stamp = now.toISOString();
  for (const [id, r] of results) {
    const previous = cache.feeds[id];
    cache.feeds[id] =
      r.alerts === null
        ? {
            at: previous?.at ?? null,
            tried: stamp,
            error: r.error,
            alerts: previous?.alerts ?? [],
          }
        : { at: stamp, tried: stamp, error: null, alerts: r.alerts };
  }
  if (ids.length > 0) {
    await writeSetting(db, KEY_CACHE, JSON.stringify(cache));
  }
  return currentAlerts(cache, now);
}
