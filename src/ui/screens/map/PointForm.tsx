/** Création ou modification d'un point de repère. */
import { LocateFixed } from 'lucide-react-native';
import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import type { Position } from '../../../device/location';
import { mgrsToLatLon, type LatLon } from '../../../geo/geoConverter';
import {
  SENSITIVE_TYPES,
  WAYPOINT_LABELS,
  WAYPOINT_TYPES,
  type Waypoint,
  type WaypointInput,
  type WaypointType,
} from '../../../geo/waypoints';
import {
  Button,
  Chip,
  Field,
  Notice,
  ScreenTitle,
} from '../../components/controls';
import { parseDecimal } from '../../format';
import { space, text } from '../../theme';

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function PointForm(props: {
  /** Point modifié ; absent pour un nouveau point. */
  point?: Waypoint;
  /** Position proposée (GPS ou appui long sur la carte). */
  at?: LatLon | null;
  locate: () => Promise<Position | null>;
  locating: boolean;
  onSave: (input: WaypointInput) => Promise<void>;
  onCancel: () => void;
}) {
  const start = props.point ?? props.at ?? null;
  const [label, setLabel] = useState(props.point?.label ?? '');
  const [type, setType] = useState<WaypointType>(props.point?.type ?? 'other');
  const [lat, setLat] = useState(start ? start.latitude.toFixed(6) : '');
  const [lon, setLon] = useState(start ? start.longitude.toFixed(6) : '');
  const [mgrs, setMgrs] = useState('');
  const [notes, setNotes] = useState(props.point?.notes ?? '');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const fillFromGps = async () => {
    const fix = await props.locate();
    if (fix !== null) {
      setLat(fix.latitude.toFixed(6));
      setLon(fix.longitude.toFixed(6));
      setMgrs('');
    }
  };

  const save = async () => {
    setError(null);
    let position: LatLon;
    try {
      if (mgrs.trim() !== '') {
        position = mgrsToLatLon(mgrs);
      } else {
        if (lat.trim() === '' || lon.trim() === '') {
          throw new Error('Indiquez la position : GPS, degrés ou MGRS');
        }
        position = {
          latitude: parseDecimal(lat),
          longitude: parseDecimal(lon),
        };
      }
    } catch (e) {
      setError(message(e));
      return;
    }
    setSaving(true);
    try {
      await props.onSave({ label, type, notes, ...position });
    } catch (e) {
      setError(message(e));
      setSaving(false);
    }
  };

  return (
    <View style={styles.page}>
      <ScreenTitle
        title={props.point ? 'Modifier le point' : 'Nouveau point'}
        onBack={props.onCancel}
        backLabel="Retour aux points"
      />
      <Field
        label="Nom du point"
        value={label}
        onChangeText={setLabel}
        placeholder="Source du bois, chez Paul…"
        maxLength={60}
      />
      <Text style={text.label}>Type</Text>
      <View style={styles.chips}>
        {WAYPOINT_TYPES.map(t => (
          <Chip
            key={t}
            label={WAYPOINT_LABELS[t]}
            selected={type === t}
            onPress={() => setType(t)}
          />
        ))}
      </View>
      {SENSITIVE_TYPES.has(type) ? (
        <Text style={text.subtle}>
          Point sensible : son partage demandera une confirmation.
        </Text>
      ) : null}
      <Button
        icon={LocateFixed}
        label={
          props.locating ? 'Recherche du GPS…' : 'Ma position GPS actuelle'
        }
        disabled={props.locating}
        onPress={() => {
          void fillFromGps();
        }}
      />
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
      <Field
        label="Ou référence MGRS"
        value={mgrs}
        onChangeText={setMgrs}
        autoCapitalize="characters"
        autoCorrect={false}
        placeholder="32T LR 34199 77670"
        hint="Si elle est remplie, elle remplace la latitude et la longitude."
      />
      <Field
        label="Notes"
        value={notes}
        onChangeText={setNotes}
        multiline
        maxLength={500}
        placeholder="Accès, repères, horaires…"
      />
      {error ? <Notice tone="error" message={error} /> : null}
      <Button
        variant="primary"
        label={saving ? 'Enregistrement…' : 'Enregistrer le point'}
        disabled={saving}
        onPress={() => {
          void save();
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  page: { gap: space.m },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.s },
  pair: { flexDirection: 'row', gap: space.s, flexWrap: 'wrap' },
  half: { flex: 1, minWidth: 120 },
});
