/**
 * Cartes hors ligne : tuiles « Web Mercator » (z/x/y) téléchargées une fois
 * pour une zone, puis lues dans le coffre sans réseau.
 *
 * Source : Plan IGN (Géoplateforme de l'IGN), données ouvertes sous licence
 * Etalab 2.0, qui couvre la France métropolitaine et l'outre-mer. Les
 * serveurs OpenStreetMap interdisent le téléchargement de zones entières ;
 * ils ne sont donc pas utilisés.
 */
import type { SqlDatabase, SqlRow } from '../db/types';
import { randomUuid } from '../inventory/inventoryRepository';
import type { LatLon } from './geoConverter';

export interface MapSource {
  id: string;
  label: string;
  attribution: string;
  /** Zoom le plus fin proposé par le serveur. */
  maxZoom: number;
  url(z: number, x: number, y: number): string;
}

export const IGN_PLAN: MapSource = {
  id: 'ign-plan',
  label: 'Plan IGN',
  attribution: '© IGN – Plan IGN, licence ouverte Etalab 2.0',
  maxZoom: 19,
  url: (z, x, y) =>
    'https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0' +
    '&LAYER=GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2&STYLE=normal&TILEMATRIXSET=PM' +
    `&FORMAT=image/png&TILEMATRIX=${z}&TILEROW=${y}&TILECOL=${x}`,
};

export const TILE_SIZE = 256;
/** Latitude limite de la projection Web Mercator. */
export const MERCATOR_MAX_LAT = 85.0511;
/** Zoom le plus large téléchargé : la région entière tient sur l'écran. */
export const AREA_MIN_ZOOM = 8;
/** Garde-fou : au-delà, la zone est trop grande pour un téléphone. */
export const AREA_MAX_TILES = 8000;
/** Taille moyenne observée d'une tuile Plan IGN, pour l'estimation seule. */
const ESTIMATED_TILE_BYTES = 20_000;

/** Rayons proposés et zoom le plus fin associé (détail des rues à 2 km). */
export const AREA_RADII: ReadonlyArray<{ km: number; maxZoom: number }> = [
  { km: 2, maxZoom: 17 },
  { km: 5, maxZoom: 16 },
  { km: 10, maxZoom: 15 },
  { km: 25, maxZoom: 14 },
];

// --- Projection -------------------------------------------------------------

function clampLat(latitude: number): number {
  return Math.max(-MERCATOR_MAX_LAT, Math.min(MERCATOR_MAX_LAT, latitude));
}

/** Position en pixels « monde » au zoom `z` (tuiles de 256 px). */
export function project(point: LatLon, z: number): { x: number; y: number } {
  const scale = TILE_SIZE * 2 ** z;
  const lat = (clampLat(point.latitude) * Math.PI) / 180;
  return {
    x: ((point.longitude + 180) / 360) * scale,
    y:
      ((1 - Math.log(Math.tan(lat) + 1 / Math.cos(lat)) / Math.PI) / 2) * scale,
  };
}

/** Inverse de `project`. */
export function unproject(x: number, y: number, z: number): LatLon {
  const scale = TILE_SIZE * 2 ** z;
  const n = Math.PI - (2 * Math.PI * y) / scale;
  return {
    latitude: (180 / Math.PI) * Math.atan(Math.sinh(n)),
    longitude: (x / scale) * 360 - 180,
  };
}

/** Mètres par pixel à cette latitude et ce zoom. */
export function metersPerPixel(latitude: number, z: number): number {
  return (
    (40_075_016.686 * Math.cos((clampLat(latitude) * Math.PI) / 180)) /
    (TILE_SIZE * 2 ** z)
  );
}

// --- Zones ------------------------------------------------------------------

