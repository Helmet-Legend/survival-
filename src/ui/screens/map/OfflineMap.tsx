/**
 * Carte hors ligne : tuiles lues dans le coffre, déplacement au doigt, zoom
 * par pincement ou boutons, points de repère et position du moment. Appui
 * long : nouveau point à cet endroit. Sans tuile, un quadrillage garde les
 * points lisibles.
 */
import { Crosshair, LocateFixed, Minus, Plus } from 'lucide-react-native';
import React, { memo, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Image,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
  type GestureResponderEvent,
  type LayoutChangeEvent,
} from 'react-native';

import type { Position } from '../../../device/location';
import type { LatLon } from '../../../geo/geoConverter';
import {
  metersPerPixel,
  project,
  TILE_SIZE,
  unproject,
  type FoundTile,
  type MapTileStore,
} from '../../../geo/tiles';
import { formatDistance, type Waypoint } from '../../../geo/waypoints';
import { colors, radius, space } from '../../theme';
import { WAYPOINT_COLORS, WAYPOINT_ICONS } from './markers';

export const MAP_MIN_ZOOM = 5;
export const MAP_MAX_ZOOM = 18;

export interface MapView {
  center: LatLon;
  zoom: number;
}

// Tuiles déjà lues, partagées entre les affichages de la carte.
const cache = new Map<string, FoundTile | null>();
const CACHE_MAX = 300;

export function clearTileCache() {
  cache.clear();
}

