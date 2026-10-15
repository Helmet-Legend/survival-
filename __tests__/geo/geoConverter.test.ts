import * as mgrsReference from 'mgrs';
import proj4 from 'proj4';

import {
  distanceAndBearing,
  formatLatLon,
  formatMgrs,
  formatUtm,
  latitudeBand,
  latLonToMgrs,
  latLonToUtm,
  mgrsToLatLon,
  mgrsToUtm,
  parseMgrs,
  parseUtm,
  trueToGrid,
  trueToMagnetic,
  utmToLatLon,
  utmZone,
  type LatLon,
} from '../../src/geo/geoConverter';

const EIFFEL: LatLon = { latitude: 48.8582, longitude: 2.2945 };

/** Points pseudo-aléatoires reproductibles couvrant tout le domaine UTM. */
function samplePoints(count: number): LatLon[] {
  let seed = 123456789;
  const next = () => {
    seed = (seed * 1103515245 + 12345) % 2 ** 31;
    return seed / 2 ** 31;
  };
  const points: LatLon[] = [];
  for (let i = 0; i < count; i++) {
    points.push({
      latitude: -80 + next() * 163.999,
      longitude: -180 + next() * 359.999,
    });
  }
  return points;
}

const SAMPLES = samplePoints(3000);

function metersBetween(a: LatLon, b: LatLon): number {
  return distanceAndBearing(a, b).distance;
}

describe('latLonToUtm', () => {
  it('donne le point de référence (Tour Eiffel)', () => {
    const utm = latLonToUtm(EIFFEL);
    expect(utm).toMatchObject({ zone: 31, hemisphere: 'N', band: 'U' });
    expect(utm.easting).toBeCloseTo(448251.795, 3);
    expect(utm.northing).toBeCloseTo(5411932.678, 3);
    expect(formatUtm(utm)).toBe('31 N 448252 5411933');
  });

  it('concorde au millimètre avec proj4 sur 3000 points', () => {
    for (const p of SAMPLES) {
      const utm = latLonToUtm(p);
      const south = utm.hemisphere === 'S' ? ' +south' : '';
      const [e, n] = proj4(
        'EPSG:4326',
        `+proj=utm +zone=${utm.zone}${south} +datum=WGS84`,
        [p.longitude, p.latitude],
      );
      expect(Math.abs(utm.easting - e)).toBeLessThan(1e-3);
      expect(Math.abs(utm.northing - n)).toBeLessThan(1e-3);
    }
  });

  it('revient au point de départ (aller-retour < 0,1 mm)', () => {
    for (const p of SAMPLES) {
      const back = utmToLatLon(latLonToUtm(p));
      expect(Math.abs(back.latitude - p.latitude)).toBeLessThan(1e-9);
      expect(Math.abs(back.longitude - p.longitude)).toBeLessThan(1e-9);
    }
  });

  it('calcule la convergence du méridien', () => {
    // Nulle sur le méridien central, ≈ Δλ·sin φ ailleurs.
    expect(latLonToUtm({ latitude: 45, longitude: 3 }).convergence).toBeCloseTo(
      0,
      10,
    );
    expect(latLonToUtm(EIFFEL).convergence).toBeCloseTo(-0.5311, 3);
    expect(trueToGrid(10, -0.5)).toBeCloseTo(10.5, 10);
  });

  it('accepte une zone imposée (carte à cheval sur deux zones)', () => {
    const forced = latLonToUtm(EIFFEL, 30);
    expect(forced.zone).toBe(30);
    expect(utmToLatLon(forced).longitude).toBeCloseTo(EIFFEL.longitude, 9);
    expect(() => latLonToUtm(EIFFEL, 25)).toThrow(/éloigné/);
  });
});

