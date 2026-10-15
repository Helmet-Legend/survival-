/**
 * Carte : conversion de coordonnées (MGRS, UTM, DMS) et calcul d'azimut
 * vers un point MGRS. Tout est calculé sur l'appareil, sans réseau.
 */
import { Compass, LocateFixed, MapPin, Navigation } from 'lucide-react-native';
import React, { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

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
  Chip,
  EmptyState,
  Field,
  Notice,
  Panel,
  Reading,
} from '../components/controls';
import { formatNumber, parseDecimal } from '../format';
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

export function MapScreen() {
  const [mode, setMode] = useState<Mode>('coords');
  const [lat, setLat] = useState('');
  const [lon, setLon] = useState('');
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
            <Panel title="Votre position">
              <Reading
                label="MGRS"
                value={position.mgrs}
                color={colors.primary}
              />
              <Reading label="UTM" value={formatUtm(position.utm)} />
              <Reading
                label="DMS"
                value={formatLatLon(position.point, 'dms')}
              />
              <Reading
                label="Deg. min."
                value={formatLatLon(position.point, 'dm')}
              />
              <Reading
                label="Convergence"
                value={`${formatNumber(position.utm.convergence)}°`}
              />
            </Panel>
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
              <Reading
                label="Arrivée"
                value={formatLatLon(navigation.destination, 'dms')}
              />
              <Reading
                label="Distance"
                value={
                  navigation.distance >= 1000
                    ? `${formatNumber(navigation.distance / 1000)} km`
                    : `${formatNumber(navigation.distance, 0)} m`
                }
              />
              <Reading
                label="Azimut vrai"
                value={`${formatNumber(navigation.bearing, 0)}°`}
                color={colors.primary}
              />
              <Reading
                label="Gisement carte"
                value={`${formatNumber(navigation.grid, 0)}°`}
              />
              <Reading
                label="Cap boussole"
                value={
                  navigation.magnetic === null
                    ? 'déclinaison requise'
                    : `${formatNumber(navigation.magnetic, 0)}°`
                }
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
