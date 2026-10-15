/**
 * Conversions de coordonnées WGS84 ↔ UTM ↔ MGRS, sans dépendance ni réseau.
 *
 * Projection : Mercator transverse par les séries de Krüger à l'ordre 6
 * (Karney, « Transverse Mercator with an accuracy of a few nanometers »,
 * J. Geodesy 2011). La précision est inférieure au millimètre dans une zone UTM.
 *
 * Domaine : latitudes de 80° S à 84° N. Au-delà, l'OTAN utilise la grille
 * polaire UPS, non prise en charge ici (erreur `POLAR_UNSUPPORTED`).
 *
 * Conventions :
 * - Une référence MGRS désigne le coin sud-ouest d'un carré dont le côté
 *   dépend du nombre de chiffres (5 chiffres = 1 m, 4 = 10 m … 0 = 100 km).
 *   Les chiffres sont tronqués, jamais arrondis, comme l'exige la norme.
 * - `mgrsToLatLon` renvoie le CENTRE du carré : c'est la meilleure
 *   estimation de la position désignée.
 */

export type GeoErrorCode =
  | 'OUT_OF_RANGE'
  | 'POLAR_UNSUPPORTED'
  | 'INVALID_FORMAT';

export class GeoError extends Error {
  readonly code: GeoErrorCode;
  constructor(code: GeoErrorCode, message: string) {
    super(message);
    this.name = 'GeoError';
    this.code = code;
  }
}

export interface LatLon {
  /** Degrés décimaux, positifs au nord. */
  latitude: number;
  /** Degrés décimaux, positifs à l'est. */
  longitude: number;
}

export type Hemisphere = 'N' | 'S';

export interface UtmCoordinate {
  zone: number;
  hemisphere: Hemisphere;
  /** Mètres, faux est de 500 000 m inclus. */
  easting: number;
  /** Mètres, faux nord de 10 000 000 m inclus dans l'hémisphère sud. */
  northing: number;
}

export interface UtmProjection extends UtmCoordinate {
  /** Bande de latitude MGRS (C à X). */
  band: string;
  /**
   * Convergence du méridien en degrés : angle entre le nord géographique et
   * le nord du quadrillage. Gisement quadrillage = azimut vrai − convergence.
   */
  convergence: number;
}

export interface MgrsReference {
  zone: number;
  band: string;
  /** Deux lettres du carré de 100 km. */
  square: string;
  /** Est dans le carré, en mètres (tronqué à la précision). */
  easting: number;
  /** Nord dans le carré, en mètres (tronqué à la précision). */
  northing: number;
  /** Nombre de chiffres par axe, de 0 à 5. */
  digits: MgrsDigits;
}

export type MgrsDigits = 0 | 1 | 2 | 3 | 4 | 5;

// --- Ellipsoïde WGS84 et constantes UTM ------------------------------------

const A_AXIS = 6_378_137;
const FLATTENING = 1 / 298.257223563;
const K0 = 0.9996;
const FALSE_EASTING = 500_000;
const FALSE_NORTHING_SOUTH = 10_000_000;

const MIN_LAT = -80;
const MAX_LAT = 84;

const E = Math.sqrt(FLATTENING * (2 - FLATTENING));
const N = FLATTENING / (2 - FLATTENING);
const N2 = N * N;
const N3 = N2 * N;
const N4 = N3 * N;
const N5 = N4 * N;
const N6 = N5 * N;

/** Rayon de la sphère rectifiante, multiplié par k0. */
const K0_A = ((K0 * A_AXIS) / (1 + N)) * (1 + N2 / 4 + N4 / 64 + N6 / 256);

/** Coefficients de Krüger pour le sens direct (α) et inverse (β), indice 1 à 6. */
const ALPHA = [
  (1 / 2) * N -
    (2 / 3) * N2 +
    (5 / 16) * N3 +
    (41 / 180) * N4 -
    (127 / 288) * N5 +
    (7891 / 37800) * N6,
  (13 / 48) * N2 -
    (3 / 5) * N3 +
    (557 / 1440) * N4 +
    (281 / 630) * N5 -
    (1983433 / 1935360) * N6,
  (61 / 240) * N3 -
    (103 / 140) * N4 +
    (15061 / 26880) * N5 +
    (167603 / 181440) * N6,
  (49561 / 161280) * N4 - (179 / 168) * N5 + (6601661 / 7257600) * N6,
  (34729 / 80640) * N5 - (3418889 / 1995840) * N6,
  (212378941 / 319334400) * N6,
];

