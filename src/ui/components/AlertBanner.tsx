/**
 * Bandeau « Alerte en cours » : rouge ou orange pour une vigilance forte,
 * discret en jaune. Un appui ouvre l'écran des alertes.
 */
import { ChevronRight, TriangleAlert } from 'lucide-react-native';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { maxLevel, type Alert, type AlertLevel } from '../../alerts/types';
import { colors, radius, solidTint, space, text, tint } from '../theme';

export const LEVEL_COLORS: Record<AlertLevel, string> = {
  yellow: colors.warning,
  orange: colors.primary,
  red: colors.danger,
};

export function AlertBanner(props: {
  alerts: readonly Alert[];
  onPress: () => void;
}) {
  const level = maxLevel(props.alerts);
  if (level === null) {
    return null;
  }
  const top = props.alerts[0];
  const others = props.alerts.length - 1;
  const color = LEVEL_COLORS[level];
  const strong = level !== 'yellow';
  const label = `${top.title}${top.where ? `, ${top.where}` : ''}${
    others > 0
      ? `, et ${others} autre${others > 1 ? 's' : ''} alerte${
          others > 1 ? 's' : ''
        }`
      : ''
  }. Ouvrir les alertes`;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={props.onPress}
      style={({ pressed }) => [
        styles.banner,
        strong ? styles.strong : styles.light,
        { borderColor: tint(color, strong ? 'cc' : '88') },
        // Opaque : lisible sur la photo de l'accueil.
        { backgroundColor: solidTint(color, strong ? 0.22 : 0.1) },
        pressed && styles.pressed,
      ]}
    >
      <TriangleAlert color={color} size={strong ? 26 : 20} strokeWidth={2.2} />
      <View style={styles.grow}>
        {strong ? (
          <Text style={[styles.kicker, { color }]}>ALERTE EN COURS</Text>
        ) : null}
        <Text style={styles.title} numberOfLines={2}>
          {top.title}
        </Text>
        <Text style={text.subtle} numberOfLines={1}>
          {top.where ?? ''}
          {others > 0
            ? `${top.where ? ' · ' : ''}+ ${others} autre${
                others > 1 ? 's' : ''
              }`
            : ''}
        </Text>
      </View>
      <ChevronRight color={colors.textMuted} size={20} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.m,
    borderWidth: 1,
    borderRadius: radius.card,
  },
  strong: { padding: space.m, borderWidth: 1.5 },
  light: { paddingHorizontal: space.m, paddingVertical: space.s },
  grow: { flex: 1, minWidth: 0, gap: 2 },
  kicker: { fontSize: 12, fontWeight: '800', letterSpacing: 1 },
  title: { color: colors.text, fontSize: 15, fontWeight: '700' },
  pressed: { opacity: 0.85 },
});
