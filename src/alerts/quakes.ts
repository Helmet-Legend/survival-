/**
 * Séismes ressentis près du domicile (EMSC / RéNaSS) : la requête couvre
 * toute la métropole et ses abords ; la distance au point « Domicile » se
 * calcule ici.
 */
import { distanceAndBearing, type LatLon } from '../geo/geoConverter';
import { formatDistance } from '../geo/waypoints';
import type { Alert, AlertLevel } from './types';

/** Séismes de magnitude 3 et plus des trois derniers jours. */
export function quakeUrl(since: string): string {
  return (
    'https://www.seismicportal.eu/fdsnws/event/1/query?format=json' +
    '&minlat=40&maxlat=52&minlon=-6&maxlon=11&minmag=3' +
    `&starttime=${since}&limit=200`
  );
}

/** Rayon pris en compte autour du domicile, en kilomètres. */
export const QUAKE_RADIUS_KM = 150;

interface Feature {
  id?: string;
  properties?: {
    lat?: number;
    lon?: number;
    mag?: number;
    time?: string;
    flynn_region?: string;
    unid?: string;
  };
}

/** Orange à partir de la magnitude 5 (dégâts possibles), sinon jaune. */
function levelFor(mag: number): AlertLevel {
  return mag >= 5 ? 'orange' : 'yellow';
}

export function parseQuakes(json: unknown, home: LatLon | null): Alert[] {
  if (home === null) {
    return [];
  }
  const features = (json as { features?: Feature[] } | null)?.features ?? [];
  const alerts: Alert[] = [];
  for (const f of features) {
    const p = f.properties ?? {};
    if (
      typeof p.lat !== 'number' ||
      typeof p.lon !== 'number' ||
      typeof p.mag !== 'number'
    ) {
      continue;
    }
    const { distance } = distanceAndBearing(home, {
      latitude: p.lat,
      longitude: p.lon,
    });
    if (distance > QUAKE_RADIUS_KM * 1000) {
      continue;
    }
    const mag = p.mag.toFixed(1).replace('.', ',');
    alerts.push({
      id: `quake:${p.unid ?? f.id ?? p.time}`,
      source: 'quake',
      level: levelFor(p.mag),
      title: `Séisme de magnitude ${mag}`,
      where: `À ${formatDistance(distance)} du domicile`,
      detail: p.flynn_region ? `Région : ${p.flynn_region}` : null,
      instruction:
        'Après une secousse : vérifiez gaz, eau et électricité ; méfiez-vous des répliques.',
      start: p.time ?? null,
      end: null,
      url: p.unid
        ? `https://www.seismicportal.eu/eventdetails.html?unid=${p.unid}`
        : null,
    });
  }
  return alerts;
}
