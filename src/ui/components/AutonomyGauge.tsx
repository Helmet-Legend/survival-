/**
 * Jauge circulaire d'autonomie : anneau orange sur piste sombre, nombre de
 * jours au centre (sur fond noir plein, lisible sur la photo de l'accueil)
 * et goutte cyan. Le remplissage représente la part de
 * l'objectif couverte (plafonnée à 100 %).
 */
import { Droplet } from 'lucide-react-native';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

import { formatNumber } from '../format';
import { colors, fonts, space } from '../theme';

const SIZE = 232;
const STROKE = 14;

export function AutonomyGauge(props: {
  days: number;
  targetDays: number;
  /** Couleur de l'anneau (orange par défaut, rouge si critique). */
  color?: string;
}) {
  const color = props.color ?? colors.primary;
  const fraction =
    props.targetDays > 0
      ? Math.max(0, Math.min(1, props.days / props.targetDays))
      : 0;
  const r = (SIZE - STROKE * 2) / 2;
  const circumference = 2 * Math.PI * r;
  const center = SIZE / 2;
  const arc = {
    cx: center,
    cy: center,
    r,
    fill: 'none',
    strokeDasharray: `${circumference} ${circumference}`,
    strokeDashoffset: circumference * (1 - fraction),
    strokeLinecap: 'round' as const,
    transform: `rotate(-90 ${center} ${center})`,
  };

  return (
    <View style={styles.wrap}>
      <Svg width={SIZE} height={SIZE} style={StyleSheet.absoluteFill}>
        <Circle
          cx={center}
          cy={center}
          r={r + STROKE / 2 + 3}
          stroke={colors.border}
          strokeWidth={1}
          fill={colors.bg}
        />
        <Circle
          cx={center}
          cy={center}
          r={r}
          stroke={colors.border}
          strokeWidth={STROKE}
          fill="none"
        />
        {fraction > 0 ? (
          <>
            <Circle
              {...arc}
              stroke={color}
              strokeOpacity={0.22}
              strokeWidth={STROKE + 10}
            />
            <Circle {...arc} stroke={color} strokeWidth={STROKE} />
          </>
        ) : null}
      </Svg>
      <Text style={styles.title}>Autonomie du foyer</Text>
      <Text
        style={[styles.days, { color: colors.primaryBright }]}
        accessibilityLabel={`${props.days} jours`}
        numberOfLines={1}
        adjustsFontSizeToFit
      >
        {formatNumber(props.days, 0)}
      </Text>
      <Text style={styles.unit}>{props.days > 1 ? 'jours' : 'jour'}</Text>
      <View style={styles.drop}>
        <Droplet color={colors.cyan} fill={colors.cyan} size={20} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    width: SIZE,
    height: SIZE,
    alignSelf: 'center',
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    color: colors.text,
    fontFamily: fonts.display,
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 1,
    lineHeight: 19,
    maxWidth: 120,
    textAlign: 'center',
    textTransform: 'uppercase',
  },
  days: {
    fontFamily: fonts.display,
    fontSize: 64,
    fontWeight: '800',
    lineHeight: 70,
    maxWidth: SIZE - STROKE * 4,
    fontVariant: ['tabular-nums'],
  },
  unit: {
    color: colors.primary,
    fontFamily: fonts.display,
    fontSize: 18,
    fontWeight: '700',
    marginTop: -space.xs,
  },
  drop: { marginTop: space.s },
});