export interface TileRange {
  z: number;
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

export interface AreaPlan {
  ranges: TileRange[];
  tiles: number;
  /** Estimation de la place occupée, en octets. */
  estimatedBytes: number;
}

/** Tuiles couvrant le carré de `radiusKm` autour du centre, zoom par zoom. */
export function planArea(
  center: LatLon,
  radiusKm: number,
  maxZoom: number,
  minZoom = AREA_MIN_ZOOM,
): AreaPlan {
  const dLat = radiusKm / 110.574;
  const dLon =
    radiusKm /
    (111.32 * Math.max(0.01, Math.cos((center.latitude * Math.PI) / 180)));
  const north = clampLat(center.latitude + dLat);
  const south = clampLat(center.latitude - dLat);
  const west = Math.max(-180, center.longitude - dLon);
  const east = Math.min(179.9999, center.longitude + dLon);
  const ranges: TileRange[] = [];
  let tiles = 0;
  for (let z = Math.min(minZoom, maxZoom); z <= maxZoom; z++) {
    const nw = project({ latitude: north, longitude: west }, z);
    const se = project({ latitude: south, longitude: east }, z);
    const max = 2 ** z - 1;
    const range = {
      z,
      x0: Math.max(0, Math.floor(nw.x / TILE_SIZE)),
      x1: Math.min(max, Math.floor(se.x / TILE_SIZE)),
      y0: Math.max(0, Math.floor(nw.y / TILE_SIZE)),
      y1: Math.min(max, Math.floor(se.y / TILE_SIZE)),
    };
    ranges.push(range);
    tiles += (range.x1 - range.x0 + 1) * (range.y1 - range.y0 + 1);
  }
  return { ranges, tiles, estimatedBytes: tiles * ESTIMATED_TILE_BYTES };
}

export function formatBytes(bytes: number): string {
  if (bytes < 1_000_000) {
    return `${Math.max(1, Math.round(bytes / 1000))} Ko`;
  }
  const mb = bytes / 1_000_000;
  return `${(mb < 10 ? mb.toFixed(1) : String(Math.round(mb))).replace(
    '.',
    ',',
  )} Mo`;
}

// --- Stockage dans le coffre -----------------------------------------------

export interface MapArea extends LatLon {
  id: string;
  label: string;
  radiusKm: number;
  minZoom: number;
  maxZoom: number;
  source: string;
  /** Tuiles présentes une fois le téléchargement fini. */
  tiles: number;
  complete: boolean;
  createdAt: string;
}

function toArea(row: SqlRow): MapArea {
  return {
    id: String(row.id),
    label: String(row.label),
    latitude: Number(row.latitude),
    longitude: Number(row.longitude),
    radiusKm: Number(row.radius_km),
    minZoom: Number(row.min_zoom),
    maxZoom: Number(row.max_zoom),
    source: String(row.source),
    tiles: Number(row.tiles),
    complete: Number(row.complete) === 1,
    createdAt: String(row.created_at),
  };
}

export function areaPlan(area: MapArea): AreaPlan {
  return planArea(area, area.radiusKm, area.maxZoom, area.minZoom);
}

/** Tuile trouvée, éventuellement agrandie depuis un zoom plus large. */
export interface FoundTile {
  data: string;
  /** Niveaux remontés (0 : la tuile elle-même). */
  up: number;
  /** Position de la tuile demandée dans l'ancêtre, en fraction (0 à 1). */
  offsetX: number;
  offsetY: number;
}

export class MapTileStore {
  private readonly db: SqlDatabase;
  private readonly newId: () => string;

  constructor(db: SqlDatabase, options: { newId?: () => string } = {}) {
    this.db = db;
    this.newId = options.newId ?? randomUuid;
  }

  async getTile(z: number, x: number, y: number): Promise<string | null> {
    const { rows } = await this.db.execute(
      'SELECT data FROM map_tiles WHERE z = ? AND x = ? AND y = ?',
      [z, x, y],
    );
    return rows.length === 0 ? null : String(rows[0].data);
  }

  /**
   * La tuile, ou à défaut son ancêtre le plus proche (jusqu'à `maxUp`
   * niveaux) : la carte reste lisible en zoomant au-delà du téléchargement.
   */
  async findTile(
    z: number,
    x: number,
    y: number,
    maxUp = 6,
  ): Promise<FoundTile | null> {
    for (let up = 0; up <= Math.min(maxUp, z); up++) {
      const f = 2 ** up;
      const ax = Math.floor(x / f);
      const ay = Math.floor(y / f);
      const data = await this.getTile(z - up, ax, ay);
      if (data !== null) {
        return {
          data,
          up,
          offsetX: (x - ax * f) / f,
          offsetY: (y - ay * f) / f,
        };
      }
    }
    return null;
  }

  async hasTile(z: number, x: number, y: number): Promise<boolean> {
    const { rows } = await this.db.execute(
      'SELECT 1 FROM map_tiles WHERE z = ? AND x = ? AND y = ?',
      [z, x, y],
    );
    return rows.length > 0;
  }

  async putTile(z: number, x: number, y: number, data: string): Promise<void> {
    await this.db.execute(
      'INSERT OR REPLACE INTO map_tiles (z, x, y, data) VALUES (?, ?, ?, ?)',
      [z, x, y, data],
    );
  }

  async listAreas(): Promise<MapArea[]> {
    const { rows } = await this.db.execute(
      'SELECT * FROM map_areas ORDER BY created_at, label',
    );
    return rows.map(toArea);
  }