describe('zones et bandes', () => {
  it.each([
    [60, 2.9, 31],
    [60, 4, 32], // Norvège : 32V élargie
    [55.9, 4, 31], // sous la bande V
    [78, 8, 31], // Svalbard
    [78, 10, 33],
    [78, 20, 33],
    [78, 22, 35],
    [78, 32, 35],
    [78, 34, 37],
    [0, 180, 1], // 180° E = 180° W
    [0, -180, 1],
    [0, 179.99, 60],
  ])('lat %d, lon %d → zone %d', (lat, lon, zone) => {
    expect(utmZone(lat, lon)).toBe(zone);
  });

  it('attribue les bandes de latitude, X élargie à 84° N', () => {
    expect(latitudeBand(-80)).toBe('C');
    expect(latitudeBand(-0.0001)).toBe('M');
    expect(latitudeBand(0)).toBe('N');
    expect(latitudeBand(48.85)).toBe('U');
    expect(latitudeBand(83.9)).toBe('X');
    expect(latitudeBand(84)).toBe('X');
  });

  it('refuse les zones polaires et les latitudes impossibles', () => {
    expect(() => latLonToUtm({ latitude: 84.1, longitude: 0 })).toThrow(
      expect.objectContaining({ code: 'POLAR_UNSUPPORTED' }),
    );
    expect(() => latLonToUtm({ latitude: -80.5, longitude: 0 })).toThrow(
      expect.objectContaining({ code: 'POLAR_UNSUPPORTED' }),
    );
    expect(() => latLonToUtm({ latitude: 91, longitude: 0 })).toThrow(
      expect.objectContaining({ code: 'OUT_OF_RANGE' }),
    );
    expect(() => latLonToUtm({ latitude: NaN, longitude: 0 })).toThrow(
      expect.objectContaining({ code: 'OUT_OF_RANGE' }),
    );
  });
});

describe('MGRS', () => {
  it('donne la référence du point de référence', () => {
    expect(formatMgrs(latLonToMgrs(EIFFEL))).toBe('31U DQ 48251 11932');
    expect(formatMgrs(latLonToMgrs(EIFFEL), true)).toBe('31UDQ4825111932');
  });

  it('tronque selon la précision demandée', () => {
    expect(formatMgrs(latLonToMgrs(EIFFEL, 4))).toBe('31U DQ 4825 1193');
    expect(formatMgrs(latLonToMgrs(EIFFEL, 3))).toBe('31U DQ 482 119');
    expect(formatMgrs(latLonToMgrs(EIFFEL, 1))).toBe('31U DQ 4 1');
    expect(formatMgrs(latLonToMgrs(EIFFEL, 0))).toBe('31U DQ');
  });

  it('complète la zone sur deux chiffres', () => {
    expect(
      formatMgrs(latLonToMgrs({ latitude: 21.3, longitude: -157.9 })),
    ).toMatch(/^04Q /);
  });

  it('concorde avec la bibliothèque de référence `mgrs` dans les deux sens (3000 points)', () => {
    for (const p of SAMPLES) {
      const ours = formatMgrs(latLonToMgrs(p), true);
      const [lon, lat] = mgrsReference.toPoint(ours);
      expect(metersBetween(p, { latitude: lat, longitude: lon })).toBeLessThan(
        2,
      );

      const theirs = mgrsReference.forward([p.longitude, p.latitude], 5);
      expect(metersBetween(p, mgrsToLatLon(theirs))).toBeLessThan(2);
    }
  });

  it('revient au point de départ à 1 m près', () => {
    for (const p of SAMPLES) {
      expect(
        metersBetween(p, mgrsToLatLon(formatMgrs(latLonToMgrs(p)))),
      ).toBeLessThan(1);
    }
  });

  it('lève l’ambiguïté du cycle de 2 000 km grâce à la bande', () => {
    // Même carré de 100 km, bandes différentes → latitudes différentes.
    const southern = mgrsToLatLon('33M VS 00000 00000');
    const northern = mgrsToLatLon('33N VS 00000 00000');
    expect(southern.latitude).toBeLessThan(0);
    expect(northern.latitude).toBeGreaterThan(0);
  });

  it.each([
    ['31UDQ4825111932', 5],
    ['31u dq 48251 11932', 5],
    ['  31U DQ 4825 1193 ', 4],
    ['31UDQ', 0],
    ['4QFJ1234567890', 5],
  ])('lit « %s »', (input, digits) => {
    expect(parseMgrs(input).digits).toBe(digits);
  });

  it('renvoie le centre du carré désigné', () => {
    const corner = mgrsToUtm(parseMgrs('31U DQ'));
    const centre = latLonToUtm(mgrsToLatLon('31U DQ'));
    expect(centre.easting - corner.easting).toBeCloseTo(50_000, 3);
    expect(centre.northing - corner.northing).toBeCloseTo(50_000, 3);
  });

  it.each([
    ['31UDQ482511193', 'nombre impair de chiffres'],
    ['31UDQ482511193212', 'trop de chiffres'],
    ['61UDQ4825111932', 'zone 61'],
    ['31IDQ4825111932', 'bande I'],
    ['31UDO4825111932', 'lettre O'],
    ['31UZQ4825111932', 'colonne absente de la zone'],
    ['coucou', 'texte'],
  ])('refuse « %s » (%s)', input => {
    expect(() => parseMgrs(input)).toThrow(
      expect.objectContaining({ code: 'INVALID_FORMAT' }),
    );
  });
});

