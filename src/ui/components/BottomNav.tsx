/**
 * Barre de navigation basse : quatre sections et, au centre sous le pouce,
 * le bouton SOS qui ouvre l'écran Urgence. La section active est en orange.
 * Préparer s'ouvre depuis les accès rapides de l'accueil.
 */
import {
  BookOpen,
  Box,
  House,
  Compass,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react-native';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { Tab } from '../navigation';
import { colors, fonts, radius, sizes } from '../theme';

const LEFT: Array<[Tab, string, LucideIcon]> = [
  ['home', 'Accueil', House],
  ['stock', 'Stocks', Box],
];
const RIGHT: Array<[Tab, string, LucideIcon]> = [
  ['guides', 'Fiches', BookOpen],
  ['map', 'Position', Compass],
];

export function BottomNav(props: {
  current: Tab | null;
  onSelect: (tab: Tab) => void;
  /** Ouvre l'écran Urgence. */
  onSos: () => void;
  /** L'écran Urgence est ouvert. */
  sosActive?: boolean;
  bottomInset: number;
}) {
  const tab = ([id, label, Icon]: [Tab, string, LucideIcon]) => {
    const active = props.current === id;
    const color = active ? colors.primary : colors.textMuted;
    return (
      <Pressable
        key={id}
        accessibilityRole="tab"
        accessibilityState={{ selected: active }}
        onPress={() => props.onSelect(id)}
        style={({ pressed }) => [styles.tab, pressed && styles.pressed]}
      >
        <Icon color={color} size={24} strokeWidth={active ? 2.3 : 1.9} />
        <Text style={[styles.label, { color }]}>{label}</Text>
        <View style={[styles.mark, active && styles.markOn]} />
      </Pressable>
    );
  };
  return (
    <View
      style={[styles.bar, { paddingBottom: props.bottomInset }]}
      accessibilityRole="tablist"
    >
      {LEFT.map(tab)}
      <View style={styles.sosSlot}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="SOS : ouvrir l’écran Urgence"
          accessibilityState={{ selected: props.sosActive === true }}
          onPress={props.onSos}
          style={({ pressed }) => [
            styles.sos,
            props.sosActive && styles.sosOn,
            pressed && styles.pressed,
          ]}
        >
          <TriangleAlert color={colors.text} size={24} strokeWidth={2.4} />
          <Text style={styles.sosText}>SOS</Text>
        </Pressable>
      </View>
      {RIGHT.map(tab)}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    backgroundColor: colors.bg,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  tab: {
    flex: 1,
    minHeight: sizes.bottomNavHeight,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingTop: 6,
  },
  pressed: { opacity: 0.7 },
  label: { fontSize: 12, fontWeight: '600' },
  mark: { width: 28, height: 2, borderRadius: 1, marginTop: 2 },
  markOn: { backgroundColor: colors.primary },
  sosSlot: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 6,
  },
  sos: {
    width: '92%',
    minHeight: sizes.bottomNavHeight - 12,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    borderRadius: radius.panel,
    borderWidth: 2,
    borderColor: colors.danger,
    backgroundColor: colors.danger,
  },
  sosOn: { borderColor: colors.text },
  sosText: {
    color: colors.text,
    fontFamily: fonts.display,
    fontSize: 17,
    fontWeight: '800',
    letterSpacing: 1,
  },
});
