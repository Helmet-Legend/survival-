/** Conversion de coordonnées et calcul de cap vers un point MGRS. */
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
import { Chip, Field, Notice, Reading } from '../components/controls';
import { formatNumber, parseDecimal } from '../format';
import { space, text } from '../theme';

const PRECISIONS: Array<[MgrsDigits, string]> = [
  [5, '1 m'],
  [4, '10 m'],
  [3, '100 m'],
  [2, '1 km'],
];

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function CoordsScreen() {
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

  return (
    <ScrollView
      contentContainerStyle={styles.page}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={text.title}>Position</Text>
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
      <Text style={text.dim}>Précision MGRS</Text>
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
        <Text style={text.dim}>
          Saisissez une latitude et une longitude en degrés décimaux.
        </Text>
      ) : 'error' in position ? (
        <Notice tone="error" message={position.error ?? ''} />
      ) : (
        <View>
          <Reading label="MGRS" value={position.mgrs} />
          <Reading label="UTM" value={formatUtm(position.utm)} />
          <Reading label="DMS" value={formatLatLon(position.point, 'dms')} />
          <Reading
            label="Deg. min."
            value={formatLatLon(position.point, 'dm')}
          />
          <Reading
            label="Convergence"
            value={`${formatNumber(position.utm.convergence)}°`}
          />
        </View>
      )}

      <Text style={[text.title, styles.section]}>Aller vers</Text>
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
      {navigation === null ? null : 'error' in navigation ? (
        <Notice tone="error" message={navigation.error ?? ''} />
      ) : (
        <View>
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
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: space.l, gap: space.m },
  pair: { flexDirection: 'row', gap: space.s, flexWrap: 'wrap' },
  half: { flex: 1, minWidth: 120 },
  section: { marginTop: space.m },
});
