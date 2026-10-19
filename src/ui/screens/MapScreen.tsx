/**
 * Position : conversion de coordonnées (MGRS, UTM, DMS) et calcul d'azimut
 * vers un point MGRS. Tout est calculé sur l'appareil, sans réseau ; la
 * position peut venir du GPS du téléphone, à la demande.
 */
import {
  Check,
  Compass,
  Copy,
  LocateFixed,
  MapPin,
  Navigation,
} from 'lucide-react-native';
import React, { useEffect, useMemo, useState } from 'react';
import {
  Clipboard,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Svg, { Circle, G, Line, Path } from 'react-native-svg';

import {
  distanceAndBearing,
  formatLatLon,
  formatMgrs,
  formatUtm,
  latLonToMgrs,
  latLonToUtm,
  mgrsToLatLon,
  trueToGrid,
  trueToMagnetic,
  type LatLon,
  type MgrsDigits,
} from '../../geo/geoConverter';
import {
  Button,
  Chip,
  EmptyState,
  Field,
  Notice,
  Panel,
  Reading,
} from '../components/controls';
import { formatNumber, parseDecimal } from '../format';
import { useSession } from '../session';
import { colors, fonts, radius, sizes, space, text } from '../theme';

type Mode = 'coords' | 'bearing';

const PRECISIONS: Array<[MgrsDigits, string]> = [
  [5, '1 m'],
  [4, '10 m'],
  [3, '100 m'],
  [2, '1 km'],
];

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function formatDistance(meters: number): string {
  return meters >= 1000
    ? `${formatNumber(meters / 1000)} km`
    : `${formatNumber(meters, 0)} m`;
}

/** Une coordonnée en grand, avec un bouton pour la copier. */
function CoordCard(props: { label: string; value: string; accent?: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) {
      return undefined;
    }
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);
  return (
    <View
      style={[
        styles.coord,
        props.accent ? { borderColor: props.accent } : null,
      ]}
    >
      <View style={styles.grow}>
        <Text style={text.label}>{props.label}</Text>
        <Text
          selectable
          style={[
            styles.coordValue,
            { color: props.accent ?? colors.cyanSoft },
          ]}
        >
          {props.value}
        </Text>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={
          copied ? `${props.label} copié` : `Copier ${props.label}`
        }
        onPress={() => {
          Clipboard.setString(props.value);
          setCopied(true);
        }}
        style={({ pressed }) => [styles.copy, pressed && styles.pressed]}
      >
        {copied ? (
          <Check color={colors.success} size={16} />
        ) : (
          <Copy color={colors.text} size={16} />
        )}
        <Text style={styles.copyText}>{copied ? 'Copié' : 'Copier'}</Text>
      </Pressable>
    </View>
  );
}

/** Rose des vents : la flèche pointe le cap à suivre. */
function CompassRose({ heading }: { heading: number }) {
  const size = 132;
  const c = size / 2;
  const ticks = Array.from({ length: 36 }, (_, i) => {
    const a = (i * 10 * Math.PI) / 180;
    const major = i % 9 === 0;
    const r1 = major ? c - 14 : c - 9;
    const r2 = c - 4;
    return (
      <Line
        key={i}
        x1={c + r1 * Math.sin(a)}
        y1={c - r1 * Math.cos(a)}
        x2={c + r2 * Math.sin(a)}
        y2={c - r2 * Math.cos(a)}
        stroke={major ? colors.textMuted : colors.textSubtle}
        strokeWidth={major ? 2 : 1}
      />
    );
  });
  return (
    <View style={{ width: size, height: size }}>
      <Svg width={size} height={size}>
        <Circle
          cx={c}
          cy={c}
          r={c - 2}
          fill={colors.surface}
          stroke={colors.border}
          strokeWidth={2}
        />
        {ticks}
        <G rotation={heading} origin={`${c}, ${c}`}>
          <Path
            d={`M${c} ${c - 44} L${c + 8} ${c + 6} L${c} ${c} L${c - 8} ${
              c + 6
            } Z`}
            fill={colors.primary}
          />
        </G>
        <Circle cx={c} cy={c} r={4} fill={colors.text} />
      </Svg>
      <Text style={[styles.cardinal, styles.north]}>N</Text>
      <Text style={[styles.cardinal, styles.east]}>E</Text>
      <Text style={[styles.cardinal, styles.south]}>S</Text>
      <Text style={[styles.cardinal, styles.west]}>O</Text>
    </View>
  );
}