  async createArea(input: {
    label: string;
    center: LatLon;
    radiusKm: number;
    maxZoom: number;
    source: MapSource;
  }): Promise<MapArea> {
    const label = input.label.trim() === '' ? 'Zone' : input.label.trim();
    const plan = planArea(input.center, input.radiusKm, input.maxZoom);
    if (plan.tiles > AREA_MAX_TILES) {
      throw new Error('Zone trop grande : choisissez un rayon plus petit');
    }
    const id = this.newId();
    await this.db.execute(
      `INSERT INTO map_areas (id, label, latitude, longitude, radius_km,
         min_zoom, max_zoom, source)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        label.slice(0, 60),
        clampLat(input.center.latitude),
        input.center.longitude,
        input.radiusKm,
        plan.ranges[0].z,
        input.maxZoom,
        input.source.id,
      ],
    );
    const { rows } = await this.db.execute(
      'SELECT * FROM map_areas WHERE id = ?',
      [id],
    );
    return toArea(rows[0]);
  }

  async finishArea(id: string, tiles: number, complete: boolean) {
    await this.db.execute(
      'UPDATE map_areas SET tiles = ?, complete = ? WHERE id = ?',
      [tiles, complete ? 1 : 0, id],
    );
  }

  /** Supprime la zone et ses tuiles, sauf celles d'une autre zone. */
  async deleteArea(id: string): Promise<void> {
    const areas = await this.listAreas();
    const area = areas.find(a => a.id === id);
    if (area === undefined) {
      return;
    }
    const others = areas.filter(a => a.id !== id).map(areaPlan);
    for (const r of areaPlan(area).ranges) {
      const keep = others
        .map(p => p.ranges.find(o => o.z === r.z))
        .filter((o): o is TileRange => o !== undefined);
      const params: number[] = [r.z, r.x0, r.x1, r.y0, r.y1];
      const clauses = keep.map(o => {
        params.push(o.x0, o.x1, o.y0, o.y1);
        return 'AND NOT (x BETWEEN ? AND ? AND y BETWEEN ? AND ?)';
      });
      await this.db.execute(
        `DELETE FROM map_tiles
          WHERE z = ? AND x BETWEEN ? AND ? AND y BETWEEN ? AND ?
          ${clauses.join(' ')}`,
        params,
      );
    }
    await this.db.execute('DELETE FROM map_areas WHERE id = ?', [id]);
  }

  /** Place occupée par toutes les tuiles (données décodées), en octets. */
  async storedBytes(): Promise<number> {
    const { rows } = await this.db.execute(
      'SELECT coalesce(sum(length(data)), 0) AS n FROM map_tiles',
    );
    return Math.round((Number(rows[0].n) * 3) / 4);
  }
}

// --- Téléchargement ---------------------------------------------------------

/** Télécharge une tuile et la rend en URI `data:image/…;base64,…`. */
export type TileFetch = (url: string) => Promise<string>;

export const defaultTileFetch: TileFetch = async url => {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  const blob = await response.blob();
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Tuile illisible'));
    reader.onload = () => {
      const result = String(reader.result ?? '');
      if (!/^data:image\/[a-z+]+;base64,./.test(result)) {
        reject(new Error('Réponse inattendue'));
        return;
      }
      resolve(result);
    };
    reader.readAsDataURL(blob);
  });
};

export interface DownloadProgress {
  done: number;
  total: number;
  failed: number;
}

export interface DownloadControl {
  cancelled: boolean;
}

export class DownloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DownloadError';
  }
}

/**
 * Télécharge les tuiles manquantes de la zone, quatre à la fois pour ne pas
 * surcharger le serveur. S'arrête si les premières requêtes échouent toutes
 * (pas de réseau) ; les tuiles déjà reçues restent utilisables.
 */
export async function downloadArea(
  store: MapTileStore,
  area: MapArea,
  source: MapSource,
  fetchTile: TileFetch,
  options: {
    onProgress?: (progress: DownloadProgress) => void;
    control?: DownloadControl;
    concurrency?: number;
  } = {},
): Promise<DownloadProgress> {
  const plan = areaPlan(area);
  const queue: Array<[number, number, number]> = [];
  for (const r of plan.ranges) {
    for (let x = r.x0; x <= r.x1; x++) {
      for (let y = r.y0; y <= r.y1; y++) {
        queue.push([r.z, x, y]);
      }
    }
  }
  const progress: DownloadProgress = {
    done: 0,
    total: queue.length,
    failed: 0,
  };
  let received = 0;
  let next = 0;
  let fatal: Error | null = null;
  const report = () => options.onProgress?.({ ...progress });

  const worker = async () => {
    while (
      next < queue.length &&
      fatal === null &&
      !options.control?.cancelled
    ) {
      const [z, x, y] = queue[next++];
      if (!(await store.hasTile(z, x, y))) {
        try {
          await store.putTile(z, x, y, await fetchTile(source.url(z, x, y)));
          received++;
        } catch {
          progress.failed++;
          if (received === 0 && progress.failed >= 8) {
            fatal = new DownloadError(
              'Téléchargement impossible : vérifiez la connexion internet.',
            );
          }
        }
      }
      progress.done++;
      report();
    }
  };
  report();
  await Promise.all(
    Array.from({ length: options.concurrency ?? 4 }, () => worker()),
  );
  const present = progress.done - progress.failed;
  await store.finishArea(
    area.id,
    present,
    fatal === null && !options.control?.cancelled && progress.failed === 0,
  );
  if (fatal !== null) {
    throw fatal;
  }
  return progress;
}