const BETA = [
  (1 / 2) * N -
    (2 / 3) * N2 +
    (37 / 96) * N3 -
    (1 / 360) * N4 -
    (81 / 512) * N5 +
    (96199 / 604800) * N6,
  (1 / 48) * N2 +
    (1 / 15) * N3 -
    (437 / 1440) * N4 +
    (46 / 105) * N5 -
    (1118711 / 3870720) * N6,
  (17 / 480) * N3 - (37 / 840) * N4 - (209 / 4480) * N5 + (5569 / 90720) * N6,
  (4397 / 161280) * N4 - (11 / 504) * N5 - (830251 / 7257600) * N6,
  (4583 / 161280) * N5 - (108847 / 3991680) * N6,
  (20648693 / 638668800) * N6,
];

const toRad = (deg: number) => (deg * Math.PI) / 180;
const toDeg = (rad: number) => (rad * 180) / Math.PI;

/** Latitude conforme : tan φ → tan χ (Karney, éq. 7). */
function conformalTau(tau: number): number {
  const sigma = Math.sinh(E * Math.atanh((E * tau) / Math.sqrt(1 + tau * tau)));
  return tau * Math.sqrt(1 + sigma * sigma) - sigma * Math.sqrt(1 + tau * tau);
}

function centralMeridian(zone: number): number {
  return (zone - 1) * 6 - 180 + 3;
}

// --- Validation -------------------------------------------------------------

function assertFiniteNumber(value: number, label: string): void {
  if (!Number.isFinite(value)) {
    throw new GeoError('OUT_OF_RANGE', `${label} invalide`);
  }
}

function assertUtmLatitude(latitude: number): void {
  assertFiniteNumber(latitude, 'Latitude');
  if (latitude < -90 || latitude > 90) {
    throw new GeoError('OUT_OF_RANGE', 'La latitude doit être entre -90 et 90');
  }
  if (latitude < MIN_LAT || latitude > MAX_LAT) {
    throw new GeoError(
      'POLAR_UNSUPPORTED',
      'Zone polaire (au-delà de 84° N ou 80° S) : grille UPS non prise en charge',
    );
  }
}

/** Ramène une longitude dans [-180, 180[. */
export function normalizeLongitude(longitude: number): number {
  assertFiniteNumber(longitude, 'Longitude');
  const wrapped = ((((longitude + 180) % 360) + 360) % 360) - 180;
  return wrapped;
}

// --- Bandes et zones --------------------------------------------------------

/** Bandes de 8°, de C (80° S) à X (72° N – 84° N, bande élargie à 12°). */
const BANDS = 'CDEFGHJKLMNPQRSTUVWXX';

export function latitudeBand(latitude: number): string {
  assertUtmLatitude(latitude);
  return BANDS[Math.floor(latitude / 8 + 10)];
}

/** Zone UTM, exceptions de Norvège (32V) et du Svalbard (31X–37X) incluses. */
export function utmZone(latitude: number, longitude: number): number {
  const band = latitudeBand(latitude);
  const lon = normalizeLongitude(longitude);
  let zone = Math.floor((lon + 180) / 6) + 1;

  if (band === 'V' && zone === 31 && lon >= 3) {
    zone = 32;
  }
  if (band === 'X') {
    if (zone === 32) {
      zone = lon < 9 ? 31 : 33;
    } else if (zone === 34) {
      zone = lon < 21 ? 33 : 35;
    } else if (zone === 36) {
      zone = lon < 33 ? 35 : 37;
    }
  }
  return zone;
}

// --- Lat/Lon → UTM ----------------------------------------------------------

/**
 * Projette une position en UTM. `forceZone` permet d'exprimer un point dans
 * une zone voisine (utile pour travailler sur une carte à cheval sur deux
 * zones) ; l'écart au méridien central reste alors limité à ±9°.
 */
