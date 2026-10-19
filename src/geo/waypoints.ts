/**
 * Points de repère enregistrés (domicile, regroupement, source d'eau,
 * cache…) : gardés dans le coffre chiffré, consultables hors ligne avec la
 * distance et la direction depuis la position du moment.
 */
import type { SqlDatabase, SqlRow } from '../db/types';
import { InventoryError, randomUuid } from '../inventory/inventoryRepository';
import type { FamilyPlan } from '../plan/familyPlan';
import {
  distanceAndBearing,
  formatMgrs,
  latLonToMgrs,
  mgrsToLatLon,
  type LatLon,
} from './geoConverter';

export const WAYPOINT_TYPES = [
  'home',
  'meeting',
  'water_source',
  'shelter',
  'resource',
  'cache',
  'danger',
  'other',
] as const;

export type WaypointType = (typeof WAYPOINT_TYPES)[number];

export const WAYPOINT_LABELS: Record<WaypointType, string> = {
  home: 'Domicile',
  meeting: 'Regroupement',
  water_source: 'Eau',
  shelter: 'Abri',
  resource: 'Ravitaillement',
  cache: 'Cache',
  danger: 'Danger',
  other: 'Autre',
};

/**
 * Types à ne pas exposer : pas de coordonnées dans un aperçu ni de partage
 * sans confirmation.
 */
export const SENSITIVE_TYPES: ReadonlySet<WaypointType> = new Set(['cache']);

export interface WaypointInput extends LatLon {
  label: string;
  type: WaypointType;
  notes?: string | null;
}

export interface Waypoint extends LatLon {
  id: string;
  label: string;
  type: WaypointType;
  notes: string | null;
  /** Point issu du plan familial, modifiable seulement là-bas. */
  fromPlan?: boolean;
  createdAt: string;
}

export const WAYPOINTS_MAX = 500;

function invalid(field: string, message: string): InventoryError {
  return new InventoryError('VALIDATION', message, { field });
}

function validate(input: WaypointInput) {
  const label = typeof input.label === 'string' ? input.label.trim() : '';
  if (label === '') {
    throw invalid('label', 'Champ obligatoire');
  }
  if (label.length > 60) {
    throw invalid('label', '60 caractères au maximum');
  }
  const notes = typeof input.notes === 'string' ? input.notes.trim() : '';
  if (notes.length > 500) {
    throw invalid('notes', '500 caractères au maximum');
  }
  if (!WAYPOINT_TYPES.includes(input.type)) {
    throw invalid('type', 'Type inconnu');
  }
  const { latitude, longitude } = input;
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
    throw invalid('latitude', 'Latitude entre -90 et 90');
  }
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    throw invalid('longitude', 'Longitude entre -180 et 180');
  }
  let mgrs: string | null = null;
  try {
    mgrs = formatMgrs(latLonToMgrs({ latitude, longitude }, 5));
  } catch {
    // Zone polaire : pas de MGRS, les degrés suffisent.
  }
  return {
    label,
    type: input.type,
    notes: notes === '' ? null : notes,
    latitude,
    longitude,
    mgrs,
  };
}

function toWaypoint(row: SqlRow): Waypoint {
  return {
    id: String(row.id),
    label: String(row.label),
    type: String(row.type) as WaypointType,
    notes: row.notes === null ? null : String(row.notes),
    latitude: Number(row.latitude),
    longitude: Number(row.longitude),
    createdAt: String(row.created_at),
  };
}

export class WaypointRepository {
  private readonly db: SqlDatabase;
  private readonly newId: () => string;

  constructor(db: SqlDatabase, options: { newId?: () => string } = {}) {
    this.db = db;
    this.newId = options.newId ?? randomUuid;
  }

  async list(): Promise<Waypoint[]> {
    const { rows } = await this.db.execute(
      'SELECT * FROM poi_locations ORDER BY created_at DESC, label',
    );
    return rows.map(toWaypoint);
  }

  async get(id: string): Promise<Waypoint | null> {
    const { rows } = await this.db.execute(
      'SELECT * FROM poi_locations WHERE id = ?',
      [id],
    );
    return rows.length === 0 ? null : toWaypoint(rows[0]);
  }

