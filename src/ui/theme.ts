/**
 * Jetons visuels « instrument de terrain ».
 *
 * - Fond noir pur (#000000) : sur une dalle OLED, un pixel noir est éteint,
 *   ce qui économise la batterie (cahier des charges §2).
 * - Panneaux légèrement surélevés pour structurer l'écran sans l'éclairer.
 * - Couleurs d'état (vert / jaune / rouge) distinctes de l'accent ambré,
 *   réservé aux commandes : ce qui demande de l'attention se voit d'un coup
 *   d'œil, même en plein soleil.
 * - Une couleur par ressource : eau en cyan, vivres en orange.
 */
import { Platform, StyleSheet } from 'react-native';

export const colors = {
  bg: '#000000',
  panel: '#0b0d0e',
  panelHi: '#13171a',
  line: '#1f2427',
  lineStrong: '#2c3338',
  text: '#eef0ea',
  dim: '#9aa3a7',
  faint: '#5a6267',
  amber: '#ffb238',
  amberInk: '#1a1203',
  water: '#4cc9f0',
  food: '#f4a259',
  ok: '#3ddc84',
  warn: '#ffd23f',
  danger: '#ff4d4d',
} as const;

export type StatusTone = 'ok' | 'warn' | 'danger' | 'neutral';

export const toneColor: Record<StatusTone, string> = {
  ok: colors.ok,
  warn: colors.warn,
  danger: colors.danger,
  neutral: colors.dim,
};

/** Couleur translucide pour les fonds de puces (alpha en hexadécimal). */
export function tint(color: string, alpha = '26'): string {
  return `${color}${alpha}`;
}

export const fonts = {
  /** Condensée, pour les chiffres et les titres. */
  display: Platform.select({
    ios: 'AvenirNextCondensed-Bold',
    // Aperçu web uniquement (react-native-web).
    web: '"Roboto Condensed", "Arial Narrow", "Helvetica Neue", sans-serif',
    default: 'sans-serif-condensed',
  }),
  mono: Platform.select({
    ios: 'Menlo',
    web: 'ui-monospace, Menlo, Consolas, monospace',
    default: 'monospace',
  }),
} as const;

export const space = { xs: 4, s: 8, m: 12, l: 16, xl: 24 } as const;

export const radius = { s: 8, m: 14, pill: 999 } as const;

export const text = StyleSheet.create({
  body: { color: colors.text, fontSize: 16, lineHeight: 22 },
  dim: { color: colors.dim, fontSize: 14, lineHeight: 19 },
  label: {
    color: colors.dim,
    fontFamily: fonts.display,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1.6,
    textTransform: 'uppercase',
  },
  title: {
    color: colors.text,
    fontFamily: fonts.display,
    fontSize: 22,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  mono: {
    color: colors.text,
    fontFamily: fonts.mono,
    fontSize: 15,
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
