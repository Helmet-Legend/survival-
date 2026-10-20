/**
 * Carte hors ligne et zones téléchargées : la carte avec les points, puis la
 * liste des zones gardées dans le coffre et le téléchargement d'une zone
 * autour du centre de la carte.
 */
import { Download, Trash2 } from 'lucide-react-native';
import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import type { Position } from '../../../device/location';
import type { LatLon } from '../../../geo/geoConverter';
import {
  AREA_RADII,
  DownloadError,
  downloadArea,
  formatBytes,
  IGN_PLAN,
  planArea,
  type DownloadControl,
  type DownloadProgress,
  type MapArea,
} from '../../../geo/tiles';
import type { Waypoint } from '../../../geo/waypoints';
import {
  Button,
  Chip,
  Field,
  Gauge,
  Notice,
  Panel,
} from '../../components/controls';
import { formatNumber } from '../../format';
import { useSession } from '../../session';
import { colors, radius as corners, space, text, tint } from '../../theme';
import { useLoader } from '../../useLoader';
import { clearTileCache, OfflineMap, type MapView } from './OfflineMap';
import { loadAllPoints } from './PointsView';

/** Zoom affiché pour voir une zone de ce rayon en entier. */
function zoomFor(radiusKm: number): number {
  return radiusKm <= 2 ? 14 : radiusKm <= 5 ? 13 : radiusKm <= 10 ? 12 : 11;
}

/** Vue de départ : ma position, sinon la première zone, sinon la France. */
function firstView(
  here: Position | null,
  areas: MapArea[],
  points: Waypoint[],
): MapView {
  if (here) {
    return { center: here, zoom: 15 };
  }
  if (areas.length > 0) {
    return { center: areas[0], zoom: zoomFor(areas[0].radiusKm) };
  }
  if (points.length > 0) {
    return { center: points[0], zoom: 13 };
  }
  return { center: { latitude: 46.6, longitude: 2.4 }, zoom: 5 };
}