  async create(input: WaypointInput): Promise<Waypoint> {
    const v = validate(input);
    const { rows } = await this.db.execute(
      'SELECT count(*) AS n FROM poi_locations',
    );
    if (Number(rows[0].n) >= WAYPOINTS_MAX) {
      throw invalid('label', `${WAYPOINTS_MAX} points au maximum`);
    }
    const id = this.newId();
    await this.db.execute(
      `INSERT INTO poi_locations (id, label, latitude, longitude, mgrs, type, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, v.label, v.latitude, v.longitude, v.mgrs, v.type, v.notes],
    );
    return (await this.get(id)) as Waypoint;
  }

  async update(id: string, input: WaypointInput): Promise<Waypoint> {
    const v = validate(input);
    await this.db.execute(
      `UPDATE poi_locations
          SET label = ?, latitude = ?, longitude = ?, mgrs = ?, type = ?, notes = ?
        WHERE id = ?`,
      [v.label, v.latitude, v.longitude, v.mgrs, v.type, v.notes, id],
    );
    const updated = await this.get(id);
    if (updated === null) {
      throw new InventoryError('NOT_FOUND', 'Point introuvable');
    }
    return updated;
  }

  async remove(id: string): Promise<void> {
    await this.db.execute('DELETE FROM poi_locations WHERE id = ?', [id]);
  }
}

/**
 * Points de regroupement du plan familial dont la position est une
 * référence MGRS lisible ; un simple repère (« devant l'école ») n'a pas de
 * coordonnées et n'apparaît pas.
 */
export function planWaypoints(plan: FamilyPlan): Waypoint[] {
  const points: Waypoint[] = [];
  const entries: Array<[string, FamilyPlan['meetingNear'], string]> = [
    ['plan-near', plan.meetingNear, 'Regroupement près du domicile'],
    ['plan-far', plan.meetingFar, 'Regroupement hors du quartier'],
  ];
  for (const [id, meeting, fallback] of entries) {
    if (meeting.position.trim() === '') {
      continue;
    }
    try {
      const at = mgrsToLatLon(meeting.position);
      points.push({
        id,
        label: meeting.place.trim() === '' ? fallback : meeting.place.trim(),
        type: 'meeting',
        notes: null,
        fromPlan: true,
        createdAt: '',
        ...at,
      });
    } catch {
      // Position non MGRS : rien à placer.
    }
  }
  return points;
}

const CARDINALS = [
  'nord',
  'nord-est',
  'est',
  'sud-est',
  'sud',
  'sud-ouest',
  'ouest',
  'nord-ouest',
];
const CARDINALS_SHORT = ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'];

/** Direction en toutes lettres (« nord-est ») d'un azimut en degrés. */
export function cardinal(bearing: number, short = false): string {
  const i = Math.round((((bearing % 360) + 360) % 360) / 45) % 8;
  return (short ? CARDINALS_SHORT : CARDINALS)[i];
}

export function formatDistance(meters: number): string {
  if (meters < 1000) {
    return `${Math.round(meters)} m`;
  }
  const km = meters / 1000;
  return `${(km < 10 ? km.toFixed(1) : String(Math.round(km))).replace(
    '.',
    ',',
  )} km`;
}

/** « 1,2 km · nord-est (48°) » depuis `from`. */
export function describeFrom(from: LatLon, to: LatLon): string {
  const { distance, bearing } = distanceAndBearing(from, to);
  return `${formatDistance(distance)} · ${cardinal(bearing)} (${
    Math.round(bearing) % 360
  }°)`;
}

/** Message SMS d'un point : nom, coordonnées décimales et MGRS. */
export function waypointMessage(point: Waypoint): string {
  let mgrs = '';
  try {
    mgrs = ` · MGRS ${formatMgrs(latLonToMgrs(point, 5))}`;
  } catch {
    // Zone polaire.
  }
  return `${point.label} : ${point.latitude.toFixed(
    5,
  )}, ${point.longitude.toFixed(5)}${mgrs}`;
}