export function latLonToUtm(point: LatLon, forceZone?: number): UtmProjection {
  const { latitude } = point;
  assertUtmLatitude(latitude);
  const longitude = normalizeLongitude(point.longitude);
  const zone = forceZone ?? utmZone(latitude, longitude);
  if (!Number.isInteger(zone) || zone < 1 || zone > 60) {
    throw new GeoError('OUT_OF_RANGE', 'La zone UTM doit être entre 1 et 60');
  }

  let dLon = longitude - centralMeridian(zone);
  dLon = normalizeLongitude(dLon);
  if (Math.abs(dLon) > 9) {
    throw new GeoError(
      'OUT_OF_RANGE',
      'Point trop éloigné de la zone demandée',
    );
  }

  const phi = toRad(latitude);
  const lambda = toRad(dLon);
  const cosLambda = Math.cos(lambda);
  const tau = Math.tan(phi);
  const tauPrime = conformalTau(tau);

  const xiPrime = Math.atan2(tauPrime, cosLambda);
  const etaPrime = Math.asinh(
    Math.sin(lambda) / Math.sqrt(tauPrime * tauPrime + cosLambda * cosLambda),
  );

  let xi = xiPrime;
  let eta = etaPrime;
  let p = 1;
  let q = 0;
  for (let j = 1; j <= 6; j++) {
    const a = ALPHA[j - 1];
    const s = Math.sin(2 * j * xiPrime);
    const c = Math.cos(2 * j * xiPrime);
    const sh = Math.sinh(2 * j * etaPrime);
    const ch = Math.cosh(2 * j * etaPrime);
    xi += a * s * ch;
    eta += a * c * sh;
    p += 2 * j * a * c * ch;
    q += 2 * j * a * s * sh;
  }

  const hemisphere: Hemisphere = latitude >= 0 ? 'N' : 'S';
  const easting = K0_A * eta + FALSE_EASTING;
  const northing = K0_A * xi + (hemisphere === 'S' ? FALSE_NORTHING_SOUTH : 0);

  const gammaPrime = Math.atan(
    (tauPrime / Math.sqrt(1 + tauPrime * tauPrime)) * Math.tan(lambda),
  );
  const gammaSecond = Math.atan2(q, p);

  return {
    zone,
    hemisphere,
    easting,
    northing,
    band: latitudeBand(latitude),
    convergence: toDeg(gammaPrime + gammaSecond),
  };
}

// --- UTM → Lat/Lon ----------------------------------------------------------

function assertUtm(utm: UtmCoordinate): void {
  if (!Number.isInteger(utm.zone) || utm.zone < 1 || utm.zone > 60) {
    throw new GeoError('OUT_OF_RANGE', 'La zone UTM doit être entre 1 et 60');
  }
  if (utm.hemisphere !== 'N' && utm.hemisphere !== 'S') {
    throw new GeoError('OUT_OF_RANGE', "L'hémisphère doit être N ou S");
  }
  assertFiniteNumber(utm.easting, 'Abscisse (est)');
  assertFiniteNumber(utm.northing, 'Ordonnée (nord)');
  // Bornes larges : une zone fait au plus ~834 km de large à l'équateur.
  if (utm.easting < 100_000 || utm.easting > 900_000) {
    throw new GeoError('OUT_OF_RANGE', 'Abscisse UTM hors de la zone');
  }
  if (utm.northing < 0 || utm.northing > 10_000_000) {
    throw new GeoError('OUT_OF_RANGE', 'Ordonnée UTM hors limites');
  }
}