export function MapScreen() {
  const { location } = useSession();
  const [mode, setMode] = useState<Mode>('coords');
  const [lat, setLat] = useState('');
  const [lon, setLon] = useState('');
  const [gps, setGps] = useState<{
    state: 'idle' | 'locating' | 'done' | 'error';
    message?: string;
  }>({ state: 'idle' });
  const locate = async () => {
    setGps({ state: 'locating' });
    try {
      const fix = await location.getPosition();
      setLat(fix.latitude.toFixed(6));
      setLon(fix.longitude.toFixed(6));
      setGps({
        state: 'done',
        message: `${fix.stale ? 'Dernière position connue' : 'Position GPS'}${
          fix.accuracy === null
            ? ''
            : ` · précision ± ${formatNumber(fix.accuracy, 0)} m`
        }`,
      });
    } catch (e) {
      setGps({ state: 'error', message: message(e) });
    }
  };
  const [digits, setDigits] = useState<MgrsDigits>(5);
  const [target, setTarget] = useState('');
  const [declination, setDeclination] = useState('');

  const position = useMemo(() => {
    if (lat.trim() === '' || lon.trim() === '') {
      return null;
    }
    try {
      const point: LatLon = {
        latitude: parseDecimal(lat),
        longitude: parseDecimal(lon),
      };
      const utm = latLonToUtm(point);
      return { point, utm, mgrs: formatMgrs(latLonToMgrs(point, digits)) };
    } catch (e) {
      return { error: message(e) };
    }
  }, [lat, lon, digits]);

  const navigation = useMemo(() => {
    if (target.trim() === '' || position === null || 'error' in position) {
      return null;
    }
    try {
      const destination = mgrsToLatLon(target);
      const { distance, bearing } = distanceAndBearing(
        position.point,
        destination,
      );
      const decl = declination.trim() === '' ? null : parseDecimal(declination);
      if (decl !== null && !Number.isFinite(decl)) {
        throw new Error('Déclinaison invalide');
      }
      return {
        destination,
        distance,
        bearing,
        grid: trueToGrid(bearing, position.utm.convergence),
        magnetic: decl === null ? null : trueToMagnetic(bearing, decl),
      };
    } catch (e) {
      return { error: message(e) };
    }
  }, [target, declination, position]);

  const fix = position !== null && !('error' in position) ? position : null;

  return (
    <ScrollView
      contentContainerStyle={styles.page}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.chips}>
        <Chip
          label="Coordonnées"
          selected={mode === 'coords'}
          onPress={() => setMode('coords')}
        />
        <Chip
          label="Azimut"
          selected={mode === 'bearing'}
          onPress={() => setMode('bearing')}
        />
      </View>

      {mode === 'coords' ? (
        <>
          {location.available ? (
            <Button
              variant="primary"
              icon={LocateFixed}
              label={
                gps.state === 'locating'
                  ? 'Recherche du GPS…'
                  : 'Utiliser ma position GPS'
              }
              disabled={gps.state === 'locating'}
              onPress={() => {
                void locate();
              }}
            />
          ) : null}
          {gps.state === 'locating' ? (
            <Text style={text.subtle}>
              Jusqu’à 30 secondes. À l’intérieur, le GPS capte mal : près d’une
              fenêtre ou dehors, c’est plus rapide.
            </Text>
          ) : null}
          {gps.message ? (
            <Notice
              tone={gps.state === 'error' ? 'error' : 'ok'}
              message={gps.message}
            />
          ) : null}
          <View style={styles.pair}>
            <View style={styles.half}>
              <Field
                label="Latitude"
                value={lat}
                onChangeText={setLat}
                keyboardType="numbers-and-punctuation"
                placeholder="45.83265"
              />
            </View>
            <View style={styles.half}>
              <Field
                label="Longitude"
                value={lon}
                onChangeText={setLon}
                keyboardType="numbers-and-punctuation"
                placeholder="6.86518"
              />
            </View>
          </View>
          <Text style={text.label}>Précision MGRS</Text>
          <View style={styles.pair}>
            {PRECISIONS.map(([d, label]) => (
              <Chip
                key={d}
                label={label}
                selected={digits === d}
                onPress={() => setDigits(d)}
              />
            ))}
          </View>

          {position === null ? (
            <EmptyState
              icon={MapPin}
              title="Aucune position"
              message="Saisissez une latitude et une longitude en degrés décimaux."
            />
          ) : 'error' in position ? (
            <Notice tone="error" message={position.error ?? ''} />
          ) : (
            <>
              <CoordCard
                label="MGRS"
                value={position.mgrs}
                accent={colors.primary}
              />
              <CoordCard label="UTM" value={formatUtm(position.utm)} />
              <CoordCard
                label="DMS"
                value={formatLatLon(position.point, 'dms')}
              />
              <Panel>
                <Reading
                  label="Deg. min."
                  value={formatLatLon(position.point, 'dm')}
                />
                <Reading
                  label="Convergence"
                  value={`${formatNumber(position.utm.convergence)}°`}
                />
              </Panel>
            </>
          )}
        </>
      ) : (
        <>
          {/* Rappel de la position de départ */}
          <View
            style={styles.fix}
            accessible
            accessibilityLabel={
              fix ? `Ma position : ${fix.mgrs}` : 'Aucune position saisie'
            }
          >
            <View style={styles.fixCol}>
              <View style={styles.fixHead}>
                <MapPin color={colors.primary} size={16} />
                <Text style={styles.fixLabel}>MA POSITION</Text>
              </View>
              <Text style={styles.fixValue}>
                {fix ? formatLatLon(fix.point, 'dm') : '—'}
              </Text>
              <Text style={text.subtle}>Saisie manuelle</Text>
            </View>
            <View style={[styles.fixCol, styles.fixSep]}>
              <View style={styles.fixHead}>
                <LocateFixed color={colors.cyan} size={16} />
                <Text style={styles.fixLabel}>MGRS</Text>
              </View>
              <Text style={[styles.fixValue, { color: colors.cyanSoft }]}>
                {fix ? fix.mgrs : '—'}
              </Text>
              <Text style={text.subtle}>
                Précision {PRECISIONS.find(([d]) => d === digits)?.[1]}
              </Text>
            </View>
          </View>
          {fix === null ? (
            <Notice
              tone="error"
              message="Saisissez d’abord votre position dans « Coordonnées »."
            />
          ) : null}
          <Field
            label="Point d’arrivée (MGRS)"
            value={target}
            onChangeText={setTarget}
            autoCapitalize="characters"
            autoCorrect={false}
            placeholder="32T LR 34500 87800"
          />
          <Field
            label="Déclinaison magnétique (° Est, lue sur la carte)"
            value={declination}
            onChangeText={setDeclination}
            keyboardType="numbers-and-punctuation"
            placeholder="2.5"
          />
          {navigation === null ? (
            <EmptyState
              icon={Compass}
              title="Aucun azimut"
              message="Indiquez un point d’arrivée MGRS pour obtenir distance et cap."
            />
          ) : 'error' in navigation ? (
            <Notice tone="error" message={navigation.error ?? ''} />
          ) : (
            <Panel
              title="Itinéraire"
              accent={colors.primary}
              right={<Navigation color={colors.primary} size={20} />}
            >
              <View style={styles.route}>
                <CompassRose
                  heading={navigation.magnetic ?? navigation.bearing}
                />
                <View style={styles.routeValues}>
                  <View>
                    <Text style={text.label}>Distance</Text>
                    <Text style={styles.big}>
                      {formatDistance(navigation.distance)}
                    </Text>
                  </View>
                  <View>
                    <Text style={text.label}>Cap boussole</Text>
                    {navigation.magnetic === null ? (
                      <Text style={styles.missing}>déclinaison requise</Text>
                    ) : (
                      <Text
                        style={[styles.big, { color: colors.primaryBright }]}
                      >
                        {formatNumber(navigation.magnetic, 0)}°
                      </Text>
                    )}
                  </View>
                </View>
              </View>
              {navigation.magnetic === null ? (
                <Text style={text.subtle}>
                  La flèche suit l’azimut vrai tant que la déclinaison n’est pas
                  saisie.
                </Text>
              ) : null}
              <Reading
                label="Azimut vrai"
                value={`${formatNumber(navigation.bearing, 0)}°`}
              />
              <Reading
                label="Gisement carte"
                value={`${formatNumber(navigation.grid, 0)}°`}
              />
              <Reading
                label="Arrivée"
                value={formatLatLon(navigation.destination, 'dms')}
              />
            </Panel>
          )}
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: {
    paddingHorizontal: sizes.screenPadding,
    paddingBottom: space.xl,
    gap: space.m,
  },
  chips: { flexDirection: 'row', gap: space.s },
  pair: { flexDirection: 'row', gap: space.s, flexWrap: 'wrap' },
  half: { flex: 1, minWidth: 120 },
  grow: { flex: 1, minWidth: 0 },
  pressed: { opacity: 0.82 },
  coord: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.m,
    padding: space.m,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.card,
  },
  coordValue: {
    fontFamily: fonts.mono,
    fontSize: 17,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
    marginTop: 4,
  },
  copy: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 40,
    paddingHorizontal: space.m,
    borderRadius: radius.m,
    borderWidth: 1,
    borderColor: colors.border,
  },
  copyText: { color: colors.text, fontSize: 13, fontWeight: '600' },
  route: { flexDirection: 'row', alignItems: 'center', gap: space.l },
  routeValues: { flex: 1, minWidth: 0, gap: space.m },
  big: { ...text.value, fontSize: 30 },
  missing: { color: colors.warning, fontSize: 15, fontWeight: '600' },
  cardinal: {
    position: 'absolute',
    width: 16,
    textAlign: 'center',
    fontSize: 12,
    fontWeight: '800',
    color: colors.textMuted,
  },
  north: { top: 16, left: 58, color: colors.danger },
  east: { right: 18, top: 58 },
  south: { bottom: 16, left: 58 },
  west: { left: 18, top: 58 },
  fix: {
    flexDirection: 'row',
    backgroundColor: colors.bgElevated,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.card,
    padding: space.m,
  },
  fixCol: { flex: 1, minWidth: 0, gap: 4, paddingHorizontal: space.xs },
  fixSep: {
    borderLeftWidth: 1,
    borderLeftColor: colors.border,
    paddingLeft: space.m,
  },
  fixHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  fixLabel: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
  },
  fixValue: {
    color: colors.text,
    fontFamily: fonts.mono,
    fontSize: 15,
    fontVariant: ['tabular-nums'],
  },
});