export function MapPanel(props: {
  view: MapView | null;
  setView: (view: MapView) => void;
  here: Position | null;
  locate: () => Promise<Position | null>;
  locating: boolean;
  gpsError: string | null;
  onPointPress: (point: Waypoint) => void;
  onLongPress: (at: LatLon) => void;
  onTouching: (touching: boolean) => void;
}) {
  const session = useSession();
  const { tiles } = session;
  const { setView } = props;
  const { data, reload } = useLoader(async () => {
    const [areas, bytes, points] = await Promise.all([
      tiles.listAreas(),
      tiles.storedBytes(),
      loadAllPoints(session),
    ]);
    return { areas, bytes, points };
  });
  const view =
    props.view ??
    (data ? firstView(props.here, data.areas, data.points) : null);
  const [picking, setPicking] = useState(false);
  const [radius, setRadius] = useState(AREA_RADII[1]);
  const [label, setLabel] = useState('');
  const [progress, setProgress] = useState<DownloadProgress | null>(null);
  const [notice, setNotice] = useState<{
    tone: 'ok' | 'error';
    message: string;
  } | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const control = useRef<DownloadControl | null>(null);
  const [revision, setRevision] = useState(0);
  const refreshTiles = () => {
    clearTileCache();
    setRevision(r => r + 1);
  };

  // Quitter l'écran arrête le téléchargement ; « Reprendre » le continue.
  useEffect(
    () => () => {
      if (control.current) {
        control.current.cancelled = true;
      }
    },
    [],
  );

  const run = async (area: MapArea) => {
    const ctl: DownloadControl = { cancelled: false };
    control.current = ctl;
    setNotice(null);
    setProgress({ done: 0, total: 0, failed: 0 });
    try {
      const result = await downloadArea(
        tiles,
        area,
        IGN_PLAN,
        session.tileFetch,
        { control: ctl, onProgress: setProgress },
      );
      setNotice(
        ctl.cancelled
          ? {
              tone: 'error',
              message: 'Téléchargement interrompu : « Reprendre » le continue.',
            }
          : result.failed > 0
          ? {
              tone: 'error',
              message: `${result.failed} tuiles manquantes : « Reprendre » pour réessayer.`,
            }
          : {
              tone: 'ok',
              message: `« ${area.label} » est disponible hors ligne.`,
            },
      );
    } catch (e) {
      setNotice({
        tone: 'error',
        message:
          e instanceof DownloadError || e instanceof Error
            ? e.message
            : String(e),
      });
    } finally {
      control.current = null;
      setProgress(null);
      refreshTiles();
      await reload();
    }
  };

  const start = async () => {
    if (view === null) {
      return;
    }
    try {
      const area = await tiles.createArea({
        label: label.trim() === '' ? `Zone de ${radius.km} km` : label,
        center: view.center,
        radiusKm: radius.km,
        maxZoom: radius.maxZoom,
        source: IGN_PLAN,
      });
      setPicking(false);
      setLabel('');
      await run(area);
    } catch (e) {
      setNotice({
        tone: 'error',
        message: e instanceof Error ? e.message : String(e),
      });
    }
  };

  if (view === null) {
    return null;
  }
  const plan = planArea(view.center, radius.km, radius.maxZoom);
  const busy = progress !== null;

  return (
    <View style={styles.page}>
      <View>
        <OfflineMap
          store={tiles}
          view={view}
          onViewChange={setView}
          points={data?.points ?? []}
          here={props.here}
          onPointPress={props.onPointPress}
          onLongPress={props.onLongPress}
          onLocate={() => {
            props
              .locate()
              .then(fix => {
                if (fix) {
                  setView({ center: fix, zoom: Math.max(view.zoom, 15) });
                }
              })
              .catch(() => undefined);
          }}
          locating={props.locating}
          crosshair={picking}
          revision={revision}
          attribution={IGN_PLAN.attribution}
          height={380}
          onTouching={props.onTouching}
        />
        {data && data.areas.length === 0 && !busy && !picking ? (
          <View pointerEvents="none" style={styles.empty}>
            <Text style={styles.emptyTitle}>Aucune carte téléchargée</Text>
            <Text style={styles.emptyText}>
              Placez la zone voulue au centre, puis « Télécharger une zone ».
            </Text>
          </View>
        ) : null}
      </View>
      <Text style={text.subtle}>
        Glissez pour déplacer, pincez ou + / − pour zoomer. Appui long : nouveau
        point à cet endroit.
      </Text>
      {props.gpsError ? <Notice tone="error" message={props.gpsError} /> : null}
      {notice ? <Notice tone={notice.tone} message={notice.message} /> : null}

      {busy ? (
        <Panel title="Téléchargement" accent={colors.primary}>
          <Gauge
            value={progress.total === 0 ? 0 : progress.done / progress.total}
            color={colors.primary}
          />
          <Text style={text.subtle}>
            {formatNumber(progress.done, 0)} / {formatNumber(progress.total, 0)}{' '}
            tuiles. Restez sur cet écran jusqu’à la fin.
          </Text>
          <Button
            compact
            label="Arrêter"
            onPress={() => {
              if (control.current) {
                control.current.cancelled = true;
              }
            }}
          />
        </Panel>
      ) : picking ? (
        <Panel title="Télécharger une zone" accent={colors.primary}>
          <Text style={text.muted}>
            La zone est centrée sur la croix : déplacez la carte pour la
            choisir.
          </Text>
          <View style={styles.chips}>
            {AREA_RADII.map(r => (
              <Chip
                key={r.km}
                label={`${r.km} km`}
                selected={radius.km === r.km}
                onPress={() => setRadius(r)}
              />
            ))}
          </View>
          <Text style={text.subtle}>
            {formatNumber(plan.tiles, 0)} tuiles, environ{' '}
            {formatBytes(plan.estimatedBytes)} (estimation) · détail{' '}
            {radius.maxZoom >= 16
              ? 'des rues'
              : radius.maxZoom >= 15
              ? 'des chemins'
              : 'des routes'}
          </Text>
          <Field
            label="Nom de la zone"
            value={label}
            onChangeText={setLabel}
            placeholder={`Zone de ${radius.km} km`}
            maxLength={60}
          />
          <Text style={text.subtle}>
            Les tuiles viennent du Plan IGN (France et outre-mer) : le serveur
            de l’IGN voit la zone demandée et l’adresse internet du téléphone,
            comme pour tout site. Ensuite, la carte est gardée chiffrée dans le
            coffre et marche sans réseau.
          </Text>
          <View style={styles.row}>
            <Button
              compact
              label="Annuler"
              onPress={() => setPicking(false)}
              style={styles.grow}
            />
            <Button
              compact
              variant="primary"
              icon={Download}
              label="Télécharger"
              accessibilityLabel={`Télécharger la zone de ${radius.km} km`}
              onPress={() => {
                void start();
              }}
              style={styles.grow}
            />
          </View>
        </Panel>
      ) : (
        <Button
          variant="primary"
          icon={Download}
          label="Télécharger une zone"
          onPress={() => {
            setNotice(null);
            setPicking(true);
          }}
        />
      )}

      <Text style={[text.label, styles.section]}>Cartes hors ligne</Text>
      {data && data.areas.length === 0 ? (
        <Text style={text.subtle}>
          Aucune zone téléchargée : sans carte, les points restent placés sur un
          quadrillage.
        </Text>
      ) : null}
      {(data?.areas ?? []).map(area => (
        <Panel key={area.id}>
          <Text style={styles.title}>{area.label}</Text>
          <Text style={text.subtle}>
            Rayon {formatNumber(area.radiusKm, 0)} km ·{' '}
            {formatNumber(area.tiles, 0)} tuiles
            {area.complete ? '' : ' · incomplète'}
          </Text>
          <View style={styles.row}>
            <Button
              compact
              label="Afficher"
              accessibilityLabel={`Afficher la zone ${area.label}`}
              onPress={() =>
                setView({ center: area, zoom: zoomFor(area.radiusKm) })
              }
              style={styles.grow}
            />
            {area.complete ? null : (
              <Button
                compact
                label="Reprendre"
                accessibilityLabel={`Reprendre le téléchargement de ${area.label}`}
                disabled={busy}
                onPress={() => {
                  void run(area);
                }}
                style={styles.grow}
              />
            )}
            <Button
              compact
              variant="danger"
              icon={Trash2}
              label="Supprimer"
              accessibilityLabel={`Supprimer la zone ${area.label}`}
              disabled={busy}
              onPress={() => setDeleting(area.id)}
              style={styles.grow}
            />
          </View>
          {deleting === area.id ? (
            <View style={styles.row}>
              <Button
                compact
                label="Garder"
                onPress={() => setDeleting(null)}
                style={styles.grow}
              />
              <Button
                compact
                variant="danger"
                label="Supprimer la carte"
                onPress={() => {
                  setDeleting(null);
                  tiles
                    .deleteArea(area.id)
                    .then(() => {
                      refreshTiles();
                      return reload();
                    })
                    .catch(() => undefined);
                }}
                style={styles.grow}
              />
            </View>
          ) : null}
        </Panel>
      ))}
      {data && data.bytes > 0 ? (
        <Text style={text.subtle}>
          Place occupée par les cartes : {formatBytes(data.bytes)}.
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  page: { gap: space.m },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.s },
  row: { flexDirection: 'row', gap: space.s, flexWrap: 'wrap' },
  grow: { flex: 1, minWidth: 0 },
  section: { marginTop: space.s },
  title: { color: colors.text, fontSize: 16, fontWeight: '600' },
  empty: {
    position: 'absolute',
    left: space.l,
    right: space.l,
    top: 210,
    padding: space.m,
    gap: 4,
    borderRadius: corners.card,
    backgroundColor: tint(colors.bg, 'e6'),
    borderColor: colors.border,
    borderWidth: 1,
    alignItems: 'center',
  },
  emptyTitle: { color: colors.text, fontSize: 15, fontWeight: '700' },
  emptyText: { ...text.subtle, textAlign: 'center' },
});