export function utmToLatLon(utm: UtmCoordinate): LatLon {
  assertUtm(utm);
  const x = utm.easting - FALSE_EASTING;
  const y = utm.northing - (utm.hemisphere === 'S' ? FALSE_NORTHING_SOUTH : 0);

  const eta = x / K0_A;
  const xi = y / K0_A;

  let xiPrime = xi;
  let etaPrime = eta;
  for (let j = 1; j <= 6; j++) {
    const b = BETA[j - 1];
    xiPrime -= b * Math.sin(2 * j * xi) * Math.cosh(2 * j * eta);
    etaPrime -= b * Math.cos(2 * j * xi) * Math.sinh(2 * j * eta);
  }

  const sinhEtaPrime = Math.sinh(etaPrime);
  const sinXiPrime = Math.sin(xiPrime);
  const cosXiPrime = Math.cos(xiPrime);
  const tauPrime =
    sinXiPrime /
    Math.sqrt(sinhEtaPrime * sinhEtaPrime + cosXiPrime * cosXiPrime);

  // Newton-Raphson sur tan φ (converge en 2 à 3 itérations).
  const e2 = E * E;
  let tau = tauPrime;
  for (let i = 0; i < 10; i++) {
    const tauI = conformalTau(tau);
    const delta =
      ((tauPrime - tauI) / Math.sqrt(1 + tauI * tauI)) *
      ((1 + (1 - e2) * tau * tau) / ((1 - e2) * Math.sqrt(1 + tau * tau)));
    tau += delta;
    if (Math.abs(delta) < 1e-12) {
      break;
    }
  }

  const latitude = toDeg(Math.atan(tau));
  const longitude = normalizeLongitude(
    toDeg(Math.atan2(sinhEtaPrime, cosXiPrime)) + centralMeridian(utm.zone),
  );
  return { latitude, longitude };
}

// --- MGRS -------------------------------------------------------------------

const COLUMN_SETS = ['ABCDEFGH', 'JKLMNPQR', 'STUVWXYZ'];
const ROW_LETTERS = 'ABCDEFGHJKLMNPQRSTUV';

export function utmToMgrs(
  utm: UtmCoordinate & { band: string },
  digits: MgrsDigits = 5,
): MgrsReference {
  assertUtm(utm);
  const columns = COLUMN_SETS[(utm.zone - 1) % 3];
  const column = columns[Math.floor(utm.easting / 100_000) - 1];
  let rowIndex = Math.floor(utm.northing / 100_000) % 20;
  if (utm.zone % 2 === 0) {
    rowIndex = (rowIndex + 5) % 20;
  }
  if (column === undefined) {
    throw new GeoError('OUT_OF_RANGE', 'Abscisse UTM hors de la zone');
  }

  const resolution = 10 ** (5 - digits);
  const truncate = (meters: number) =>
    Math.floor((meters % 100_000) / resolution) * resolution;

  return {
    zone: utm.zone,
    band: utm.band,
    square: column + ROW_LETTERS[rowIndex],
    easting: truncate(utm.easting),
    northing: truncate(utm.northing),
    digits,
  };
}

export function latLonToMgrs(
  point: LatLon,
  digits: MgrsDigits = 5,
): MgrsReference {
  return utmToMgrs(latLonToUtm(point), digits);
}

/** « 31U DQ 48251 11932 » (ou sans espaces avec `compact`). */
export function formatMgrs(ref: MgrsReference, compact = false): string {
  const pad = (meters: number) =>
    String(Math.floor(meters / 10 ** (5 - ref.digits))).padStart(
      ref.digits,
      '0',
    );
  const parts = [`${String(ref.zone).padStart(2, '0')}${ref.band}`, ref.square];
  if (ref.digits > 0) {
    parts.push(pad(ref.easting), pad(ref.northing));
  }
  return parts.join(compact ? '' : ' ');
}

const MGRS_RE = /^(\d{1,2})([C-HJ-NP-X])([A-HJ-NP-Z])([A-HJ-NP-V])(\d*)$/;

/**
 * Lit une référence MGRS : espaces facultatifs, casse indifférente,
 * zéro de tête de zone facultatif (« 4QFJ1234567890 » = « 04Q FJ … »).
 */
