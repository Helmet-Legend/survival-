/**
 * Un point de repère : distance et direction depuis la position du moment,
 * flèche orientée par la boussole du téléphone, partage par SMS.
 */
import {
  Map as MapIcon,
  MessageSquare,
  Pencil,
  RefreshCw,
  Trash2,
} from 'lucide-react-native';
import React, { useEffect, useState } from 'react';
import { Linking, StyleSheet, Text, View } from 'react-native';

import type { Position } from '../../../device/location';
import {
  distanceAndBearing,
  formatLatLon,
  formatMgrs,
  latLonToMgrs,
  trueToMagnetic,
} from '../../../geo/geoConverter';
import {
  cardinal,
  formatDistance,
  SENSITIVE_TYPES,
  WAYPOINT_LABELS,
  waypointMessage,
  type Waypoint,
} from '../../../geo/waypoints';
import {
  Button,
  Notice,
  Panel,
  Reading,
  ScreenTitle,
} from '../../components/controls';
import { formatNumber } from '../../format';
import { useSession } from '../../session';
import { colors, space, text } from '../../theme';
import { NavArrow, WAYPOINT_COLORS } from './markers';

/** Intervalle des mesures GPS en mode « suivre ». */
const FOLLOW_MS = 10_000;

function mgrsOf(point: Waypoint): string | null {
  try {
    return formatMgrs(latLonToMgrs(point, 5));
  } catch {
    return null;
  }
}