function useTile(
  store: MapTileStore,
  z: number,
  x: number,
  y: number,
  revision: number,
) {
  const key = `${z}/${x}/${y}`;
  const [tile, setTile] = useState<FoundTile | null | undefined>(() =>
    cache.get(key),
  );
  useEffect(() => {
    if (cache.has(key)) {
      setTile(cache.get(key));
      return undefined;
    }
    let live = true;
    store
      .findTile(z, x, y)
      .then(found => {
        if (cache.size >= CACHE_MAX) {
          cache.delete(cache.keys().next().value as string);
        }
        cache.set(key, found);
        if (live) {
          setTile(found);
        }
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [store, key, z, x, y, revision]);
  return tile;
}

const Tile = memo(function TileView(props: {
  store: MapTileStore;
  z: number;
  x: number;
  y: number;
  left: number;
  top: number;
  revision: number;
}) {
  const n = 2 ** props.z;
  // Longitude qui fait le tour du monde.
  const wrapped = ((props.x % n) + n) % n;
  const tile = useTile(props.store, props.z, wrapped, props.y, props.revision);
  const box = { left: props.left, top: props.top };
  if (!tile) {
    return <View style={[styles.tile, styles.empty, box]} />;
  }
  const scale = 2 ** tile.up;
  return (
    <View style={[styles.tile, box]}>
      <Image
        source={{ uri: tile.data }}
        style={[
          styles.tileImage,
          {
            width: TILE_SIZE * scale,
            height: TILE_SIZE * scale,
            left: -tile.offsetX * TILE_SIZE * scale,
            top: -tile.offsetY * TILE_SIZE * scale,
          },
        ]}
      />
    </View>
  );
});

function distance(e: GestureResponderEvent): number | null {
  const t = e.nativeEvent.touches;
  if (t.length < 2) {
    return null;
  }
  return Math.hypot(t[0].pageX - t[1].pageX, t[0].pageY - t[1].pageY);
}

/** Longueur ronde de l'échelle (1, 2 ou 5 × 10ⁿ m) tenant dans `maxPx`. */
function scaleBar(latitude: number, zoom: number, maxPx: number) {
  const mpp = metersPerPixel(latitude, zoom);
  const max = mpp * maxPx;
  const pow = 10 ** Math.floor(Math.log10(max));
  const meters = [5, 2, 1].map(f => f * pow).find(m => m <= max) ?? pow;
  return { meters, px: meters / mpp };
}

export function OfflineMap(props: {
  store: MapTileStore;
  view: MapView;
  onViewChange: (view: MapView) => void;
  points: Waypoint[];
  here: Position | null;
  onPointPress: (point: Waypoint) => void;
  onLongPress: (at: LatLon) => void;
  onLocate?: () => void;
  locating?: boolean;
  /** Croix au centre (zone à télécharger). */
  crosshair?: boolean;
  attribution: string;
  height: number;
  /** À incrémenter quand des tuiles ont été ajoutées ou supprimées. */
  revision?: number;
  /** Doigt posé sur la carte : la page ne doit pas défiler. */
  onTouching?: (touching: boolean) => void;
}) {
  const { view, onViewChange } = props;
  const [width, setWidth] = useState(0);
  const height = props.height;
  const pan = useRef(new Animated.ValueXY()).current;
  const pinch = useRef(new Animated.Value(1)).current;
  const gesture = useRef({ startDistance: 0, scale: 1 });
  const viewRef = useRef(view);
  viewRef.current = view;
  const changeRef = useRef(onViewChange);
  changeRef.current = onViewChange;

  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: e => e.nativeEvent.touches.length >= 2,
        onMoveShouldSetPanResponder: (e, g) =>
          e.nativeEvent.touches.length >= 2 ||
          Math.abs(g.dx) > 4 ||
          Math.abs(g.dy) > 4,
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: e => {
          gesture.current = { startDistance: distance(e) ?? 0, scale: 1 };
        },
        onPanResponderMove: (e, g) => {
          const d = distance(e);
          if (d !== null) {
            if (gesture.current.startDistance === 0) {
              gesture.current.startDistance = d;
            }
            gesture.current.scale = d / gesture.current.startDistance;
            pinch.setValue(gesture.current.scale);
          }
          pan.setValue({ x: g.dx, y: g.dy });
        },
        onPanResponderRelease: (_e, g) => {
          const current = viewRef.current;
          const c = project(current.center, current.zoom);
          const step = Math.round(Math.log2(gesture.current.scale));
          const zoom = Math.max(
            MAP_MIN_ZOOM,
            Math.min(MAP_MAX_ZOOM, current.zoom + step),
          );
          const center = unproject(c.x - g.dx, c.y - g.dy, current.zoom);
          pan.setValue({ x: 0, y: 0 });
          pinch.setValue(1);
          changeRef.current({ center, zoom });
        },
        onPanResponderTerminate: () => {
          pan.setValue({ x: 0, y: 0 });
          pinch.setValue(1);
        },
      }),
    [pan, pinch],
  );

  const zoomBy = (step: number) =>
    onViewChange({
      center: view.center,
      zoom: Math.max(MAP_MIN_ZOOM, Math.min(MAP_MAX_ZOOM, view.zoom + step)),
    });

  const c = project(view.center, view.zoom);
  const originX = c.x - width / 2;
  const originY = c.y - height / 2;
  const tiles: React.ReactNode[] = [];
  if (width > 0) {
    // Une tuile de marge pour le déplacement au doigt.
    const x0 = Math.floor(originX / TILE_SIZE) - 1;
    const x1 = Math.floor((originX + width) / TILE_SIZE) + 1;
    const y0 = Math.max(0, Math.floor(originY / TILE_SIZE) - 1);
    const y1 = Math.min(
      2 ** view.zoom - 1,
      Math.floor((originY + height) / TILE_SIZE) + 1,
    );
    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) {
        tiles.push(
          <Tile
            key={`${view.zoom}/${x}/${y}`}
            store={props.store}
            z={view.zoom}
            x={x}
            y={y}
            left={x * TILE_SIZE - originX}
            top={y * TILE_SIZE - originY}
            revision={props.revision ?? 0}
          />,
        );
      }
    }
  }
  const toScreen = (p: LatLon) => {
    const w = project(p, view.zoom);
    return { left: w.x - originX, top: w.y - originY };
  };
  const visible = (s: { left: number; top: number }) =>
    s.left > -40 && s.left < width + 40 && s.top > -40 && s.top < height + 40;
  const bar = scaleBar(
    view.center.latitude,
    view.zoom,
    Math.min(120, width / 3),
  );
  const here = props.here ? toScreen(props.here) : null;
  const accuracyPx =
    props.here?.accuracy != null
      ? props.here.accuracy / metersPerPixel(props.here.latitude, view.zoom)
      : 0;

  return (
    <View
      style={[styles.frame, { height }]}
      onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)}
      accessibilityLabel="Carte hors ligne"
      onTouchStart={() => props.onTouching?.(true)}
      onTouchEnd={() => props.onTouching?.(false)}
      onTouchCancel={() => props.onTouching?.(false)}
      {...responder.panHandlers}
    >
      <Animated.View
        style={[
          StyleSheet.absoluteFill,
          {
            transform: [
              { translateX: pan.x },
              { translateY: pan.y },
              { scale: pinch },
            ],
          },
        ]}
      >
        <Pressable
          style={StyleSheet.absoluteFill}
          delayLongPress={600}
          accessibilityLabel="Appui long pour ajouter un point ici"
          onLongPress={e => {
            const { locationX, locationY } = e.nativeEvent;
            props.onLongPress(
              unproject(originX + locationX, originY + locationY, view.zoom),
            );
          }}
        >
          {/* Les tuiles ne captent pas le doigt : `locationX` est relatif à
              la vue touchée, il doit l'être à la carte entière. */}
          <View pointerEvents="none" style={StyleSheet.absoluteFill}>
            {tiles}
          </View>
        </Pressable>
        {here && visible(here) ? (
          <View
            pointerEvents="none"
            style={[styles.anchor, { left: here.left, top: here.top }]}
          >
            {accuracyPx > 12 ? (
              <View
                style={[
                  styles.accuracy,
                  {
                    width: accuracyPx * 2,
                    height: accuracyPx * 2,
                    borderRadius: accuracyPx,
                    left: -accuracyPx,
                    top: -accuracyPx,
                  },
                ]}
              />
            ) : null}
            <View style={styles.hereDot} />
          </View>
        ) : null}
        {props.points.map(point => {
          const s = toScreen(point);
          if (!visible(s)) {
            return null;
          }
          const Icon = WAYPOINT_ICONS[point.type];
          const color = WAYPOINT_COLORS[point.type];
          return (
            <View
              key={point.id}
              style={[styles.anchor, { left: s.left, top: s.top }]}
            >
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Point ${point.label}`}
                hitSlop={8}
                onPress={() => props.onPointPress(point)}
                style={[styles.marker, { borderColor: color }]}
              >
                <Icon color={color} size={16} strokeWidth={2.4} />
              </Pressable>
              {view.zoom >= 13 ? (
                <Text style={styles.markerLabel} numberOfLines={1}>
                  {point.label}
                </Text>
              ) : null}
            </View>
          );
        })}
      </Animated.View>

      {props.crosshair ? (
        <View pointerEvents="none" style={styles.crosshair}>
          <Crosshair color={colors.primary} size={36} strokeWidth={1.6} />
        </View>
      ) : null}

      <View style={styles.controls}>
        <MapButton label="Zoom avant" onPress={() => zoomBy(1)}>
          <Plus color={colors.text} size={20} />
        </MapButton>
        <MapButton label="Zoom arrière" onPress={() => zoomBy(-1)}>
          <Minus color={colors.text} size={20} />
        </MapButton>
        {props.onLocate ? (
          <MapButton
            label={
              props.locating ? 'Recherche du GPS…' : 'Centrer sur ma position'
            }
            onPress={props.onLocate}
          >
            <LocateFixed
              color={props.locating ? colors.textMuted : colors.cyan}
              size={20}
            />
          </MapButton>
        ) : null}
      </View>

      <View pointerEvents="none" style={styles.footer}>
        <View>
          <View style={[styles.bar, { width: bar.px }]} />
          <Text style={styles.small}>{formatDistance(bar.meters)}</Text>
        </View>
        <Text style={styles.small} numberOfLines={1}>
          {props.attribution}
        </Text>
      </View>
    </View>
  );
}

function MapButton(props: {
  label: string;
  onPress: () => void;
  children: React.ReactNode;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={props.label}
      onPress={props.onPress}
      style={({ pressed }) => [styles.mapButton, pressed && styles.pressed]}
    >
      {props.children}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  frame: {
    overflow: 'hidden',
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgElevated,
  },
  tile: {
    position: 'absolute',
    width: TILE_SIZE,
    height: TILE_SIZE,
    overflow: 'hidden',
  },
  tileImage: { position: 'absolute' },
  empty: {
    borderColor: colors.border,
    borderWidth: StyleSheet.hairlineWidth,
  },
  anchor: { position: 'absolute', width: 0, height: 0, alignItems: 'center' },
  marker: {
    position: 'absolute',
    top: -16,
    left: -16,
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bg,
  },
  markerLabel: {
    position: 'absolute',
    top: 18,
    width: 120,
    left: -60,
    textAlign: 'center',
    color: colors.text,
    fontSize: 12,
    fontWeight: '700',
    textShadowColor: colors.bg,
    textShadowRadius: 3,
  },
  hereDot: {
    position: 'absolute',
    top: -9,
    left: -9,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: colors.cyan,
    borderWidth: 3,
    borderColor: colors.text,
  },
  accuracy: {
    position: 'absolute',
    backgroundColor: 'rgba(53, 217, 255, 0.15)',
    borderColor: 'rgba(53, 217, 255, 0.5)',
    borderWidth: 1,
  },
  crosshair: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    marginTop: -18,
    marginLeft: -18,
  },
  controls: {
    position: 'absolute',
    right: space.s,
    top: space.s,
    gap: space.s,
  },
  mapButton: {
    width: 44,
    height: 44,
    borderRadius: radius.m,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(3, 9, 13, 0.86)',
    borderWidth: 1,
    borderColor: colors.border,
  },
  pressed: { opacity: 0.8 },
  footer: {
    position: 'absolute',
    left: space.s,
    right: space.s,
    bottom: space.xs,
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: space.s,
  },
  bar: {
    height: 4,
    borderColor: colors.text,
    borderWidth: 1.5,
    borderTopWidth: 0,
  },
  small: {
    color: colors.text,
    fontSize: 11,
    fontWeight: '600',
    textShadowColor: colors.bg,
    textShadowRadius: 3,
    flexShrink: 1,
  },
});