export function parseMgrs(input: string): MgrsReference {
  const compact = input.replace(/\s+/g, '').toUpperCase();
  const match = MGRS_RE.exec(compact);
  if (match === null) {
    throw new GeoError('INVALID_FORMAT', 'Référence MGRS illisible');
  }
  const [, zoneText, band, column, row, numbers] = match;
  const zone = Number(zoneText);
  if (zone < 1 || zone > 60) {
    throw new GeoError(
      'INVALID_FORMAT',
      'La zone MGRS doit être entre 1 et 60',
    );
  }
  if (numbers.length % 2 !== 0 || numbers.length > 10) {
    throw new GeoError(
      'INVALID_FORMAT',
      'Il faut autant de chiffres pour l’est que pour le nord (0 à 5 chacun)',
    );
  }
  if (!COLUMN_SETS[(zone - 1) % 3].includes(column)) {
    throw new GeoError(
      'INVALID_FORMAT',
      `La lettre de colonne ${column} n’existe pas dans la zone ${zone}`,
    );
  }
  const digits = (numbers.length / 2) as MgrsDigits;
  const scale = 10 ** (5 - digits);
  const easting = digits === 0 ? 0 : Number(numbers.slice(0, digits)) * scale;
  const northing = digits === 0 ? 0 : Number(numbers.slice(digits)) * scale;
  return { zone, band, square: column + row, easting, northing, digits };
}

/** Coin sud-ouest du carré MGRS, en UTM. */
export function mgrsToUtm(
  ref: MgrsReference,
): UtmCoordinate & { band: string } {
  const columns = COLUMN_SETS[(ref.zone - 1) % 3];
  const columnIndex = columns.indexOf(ref.square[0]);
  let rowIndex = ROW_LETTERS.indexOf(ref.square[1]);
  const bandIndex = BANDS.indexOf(ref.band);
  if (columnIndex < 0 || rowIndex < 0 || bandIndex < 0) {
    throw new GeoError('INVALID_FORMAT', 'Référence MGRS invalide');
  }
  if (ref.zone % 2 === 0) {
    rowIndex = (rowIndex + 15) % 20;
  }

  const easting = (columnIndex + 1) * 100_000 + ref.easting;
  const hemisphere: Hemisphere = ref.band >= 'N' ? 'N' : 'S';

  // Les lettres de ligne se répètent tous les 2 000 km : on choisit le cycle
  // qui place le point dans la bande de latitude indiquée. Le nord minimal
  // d'une bande est atteint sur le méridien central de la zone.
  const bandSouthLat = (bandIndex - 10) * 8;
  const bandFloor =
    Math.floor(
      latLonToUtm(
        { latitude: bandSouthLat, longitude: centralMeridian(ref.zone) },
        ref.zone,
      ).northing / 100_000,
    ) * 100_000;
  let northing = rowIndex * 100_000 + ref.northing;
  while (northing < bandFloor) {
    northing += 2_000_000;
  }

  return { zone: ref.zone, hemisphere, band: ref.band, easting, northing };
}

/** Centre du carré désigné par la référence MGRS. */
export function mgrsToLatLon(input: string | MgrsReference): LatLon {
  const ref = typeof input === 'string' ? parseMgrs(input) : input;
  const utm = mgrsToUtm(ref);
  const half = 10 ** (5 - ref.digits) / 2;
  return utmToLatLon({
    ...utm,
    easting: utm.easting + half,
    northing: utm.northing + half,
  });
}

// --- Formats texte UTM ------------------------------------------------------

/** « 31 N 448251 5411932 » (mètres arrondis). */
export function formatUtm(utm: UtmCoordinate): string {
  return `${utm.zone} ${utm.hemisphere} ${Math.round(utm.easting)} ${Math.round(
    utm.northing,
  )}`;
}

const UTM_RE =
  /^(\d{1,2})\s*([NS])\s+(\d+(?:[.,]\d+)?)\s*(?:m?E)?\s+(\d+(?:[.,]\d+)?)\s*(?:m?N)?$/i;

/**
 * Lit « 31 N 448251 5411932 ». La lettre est l'HÉMISPHÈRE (N ou S), pas la
 * bande de latitude : « 31S » signifierait sinon deux choses différentes.
 */
export function parseUtm(input: string): UtmCoordinate {
  const match = UTM_RE.exec(input.trim());
  if (match === null) {
    throw new GeoError(
      'INVALID_FORMAT',
      'Format UTM attendu : « zone hémisphère est nord », ex. 31 N 448251 5411932',
    );
  }
  const utm: UtmCoordinate = {
    zone: Number(match[1]),
    hemisphere: match[2].toUpperCase() as Hemisphere,
    easting: Number(match[3].replace(',', '.')),
    northing: Number(match[4].replace(',', '.')),
  };
  assertUtm(utm);
  return utm;
}

