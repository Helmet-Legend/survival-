/** Barre de navigation basse : cinq entrées fixes, l'active en orange. */
import {
  BookOpen,
  Box,
  House,
  Map as MapIcon,
  ShieldCheck,
  type LucideIcon,
} from 'lucide-react-native';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { Tab } from '../navigation';
import { colors, sizes } from '../theme';

const TABS: Array<[Tab, string, LucideIcon]> = [
  ['home', 'Accueil', House],
  ['stock', 'Stocks', Box],
  ['prepare', 'Préparer', ShieldCheck],
  ['guides', 'Fiches', BookOpen],
  ['map', 'Carte', MapIcon],
];

export function BottomNav(props: {
  current: Tab | null;
  onSelect: (tab: Tab) => void;
  bottomInset: number;
}) {
  return (
    <View
      style={[styles.bar, { paddingBottom: props.bottomInset }]}
      accessibilityRole="tablist"
    >
      {TABS.map(([id, label, Icon]) => {
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
      })}
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
});
