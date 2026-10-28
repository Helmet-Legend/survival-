/**
 * Thème « Tech Premium » (kit de design, design 2).
 * Source unique des couleurs, espacements, rayons et tailles de l'interface.
 *
 * Sémantique stable : orange = action / sélection, cyan = navigation /
 * mesure, vert = confirmé, jaune = attention, rouge = danger,
 * violet = information secondaire. Les catégories de stock ont leurs
 * propres teintes, distinctes de ces couleurs d'état.
 */
import { Platform, StyleSheet } from 'react-native';

export const colors = {
  bg: '#03090D',
  bgElevated: '#08121A',
  surface: '#06141B',
  surfaceRaised: '#081B24',
  overlay: '#102531',
  border: '#183746',
  borderActive: '#247A96',
  primary: '#FF9F1C',
  primaryBright: '#FFC15A',
  primaryPressed: '#E98708',
  onPrimary: '#071018',
  cyan: '#35D9FF',
  cyanSoft: '#83E8FF',
  text: '#F1F7FA',
  textMuted: '#9FB3BF',
  textSubtle: '#6F8795',
  success: '#39D98A',
  warning: '#FFBF47',
  danger: '#FB3C4B',
  dangerSurface: '#2A0B12',
  purple: '#D879FF',
  // Catégories de stock : hors du rouge, de l'orange, du jaune et du vert,
  // réservés aux états (danger, action, attention, complet).
  water: '#4FA3FF',
  food: '#D6B37A',
  weapons: '#94A3B8',
  health: '#F0A6CA',
  tools: '#B7CBD7',
  equipment: '#6E8FA3',
  energy: '#A78BFA',
} as const;

export type StatusTone = 'ok' | 'warn' | 'danger' | 'neutral' | 'info';

export const toneColor: Record<StatusTone, string> = {
  ok: colors.success,
  warn: colors.warning,
  danger: colors.danger,
  neutral: colors.textMuted,
  info: colors.cyan,
};

/** Couleur translucide pour les fonds teintés (alpha en hexadécimal). */
export function tint(color: string, alpha = '26'): string {
  return `${color}${alpha}`;
}

/**
 * Comme `tint`, mais opaque : la couleur mélangée au fond de l'application
 * (`alpha` de 0 à 1). Pour les éléments posés sur une photo.
 */
export function solidTint(color: string, alpha: number): string {
  const mix = (i: number) => {
    const fg = parseInt(color.slice(i, i + 2), 16);
    const bg = parseInt(colors.bg.slice(i, i + 2), 16);
    return Math.round(bg + (fg - bg) * alpha)
      .toString(16)
      .padStart(2, '0');
  };
  return `#${mix(1)}${mix(3)}${mix(5)}`;
}

export const fonts = {
  /** Titres et chiffres : condensée si l'appareil en dispose. */
  display: Platform.select({
    ios: 'AvenirNextCondensed-Bold',
    web: '"Rajdhani", "Roboto Condensed", "Arial Narrow", sans-serif',
    default: 'sans-serif-condensed',
  }),
  mono: Platform.select({
    ios: 'Menlo',
    web: 'ui-monospace, Menlo, Consolas, monospace',
    default: 'monospace',
  }),
} as const;

export const space = {
  xs: 4,
  s: 8,
  m: 12,
  l: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
} as const;

export const radius = {
  s: 8,
  m: 12,
  button: 12,
  card: 16,
  panel: 20,
  pill: 999,
} as const;

export const sizes = {
  touch: 48,
  screenPadding: 18,
  buttonHeight: 52,
  inputHeight: 48,
  bottomNavHeight: 78,
} as const;

export const text = StyleSheet.create({
  body: { color: colors.text, fontSize: 16, lineHeight: 22 },
  muted: { color: colors.textMuted, fontSize: 14, lineHeight: 20 },
  subtle: { color: colors.textSubtle, fontSize: 13, lineHeight: 18 },
  label: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  h1: {
    color: colors.text,
    fontFamily: fonts.display,
    fontSize: 28,
    fontWeight: '800',
  },
  h2: {
    color: colors.text,
    fontFamily: fonts.display,
    fontSize: 22,
    fontWeight: '700',
  },
  h3: {
    color: colors.text,
    fontFamily: fonts.display,
    fontSize: 18,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  value: {
    color: colors.text,
    fontFamily: fonts.display,
    fontSize: 28,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  mono: {
    color: colors.text,
    fontFamily: fonts.mono,
    fontSize: 15,
    fontVariant: ['tabular-nums'],
  },
});