// --- Formats texte Lat/Lon --------------------------------------------------

export type LatLonFormat = 'dd' | 'dm' | 'dms';

/**
 * 'dd'  : 48.85820° N, 2.29450° E
 * 'dm'  : 48° 51.492′ N, 2° 17.670′ E   (usage aéronautique et maritime)
 * 'dms' : 48° 51′ 29.5″ N, 2° 17′ 40.2″ E
 */
export function formatLatLon(
  point: LatLon,
  format: LatLonFormat = 'dms',
): string {
  assertFiniteNumber(point.latitude, 'Latitude');
  if (point.latitude < -90 || point.latitude > 90) {
    throw new GeoError('OUT_OF_RANGE', 'La latitude doit être entre -90 et 90');
  }
  const lon = normalizeLongitude(point.longitude);
  return `${formatAngle(point.latitude, format, 'N', 'S')}, ${formatAngle(
    lon,
    format,
    'E',
    'W',
  )}`;
}

function formatAngle(
  value: number,
  format: LatLonFormat,
  positive: string,
  negative: string,
): string {
  const suffix = value < 0 ? negative : positive;
  const abs = Math.abs(value);
  if (format === 'dd') {
    return `${abs.toFixed(5)}° ${suffix}`;
  }
  if (format === 'dm') {
    // Arrondi sur le total pour éviter « 59.9995′ » affiché comme « 60.000′ ».
    const totalMinutes = Math.round(abs * 60 * 1000) / 1000;
    const degrees = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes - degrees * 60;
    return `${degrees}° ${minutes.toFixed(3)}′ ${suffix}`;
  }
  const totalTenths = Math.round(abs * 36_000);
  const degrees = Math.floor(totalTenths / 36_000);
  const minutes = Math.floor((totalTenths % 36_000) / 600);
  const seconds = (totalTenths % 600) / 10;
  return `${degrees}° ${minutes}′ ${seconds.toFixed(1)}″ ${suffix}`;
}

// --- Navigation (calculatrice boussole) -------------------------------------

/** Rayon moyen de la Terre (IUGG), suffisant pour la navigation à pied. */
const EARTH_MEAN_RADIUS = 6_371_008.8;

export interface DistanceBearing {
  /** Distance orthodromique en mètres (erreur < 0,5 % sur la sphère). */
  distance: number;
  /** Azimut vrai de départ, en degrés [0, 360[. */
  bearing: number;
}

export function distanceAndBearing(from: LatLon, to: LatLon): DistanceBearing {
  for (const p of [from, to]) {
    assertFiniteNumber(p.latitude, 'Latitude');
    assertFiniteNumber(p.longitude, 'Longitude');
  }
  const phi1 = toRad(from.latitude);
  const phi2 = toRad(to.latitude);
  const dPhi = phi2 - phi1;
  const dLambda = toRad(normalizeLongitude(to.longitude - from.longitude));

  const h =
    Math.sin(dPhi / 2) ** 2 +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLambda / 2) ** 2;
  const distance = 2 * EARTH_MEAN_RADIUS * Math.asin(Math.min(1, Math.sqrt(h)));

  const y = Math.sin(dLambda) * Math.cos(phi2);
  const x =
    Math.cos(phi1) * Math.sin(phi2) -
    Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLambda);
  const bearing = (toDeg(Math.atan2(y, x)) + 360) % 360;
  return { distance, bearing };
}

/**
 * Convertit un azimut vrai en azimut magnétique (celui de la boussole).
 * La déclinaison (positive à l'est) dépend du lieu et de l'année : elle doit
 * être lue sur la carte ou dans un modèle magnétique embarqué.
 */
export function trueToMagnetic(
  trueBearing: number,
  declination: number,
): number {
  return (((trueBearing - declination) % 360) + 360) % 360;
}

/** Azimut vrai → gisement quadrillage (pour tracer sur une carte UTM/MGRS). */
export function trueToGrid(trueBearing: number, convergence: number): number {
  return (((trueBearing - convergence) % 360) + 360) % 360;
}
