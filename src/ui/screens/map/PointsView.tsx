/**
 * Points de repère : liste avec distance et direction depuis ma position,
 * enregistrement en un appui, fiche d'un point.
 */
import { ChevronRight, MapPinPlus, Plus } from 'lucide-react-native';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { Position } from '../../../device/location';
import type { LatLon } from '../../../geo/geoConverter';
import {
  describeFrom,
  planWaypoints,
  WAYPOINT_LABELS,
  type Waypoint,
} from '../../../geo/waypoints';
import { loadFamilyPlan } from '../../../plan/familyPlan';
import { Button, EmptyState, Notice } from '../../components/controls';
import { formatNumber } from '../../format';
import { useSession } from '../../session';
import { colors, radius, space, text, tint } from '../../theme';
import { useLoader } from '../../useLoader';
import { WAYPOINT_COLORS, WAYPOINT_ICONS } from './markers';
import { PointDetail } from './PointDetail';
import { PointForm } from './PointForm';

export type PointsRoute =
  | { kind: 'list' }
  | { kind: 'new'; at: LatLon | null }
  | { kind: 'edit'; id: string }
  | { kind: 'detail'; id: string };

/** Points enregistrés suivis de ceux du plan familial. */
export async function loadAllPoints(
  session: ReturnType<typeof useSession>,
): Promise<Waypoint[]> {
  const [own, plan] = await Promise.all([
    session.waypoints.list(),
    loadFamilyPlan(session.db),
  ]);
  return [...own, ...planWaypoints(plan)];
}

export function PointsView(props: {
  route: PointsRoute;
  setRoute: (route: PointsRoute) => void;
  here: Position | null;
  locate: () => Promise<Position | null>;
  locating: boolean;
  gpsError: string | null;
  onShowOnMap: (point: Waypoint) => void;
}) {
  const session = useSession();
  const { route, setRoute, here, locate } = props;
  const {
    data: points,
    error,
    reload,
  } = useLoader(() => loadAllPoints(session));

  if (route.kind === 'new' || route.kind === 'edit') {
    const point =
      route.kind === 'edit' ? points?.find(p => p.id === route.id) : undefined;
    if (route.kind === 'edit' && point === undefined) {
      return null;
    }
    return (
      <PointForm
        key={route.kind === 'edit' ? route.id : 'new'}
        point={point}
        at={route.kind === 'new' ? route.at : null}
        locate={locate}
        locating={props.locating}
        onCancel={() =>
          setRoute(point ? { kind: 'detail', id: point.id } : { kind: 'list' })
        }
        onSave={async input => {
          const saved = point
            ? await session.waypoints.update(point.id, input)
            : await session.waypoints.create(input);
          await reload();
          setRoute({ kind: 'detail', id: saved.id });
        }}
      />
    );
  }

  if (route.kind === 'detail') {
    const point = points?.find(p => p.id === route.id);
    if (point === undefined) {
      return points === null ? null : (
        <Button
          label="Retour aux points"
          onPress={() => setRoute({ kind: 'list' })}
        />
      );
    }
    return (
      <PointDetail
        point={point}
        here={here}
        locate={locate}
        locating={props.locating}
        gpsError={props.gpsError}
        onBack={() => setRoute({ kind: 'list' })}
        onEdit={() => setRoute({ kind: 'edit', id: point.id })}
        onDelete={async () => {
          await session.waypoints.remove(point.id);
          await reload();
          setRoute({ kind: 'list' });
        }}
        onShowOnMap={() => props.onShowOnMap(point)}
      />
    );
  }

  const saveHere = async () => {
    const fix = await locate();
    if (fix !== null) {
      setRoute({ kind: 'new', at: fix });
    }
  };

  return (
    <View style={styles.page}>
      <View style={styles.row}>
        <Button
          variant="primary"
          icon={MapPinPlus}
          label={
            props.locating ? 'Recherche du GPS…' : 'Enregistrer ma position'
          }
          accessibilityLabel="Enregistrer ma position GPS comme point"
          disabled={props.locating}
          onPress={() => {
            void saveHere();
          }}
          style={styles.grow}
        />
        <Button
          icon={Plus}
          label="Saisir un point"
          onPress={() => setRoute({ kind: 'new', at: null })}
          style={styles.grow}
        />
      </View>
      {props.gpsError ? <Notice tone="error" message={props.gpsError} /> : null}
      {here ? (
        <Text style={text.subtle}>
          Distances depuis{' '}
          {here.stale ? 'ma dernière position connue' : 'ma position'}
          {here.accuracy === null
            ? ''
            : ` (± ${formatNumber(here.accuracy, 0)} m)`}
          .
        </Text>
      ) : points && points.length > 0 ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            void locate();
          }}
        >
          <Text style={styles.link}>
            Prendre ma position pour voir distances et directions
          </Text>
        </Pressable>
      ) : null}
      {error ? <Notice tone="error" message={error} /> : null}
      {points !== null && points.length === 0 ? (
        <EmptyState
          icon={MapPinPlus}
          title="Aucun point enregistré"
          message="Domicile, point de regroupement, source d’eau, abri… Enregistrez-les pour retrouver leur direction sans réseau."
        />
      ) : null}
      {(points ?? []).map(point => (
        <PointRow
          key={point.id}
          point={point}
          here={here}
          onPress={() => setRoute({ kind: 'detail', id: point.id })}
        />
      ))}
    </View>
  );
}

function PointRow(props: {
  point: Waypoint;
  here: Position | null;
  onPress: () => void;
}) {
  const { point, here } = props;
  const Icon = WAYPOINT_ICONS[point.type];
  const color = WAYPOINT_COLORS[point.type];
  const where = here ? describeFrom(here, point) : null;
  const kind = `${WAYPOINT_LABELS[point.type]}${
    point.fromPlan ? ' · plan familial' : ''
  }`;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${point.label}, ${kind}${where ? `, ${where}` : ''}`}
      onPress={props.onPress}
      style={({ pressed }) => [styles.item, pressed && styles.pressed]}
    >
      <View style={[styles.icon, { backgroundColor: tint(color, '1a') }]}>
        <Icon color={color} size={20} strokeWidth={2} />
      </View>
      <View style={styles.grow}>
        <Text style={styles.title} numberOfLines={1}>
          {point.label}
        </Text>
        <Text style={text.subtle}>{kind}</Text>
        {where ? <Text style={styles.where}>{where}</Text> : null}
      </View>
      <ChevronRight color={colors.textMuted} size={20} strokeWidth={2} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  page: { gap: space.m },
  row: { flexDirection: 'row', gap: space.s, flexWrap: 'wrap' },
  grow: { flex: 1, minWidth: 0 },
  link: { color: colors.cyan, fontSize: 14, fontWeight: '600' },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.m,
    minHeight: 64,
    paddingHorizontal: space.m,
    paddingVertical: space.s,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.card,
  },
  icon: {
    width: 38,
    height: 38,
    borderRadius: radius.s,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { color: colors.text, fontSize: 16, fontWeight: '600' },
  where: {
    color: colors.cyanSoft,
    fontSize: 14,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  pressed: { opacity: 0.82 },
});