export function PointDetail(props: {
  point: Waypoint;
  here: Position | null;
  locate: () => Promise<Position | null>;
  locating: boolean;
  gpsError: string | null;
  onBack: () => void;
  onEdit: () => void;
  onDelete: () => Promise<void>;
  onShowOnMap: () => void;
}) {
  const { compass } = useSession();
  const { point, here, locate } = props;
  const [heading, setHeading] = useState<number | null>(null);
  const [unreliable, setUnreliable] = useState(false);
  const [declination, setDeclination] = useState<number | null>(null);
  const [follow, setFollow] = useState(false);
  const [confirm, setConfirm] = useState<'delete' | 'share' | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(
    () =>
      compass.watch(reading => {
        setHeading(reading.heading);
        setUnreliable(reading.unreliable);
      }),
    [compass],
  );

  const lat = here?.latitude;
  const lon = here?.longitude;
  useEffect(() => {
    if (lat === undefined || lon === undefined) {
      return;
    }
    let live = true;
    compass.declination(lat, lon).then(d => {
      if (live) {
        setDeclination(d);
      }
    });
    return () => {
      live = false;
    };
  }, [compass, lat, lon]);

  useEffect(() => {
    if (!follow) {
      return undefined;
    }
    const measure = () => {
      locate().catch(() => undefined);
    };
    measure();
    const timer = setInterval(measure, FOLLOW_MS);
    return () => clearInterval(timer);
  }, [follow, locate]);

  const route = here ? distanceAndBearing(here, point) : null;
  const magnetic =
    route && declination !== null
      ? trueToMagnetic(route.bearing, declination)
      : null;
  // Boussole : la flèche montre la direction réelle à suivre, téléphone à
  // plat. Sans boussole, elle est orientée nord en haut.
  const arrow =
    route === null
      ? null
      : heading !== null && declination !== null
      ? route.bearing - (heading + declination)
      : route.bearing;
  const mgrs = mgrsOf(point);
  const color = WAYPOINT_COLORS[point.type];

  const share = () => {
    setConfirm(null);
    Linking.openURL(
      `sms:?body=${encodeURIComponent(waypointMessage(point))}`,
    ).catch(() => setError('Impossible d’ouvrir l’application SMS.'));
  };

  return (
    <View style={styles.page}>
      <ScreenTitle
        title={point.label}
        onBack={props.onBack}
        backLabel="Retour aux points"
      />
      <Text style={[text.label, { color }]}>
        {WAYPOINT_LABELS[point.type]}
        {point.fromPlan ? ' · plan familial' : ''}
      </Text>

      <Panel accent={color}>
        {route === null ? (
          <Text style={text.subtle}>
            Prenez votre position pour voir la distance et la direction.
          </Text>
        ) : (
          <View style={styles.route}>
            <View
              accessible
              accessibilityLabel={`Direction : ${cardinal(route.bearing)}`}
            >
              <NavArrow angle={arrow ?? 0} size={132} color={color} />
            </View>
            <View style={styles.values}>
              <View>
                <Text style={text.label}>Distance</Text>
                <Text style={styles.big}>{formatDistance(route.distance)}</Text>
              </View>
              <View>
                <Text style={text.label}>Direction</Text>
                <Text style={styles.medium}>
                  {cardinal(route.bearing)} · {Math.round(route.bearing) % 360}°
                </Text>
              </View>
            </View>
          </View>
        )}
        {route !== null ? (
          <Text style={text.subtle}>
            {heading !== null && declination !== null
              ? 'Tenez le téléphone à plat : la flèche montre où aller.'
              : 'Flèche orientée nord en haut (boussole indisponible).'}
            {here?.stale ? ' Position ancienne : actualisez-la.' : ''}
          </Text>
        ) : null}
        {unreliable && heading !== null ? (
          <Text style={styles.warn}>
            Boussole imprécise : décrivez un « 8 » avec le téléphone, loin du
            métal.
          </Text>
        ) : null}
      </Panel>

      <View style={styles.row}>
        <Button
          compact
          icon={RefreshCw}
          label={
            props.locating ? 'Recherche du GPS…' : 'Actualiser ma position'
          }
          disabled={props.locating}
          onPress={() => {
            void locate();
          }}
          style={styles.grow}
        />
        <Button
          compact
          variant={follow ? 'primary' : 'secondary'}
          label={follow ? 'Suivi actif' : 'Suivre en marchant'}
          accessibilityLabel={
            follow
              ? 'Arrêter le suivi de la position'
              : 'Suivre la position en marchant, une mesure toutes les 10 secondes'
          }
          onPress={() => setFollow(f => !f)}
          style={styles.grow}
        />
      </View>
      {props.gpsError ? <Notice tone="error" message={props.gpsError} /> : null}

      <Panel>
        {mgrs ? <Reading label="MGRS" value={mgrs} /> : null}
        <Reading label="Degrés" value={formatLatLon(point, 'dd')} />
        <Reading label="DMS" value={formatLatLon(point, 'dms')} />
        {magnetic !== null ? (
          <Reading
            label="Cap boussole"
            value={`${formatNumber(magnetic, 0)}° (décl. ${formatNumber(
              declination ?? 0,
            )}°)`}
          />
        ) : null}
      </Panel>
      {point.notes ? <Text style={styles.notes}>{point.notes}</Text> : null}

      <Button
        icon={MapIcon}
        label="Voir sur la carte"
        onPress={props.onShowOnMap}
      />
      <Button
        icon={MessageSquare}
        label="Partager par SMS"
        onPress={() =>
          SENSITIVE_TYPES.has(point.type) ? setConfirm('share') : share()
        }
      />
      {confirm === 'share' ? (
        <Panel accent={colors.warning}>
          <Text style={styles.warn}>
            Point sensible : ses coordonnées partiront en clair par SMS.
          </Text>
          <View style={styles.row}>
            <Button
              compact
              label="Annuler"
              onPress={() => setConfirm(null)}
              style={styles.grow}
            />
            <Button
              compact
              variant="primary"
              label="Partager quand même"
              onPress={share}
              style={styles.grow}
            />
          </View>
        </Panel>
      ) : null}

      {point.fromPlan ? (
        <Text style={text.subtle}>
          Ce point vient du plan familial : modifiez-le là-bas.
        </Text>
      ) : (
        <View style={styles.row}>
          <Button
            compact
            icon={Pencil}
            label="Modifier"
            onPress={props.onEdit}
            style={styles.grow}
          />
          <Button
            compact
            variant="danger"
            icon={Trash2}
            label="Supprimer"
            onPress={() => setConfirm('delete')}
            style={styles.grow}
          />
        </View>
      )}
      {confirm === 'delete' ? (
        <Panel accent={colors.danger}>
          <Text style={text.body}>Supprimer « {point.label} » ?</Text>
          <View style={styles.row}>
            <Button
              compact
              label="Annuler"
              onPress={() => setConfirm(null)}
              style={styles.grow}
            />
            <Button
              compact
              variant="danger"
              label="Supprimer le point"
              onPress={() => {
                props
                  .onDelete()
                  .catch((e: unknown) =>
                    setError(e instanceof Error ? e.message : String(e)),
                  );
              }}
              style={styles.grow}
            />
          </View>
        </Panel>
      ) : null}
      {error ? <Notice tone="error" message={error} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  page: { gap: space.m },
  route: { flexDirection: 'row', alignItems: 'center', gap: space.l },
  values: { flex: 1, minWidth: 0, gap: space.m },
  big: { ...text.value, fontSize: 30 },
  medium: { ...text.value, fontSize: 18 },
  row: { flexDirection: 'row', gap: space.s, flexWrap: 'wrap' },
  grow: { flex: 1, minWidth: 140 },
  warn: { color: colors.warning, fontSize: 14, fontWeight: '600' },
  notes: { color: colors.text, fontSize: 15, lineHeight: 22 },
});