describe('formats texte', () => {
  it('lit le format UTM', () => {
    expect(parseUtm('31 N 448252 5411933')).toEqual({
      zone: 31,
      hemisphere: 'N',
      easting: 448252,
      northing: 5411933,
    });
    expect(parseUtm('31n 448252mE 5411933mN').hemisphere).toBe('N');
    expect(parseUtm('56 S 334786,5 6252080').easting).toBe(334786.5);
  });

  it('refuse une lettre de bande à la place de l’hémisphère', () => {
    expect(() => parseUtm('31 U 448252 5411933')).toThrow(
      expect.objectContaining({ code: 'INVALID_FORMAT' }),
    );
    expect(() => parseUtm('31 N 50 5411933')).toThrow(
      expect.objectContaining({ code: 'OUT_OF_RANGE' }),
    );
  });

  it('formate en degrés décimaux, degrés-minutes et DMS', () => {
    expect(formatLatLon(EIFFEL, 'dd')).toBe('48.85820° N, 2.29450° E');
    expect(formatLatLon(EIFFEL, 'dm')).toBe('48° 51.492′ N, 2° 17.670′ E');
    expect(formatLatLon(EIFFEL, 'dms')).toBe('48° 51′ 29.5″ N, 2° 17′ 40.2″ E');
    expect(
      formatLatLon({ latitude: -33.8568, longitude: -70.6483 }, 'dms'),
    ).toBe('33° 51′ 24.5″ S, 70° 38′ 53.9″ W');
  });

  it('reporte correctement les arrondis (pas de « 60″ »)', () => {
    expect(formatLatLon({ latitude: 59.99999, longitude: 0 }, 'dms')).toBe(
      '60° 0′ 0.0″ N, 0° 0′ 0.0″ E',
    );
    expect(formatLatLon({ latitude: 59.9999999, longitude: 0 }, 'dm')).toBe(
      '60° 0.000′ N, 0° 0.000′ E',
    );
  });
});

describe('navigation', () => {
  it('calcule distance et azimut', () => {
    const east = distanceAndBearing(
      { latitude: 0, longitude: 0 },
      { latitude: 0, longitude: 1 },
    );
    expect(east.distance).toBeCloseTo(111_194.9, 0);
    expect(east.bearing).toBeCloseTo(90, 10);

    const north = distanceAndBearing(
      { latitude: 45, longitude: 5 },
      { latitude: 46, longitude: 5 },
    );
    expect(north.bearing).toBeCloseTo(0, 10);

    // Paris → Londres ≈ 343,5 km, cap ≈ 330°.
    const parisLondon = distanceAndBearing(
      { latitude: 48.8566, longitude: 2.3522 },
      { latitude: 51.5074, longitude: -0.1278 },
    );
    expect(parisLondon.distance / 1000).toBeCloseTo(343.5, 0);
    expect(parisLondon.bearing).toBeCloseTo(330, 0);
  });

  it('traverse l’antiméridien par le plus court chemin', () => {
    const r = distanceAndBearing(
      { latitude: 0, longitude: 179.5 },
      { latitude: 0, longitude: -179.5 },
    );
    expect(r.distance).toBeCloseTo(111_194.9, 0);
    expect(r.bearing).toBeCloseTo(90, 10);
  });

  it('convertit un azimut vrai en azimut magnétique', () => {
    expect(trueToMagnetic(10, 15)).toBe(355); // déclinaison 15° E
    expect(trueToMagnetic(350, -15)).toBe(5); // déclinaison 15° W
  });
});
