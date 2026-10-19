/** Icônes, couleurs et flèche de direction des points de repère. */
import {
  Archive,
  Droplet,
  House,
  MapPin,
  ShoppingBasket,
  Tent,
  TriangleAlert,
  Users,
  type LucideIcon,
} from 'lucide-react-native';
import React from 'react';
import { View } from 'react-native';
import Svg, { Circle, G, Path } from 'react-native-svg';

import type { WaypointType } from '../../../geo/waypoints';
import { colors } from '../../theme';

export const WAYPOINT_ICONS: Record<WaypointType, LucideIcon> = {
  home: House,
  meeting: Users,
  water_source: Droplet,
  shelter: Tent,
  resource: ShoppingBasket,
  cache: Archive,
  danger: TriangleAlert,
  other: MapPin,
};

export const WAYPOINT_COLORS: Record<WaypointType, string> = {
  home: colors.primary,
  meeting: colors.purple,
  water_source: colors.water,
  shelter: colors.equipment,
  resource: colors.food,
  cache: colors.tools,
  danger: colors.danger,
  other: colors.cyan,
};

/**
 * Flèche de direction : `angle` en degrés, 0 vers le haut de l'écran, dans
 * le sens des aiguilles d'une montre.
 */
export function NavArrow(props: {
  angle: number;
  size: number;
  color?: string;
}) {
  const { size } = props;
  const c = size / 2;
  const r = size * 0.36;
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
        <G rotation={props.angle} origin={`${c}, ${c}`}>
          <Path
            d={`M${c} ${c - r} L${c + r * 0.55} ${c + r * 0.7} L${c} ${
              c + r * 0.35
            } L${c - r * 0.55} ${c + r * 0.7} Z`}
            fill={props.color ?? colors.primary}
          />
        </G>
      </Svg>
    </View>
  );
}
