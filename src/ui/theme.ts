/**
 * Jetons visuels. Thème unique noir pur (#000000) : sur une dalle OLED, un
 * pixel noir est éteint, ce qui économise la batterie (cahier des charges §2).
 */
import { Platform, StyleSheet } from 'react-native';

export const colors = {
  bg: '#000000',
  raise: '#0d0f10',
  line: '#1d2124',
  text: '#ece8df',
  dim: '#8d9296',
  faint: '#50565b',
  amber: '#ffb547',
  amberInk: '#1a1203',
  danger: '#ff6a5c',
  warn: '#f2cf4a',
  ok: '#5fd39a',
} as const;

export const fonts = {
  /** Condensée, pour les chiffres et les titres. */
  display: Platform.select({
    ios: 'AvenirNextCondensed-DemiBold',
    default: 'sans-serif-condensed',
  }),
  mono: Platform.select({ ios: 'Menlo', default: 'monospace' }),
} as const;

export const space = { xs: 4, s: 8, m: 12, l: 18, xl: 24 } as const;

export const text = StyleSheet.create({
  body: { color: colors.text, fontSize: 15, lineHeight: 21 },
  dim: { color: colors.dim, fontSize: 13, lineHeight: 18 },
  label: {
    color: colors.dim,
    fontFamily: fonts.display,
    fontSize: 13,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
  },
  title: {
    color: colors.text,
    fontFamily: fonts.display,
    fontSize: 22,
    fontWeight: '600',
  },
  mono: {
    color: colors.text,
    fontFamily: fonts.mono,
    fontSize: 14,
    fontVariant: ['tabular-nums'],
  },
  brand: {
    color: colors.amber,
    fontFamily: fonts.display,
    fontSize: 20,
    fontWeight: '700',
    letterSpacing: 3,
    textTransform: 'uppercase',
  },
});
