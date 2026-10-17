/**
 * Composants de base du design « Tech Premium » : marque, boutons, puces,
 * cartes, champs, badges, jauges, états vides et fonds.
 */
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  ChevronRight,
  Search,
} from 'lucide-react-native';
import React from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';
import { SvgXml } from 'react-native-svg';
import type { Icon } from '../icons';

import {
  colors,
  fonts,
  radius,
  sizes,
  space,
  text,
  tint,
  toneColor,
  type StatusTone,
} from '../theme';
import { APP_NAME } from '../brand';

// --- Marque -----------------------------------------------------------------

/** Nom de l'application souligné d'orange, avec la devise en option. */
export function Brand({
  size = 22,
  tagline = false,
}: {
  size?: number;
  tagline?: boolean;
}) {
  return (
    <View
      style={styles.brand}
      accessible
      accessibilityRole="header"
      accessibilityLabel={APP_NAME}
    >
      <Text style={[styles.brandText, { fontSize: size }]}>
        {APP_NAME.toUpperCase()}
      </Text>
      <View style={[styles.brandAccent, { width: size * 1.4 }]} />
      {tagline ? (
        <Text style={styles.tagline}>AUTONOMIE · PRÉPARATION · SÉCURITÉ</Text>
      ) : null}
    </View>
  );
}

// --- Boutons ----------------------------------------------------------------

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

export function Button(props: {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  icon?: Icon;
  /** Chevron à droite (bouton qui ouvre un écran). */
  chevron?: boolean;
  disabled?: boolean;
  accessibilityLabel?: string;
  compact?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const variant = props.variant ?? 'secondary';
  const fg = FOREGROUND[variant];
  const Icon = props.icon;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={props.accessibilityLabel ?? props.label}
      accessibilityState={{ disabled: props.disabled === true }}
      disabled={props.disabled}
      onPress={props.onPress}
      hitSlop={4}
      style={({ pressed }) => [
        styles.button,
        props.compact && styles.buttonCompact,
        styles[variant],
        pressed && !props.disabled && styles.pressed,
        props.disabled && styles.disabled,
        props.style,
      ]}
    >
      {Icon ? <Icon color={fg} size={20} strokeWidth={2} /> : null}
      <Text
        style={[styles.buttonText, { color: fg }, props.chevron && styles.grow]}
      >
        {props.label}
      </Text>
      {props.chevron ? (
        <ChevronRight color={fg} size={20} strokeWidth={2.2} />
      ) : null}
    </Pressable>
  );
}

const FOREGROUND: Record<ButtonVariant, string> = {
  primary: colors.onPrimary,
  secondary: colors.text,
  ghost: colors.cyan,
  danger: '#FF8A96',
};

/** Bouton icône seule, cible tactile de 48 × 48. */
export function IconButton(props: {
  icon: Icon;
  label: string;
  onPress: () => void;
  color?: string;
}) {
  const Icon = props.icon;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={props.label}
      onPress={props.onPress}
      hitSlop={4}
      style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
    >
      <Icon color={props.color ?? colors.text} size={22} strokeWidth={2} />
    </Pressable>
  );
}

// --- Puces, badges ----------------------------------------------------------

/** Filtre : orange plein quand actif, surface sombre sinon. */
export function Chip(props: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: props.selected }}
      onPress={props.onPress}
      style={({ pressed }) => [
        styles.chip,
        props.selected && styles.chipOn,
        pressed && styles.pressed,
      ]}
    >
      <Text style={[styles.chipText, props.selected && styles.chipTextOn]}>
        {props.label}
      </Text>
    </Pressable>
  );
}

/** Badge d'état : point + libellé (jamais la couleur seule). */
export function StatusChip(props: { tone: StatusTone; label: string }) {
  const color = toneColor[props.tone];
  return (
    <View
      style={[
        styles.status,
        { backgroundColor: tint(color, '1f'), borderColor: tint(color, '66') },
      ]}
    >
      <View style={[styles.statusDot, { backgroundColor: color }]} />
      <Text style={[styles.statusText, { color }]}>{props.label}</Text>
    </View>
  );
}

// --- Cartes -----------------------------------------------------------------

/** Carte de surface ; pressable si `onPress` est fourni. */
export function Panel(props: {
  title?: string;
  right?: React.ReactNode;
  children: React.ReactNode;
  accent?: string;
  onPress?: () => void;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const content = (
    <>
      {props.title || props.right ? (
        <View style={styles.panelHead}>
          {props.title ? (
            <Text style={text.label}>{props.title}</Text>
          ) : (
            <View />
          )}
          {props.right}
        </View>
      ) : null}
      {props.children}
    </>
  );
  const style = [
    styles.panel,
    props.accent ? { borderColor: props.accent } : null,
    props.style,
  ];
  if (props.onPress) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={props.accessibilityLabel}
        onPress={props.onPress}
        style={({ pressed }) => [style, pressed && styles.pressed]}
      >
        {content}
      </Pressable>
    );
  }
  return <View style={style}>{content}</View>;
}

/** Carte de métrique : icône, libellé, valeur et légende. */
export function MetricCard(props: {
  icon: Icon;
  color: string;
  label: string;
  value: string;
  unit?: string;
  caption: string;
  /** Part de l'objectif couverte (0 à 1) : barre sous la valeur. */
  progress?: number;
  /** Ligne sous la barre (ex. besoin par jour). */
  detail?: string;
  onPress?: () => void;
}) {
  const Icon = props.icon;
  return (
    <Panel
      onPress={props.onPress}
      accessibilityLabel={`${props.label} : ${props.value}${
        props.unit ? ` ${props.unit}` : ''
      }, ${props.caption}`}
      style={styles.metric}
    >
      <Icon color={props.color} size={28} strokeWidth={2} />
      <Text style={styles.metricLabel} numberOfLines={2}>
        {props.label}
      </Text>
      <Text style={styles.metricValue} numberOfLines={1} adjustsFontSizeToFit>
        {props.value}
        {props.unit ? (
          <Text style={styles.metricUnit}> {props.unit}</Text>
        ) : null}
      </Text>
      {props.progress !== undefined ? (
        <Gauge value={props.progress} color={props.color} height={6} />
      ) : null}
      <Text style={text.subtle} numberOfLines={2}>
        {props.caption}
      </Text>
      {props.detail ? (
        <Text style={text.subtle} numberOfLines={1}>
          {props.detail}
        </Text>
      ) : null}
    </Panel>
  );
}

/** Tuile d'icône colorée (catégories). */
export function IconTile({ icon: Icon, color }: { icon: Icon; color: string }) {
  return (
    <View
      style={[
        styles.iconTile,
        { backgroundColor: tint(color, '1a'), borderColor: tint(color, '55') },
      ]}
    >
      <Icon color={color} size={24} strokeWidth={2} />
    </View>
  );
}

export function SectionTitle(props: {
  title: string;
  right?: React.ReactNode;
}) {
  return (
    <View style={styles.section}>
      <Text accessibilityRole="header" style={text.h3}>
        {props.title}
      </Text>
      {props.right}
    </View>
  );
}

/** État vide ou sans résultat : icône, titre, explication. */
export function EmptyState(props: {
  icon: Icon;
  title: string;
  message?: string;
  action?: React.ReactNode;
}) {
  const Icon = props.icon;
  return (
    <View style={styles.empty}>
      <Icon color={colors.textSubtle} size={32} strokeWidth={1.8} />
      <Text style={[text.body, styles.center]}>{props.title}</Text>
      {props.message ? (
        <Text style={[text.muted, styles.center]}>{props.message}</Text>
      ) : null}
      {props.action}
    </View>
  );
}

/** Titre d'un écran secondaire, avec retour facultatif. */
export function ScreenTitle(props: {
  title: string;
  onBack?: () => void;
  backLabel?: string;
}) {
  return (
    <View style={styles.screenTitle}>
      {props.onBack ? (
        <IconButton
          icon={ArrowLeft}
          label={props.backLabel ?? 'Retour'}
          onPress={props.onBack}
          color={colors.cyan}
        />
      ) : null}
      <Text
        accessibilityRole="header"
        style={[text.h2, styles.grow]}
        numberOfLines={2}
      >
        {props.title}
      </Text>
    </View>
  );
}

// --- Champs -----------------------------------------------------------------

export function SearchField(props: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <View style={styles.search}>
      <Search color={colors.cyan} size={20} strokeWidth={2} />
      <TextInput
        accessibilityLabel={props.label}
        value={props.value}
        onChangeText={props.onChangeText}
        placeholder={props.placeholder ?? props.label}
        placeholderTextColor={colors.textSubtle}
        selectionColor={colors.primary}
        returnKeyType="search"
        autoCorrect={false}
        style={styles.searchInput}
      />
    </View>
  );
}

export function Field(
  props: TextInputProps & {
    label: string;
    error?: string | null;
    hint?: string;
  },
) {
  const { label, error, hint, style, ...input } = props;
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={colors.textSubtle}
        selectionColor={colors.primary}
        style={[styles.input, error ? styles.inputError : null, style]}
        {...input}
      />
      {error ? (
        <Text style={styles.errorText}>{error}</Text>
      ) : hint ? (
        <Text style={text.subtle}>{hint}</Text>
      ) : null}
    </View>
  );
}

// --- Messages ---------------------------------------------------------------

export function Notice(props: { message: string; tone: 'ok' | 'error' }) {
  const color = props.tone === 'error' ? colors.danger : colors.success;
  const Icon = props.tone === 'error' ? AlertTriangle : CheckCircle2;
  return (
    <View
      accessibilityLiveRegion="polite"
      style={[
        styles.notice,
        { borderColor: tint(color, '88'), backgroundColor: tint(color, '14') },
      ]}
    >
      <Icon color={color} size={20} strokeWidth={2} />
      <Text style={[styles.noticeText, { color }]}>{props.message}</Text>
    </View>
  );
}

export function Reading(props: {
  label: string;
  value: string;
  color?: string;
}) {
  return (
    <View style={styles.reading}>
      <Text style={text.label}>{props.label}</Text>
      <Text
        selectable
        style={[
          text.mono,
          styles.readingValue,
          props.color ? { color: props.color } : null,
        ]}
      >
        {props.value}
      </Text>
    </View>
  );
}

// --- Jauges et réglages -----------------------------------------------------

/**
 * Barre de progression. `value` et `secondary` sont des fractions de 0 à 1 ;
 * `marker` place un repère (ex. l'objectif).
 */
export function Gauge(props: {
  value: number;
  color: string;
  secondary?: number;
  marker?: number;
  height?: number;
}) {
  const clamp = (n: number) => `${Math.max(0, Math.min(1, n)) * 100}%` as const;
  const height = props.height ?? 8;
  return (
    <View style={[styles.gauge, { height, borderRadius: height / 2 }]}>
      {props.secondary !== undefined ? (
        <View
          style={[
            styles.gaugeFill,
            styles.gaugeSecondary,
            { width: clamp(props.secondary) },
          ]}
        />
      ) : null}
      <View
        style={[
          styles.gaugeFill,
          { width: clamp(props.value), backgroundColor: props.color },
        ]}
      />
      {props.marker !== undefined ? (
        <View style={[styles.gaugeMarker, { left: clamp(props.marker) }]} />
      ) : null}
    </View>
  );
}

export function Stepper(props: {
  value: string;
  onDecrease: () => void;
  onIncrease: () => void;
  canDecrease: boolean;
  canIncrease: boolean;
  decreaseLabel: string;
  increaseLabel: string;
}) {
  return (
    <View style={styles.stepper}>
      <StepButton
        label="−"
        a11y={props.decreaseLabel}
        onPress={props.onDecrease}
        disabled={!props.canDecrease}
      />
      <Text style={[text.mono, styles.stepValue]}>{props.value}</Text>
      <StepButton
        label="+"
        a11y={props.increaseLabel}
        onPress={props.onIncrease}
        disabled={!props.canIncrease}
      />
    </View>
  );
}

function StepButton(props: {
  label: string;
  a11y: string;
  onPress: () => void;
  disabled: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={props.a11y}
      accessibilityState={{ disabled: props.disabled }}
      disabled={props.disabled}
      onPress={props.onPress}
      style={({ pressed }) => [
        styles.step,
        pressed && styles.pressed,
        props.disabled && styles.disabled,
      ]}
    >
      <Text style={styles.stepText}>{props.label}</Text>
    </Pressable>
  );
}

// --- Fond -------------------------------------------------------------------

/** Motif vectoriel plein écran, derrière le contenu. */
export function Backdrop({
  svg,
  opacity = 1,
}: {
  svg: string;
  opacity?: number;
}) {
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { opacity }]}>
      <SvgXml xml={svg} width="100%" height="100%" />
    </View>
  );
}

const styles = StyleSheet.create({
  grow: { flex: 1 },
  center: { textAlign: 'center' },
  brand: { alignItems: 'center' },
  brandText: {
    color: colors.text,
    fontFamily: fonts.display,
    fontWeight: '800',
    letterSpacing: 1.5,
  },
  brandAccent: {
    height: 3,
    borderRadius: 2,
    backgroundColor: colors.primary,
    marginTop: 2,
    marginBottom: 2,
  },
  tagline: {
    color: colors.textMuted,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.2,
    marginTop: 2,
  },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.s,
    minHeight: sizes.buttonHeight,
    borderRadius: radius.button,
    borderWidth: 1,
    paddingHorizontal: 18,
  },
  buttonCompact: { minHeight: 44, paddingHorizontal: 14 },
  primary: { backgroundColor: colors.primary, borderColor: colors.primary },
  secondary: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.borderActive,
  },
  ghost: { backgroundColor: 'transparent', borderColor: 'transparent' },
  danger: { backgroundColor: colors.dangerSurface, borderColor: colors.danger },
  buttonText: { fontSize: 16, fontWeight: '700' },
  pressed: { opacity: 0.82, transform: [{ scale: 0.99 }] },
  disabled: { opacity: 0.38 },
  iconButton: {
    width: sizes.touch,
    height: sizes.touch,
    borderRadius: sizes.touch / 2,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgElevated,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chip: {
    minHeight: 40,
    justifyContent: 'center',
    borderRadius: radius.m,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgElevated,
    paddingHorizontal: 14,
  },
  chipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { color: colors.text, fontSize: 14, fontWeight: '600' },
  chipTextOn: { color: colors.onPrimary, fontWeight: '700' },
  status: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    borderRadius: radius.pill,
    borderWidth: 1,
    paddingVertical: 3,
    paddingHorizontal: 10,
  },
  statusDot: { width: 7, height: 7, borderRadius: 4 },
  statusText: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  panel: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.card,
    padding: space.l,
    gap: space.m,
  },
  panelHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: space.s,
  },
  metric: { flex: 1, minWidth: 0, gap: 6 },
  metricLabel: {
    ...StyleSheet.flatten(text.label),
    color: colors.text,
    marginTop: space.xs,
  },
  metricValue: { ...StyleSheet.flatten(text.value), fontSize: 26 },
  metricUnit: { fontSize: 15, color: colors.textMuted, fontWeight: '600' },
  iconTile: {
    width: 52,
    height: 52,
    borderRadius: radius.m,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  screenTitle: { flexDirection: 'row', alignItems: 'center', gap: space.m },
  section: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: space.s,
  },
  empty: {
    alignItems: 'center',
    gap: space.s,
    paddingVertical: space.xxl,
    paddingHorizontal: space.l,
  },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: sizes.inputHeight,
    backgroundColor: colors.bgElevated,
    borderColor: colors.borderActive,
    borderWidth: 1,
    borderRadius: radius.m,
    paddingHorizontal: space.m,
  },
  searchInput: {
    flex: 1,
    color: colors.text,
    fontSize: 16,
    paddingVertical: 10,
  },
  field: { gap: 6 },
  fieldLabel: { color: colors.textMuted, fontSize: 14 },
  input: {
    minHeight: sizes.inputHeight,
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.m,
    paddingHorizontal: space.m,
    paddingVertical: 10,
    color: colors.text,
    fontSize: 16,
  },
  inputError: { borderColor: colors.danger },
  errorText: { color: colors.danger, fontSize: 14 },
  notice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.s,
    borderWidth: 1,
    borderRadius: radius.m,
    padding: space.m,
  },
  noticeText: { flex: 1, fontSize: 15, lineHeight: 21 },
  reading: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    gap: space.m,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  readingValue: { flexShrink: 1, textAlign: 'right' },
  gauge: { backgroundColor: colors.border, overflow: 'hidden' },
  gaugeFill: { position: 'absolute', top: 0, bottom: 0, left: 0 },
  gaugeSecondary: { backgroundColor: colors.borderActive },
  gaugeMarker: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 2,
    marginLeft: -1,
    backgroundColor: colors.text,
  },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: space.s },
  step: {
    width: sizes.touch,
    height: sizes.touch,
    borderRadius: radius.m,
    borderWidth: 1,
    borderColor: colors.borderActive,
    backgroundColor: colors.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepText: { color: colors.text, fontSize: 22, lineHeight: 24 },
  stepValue: { minWidth: 72, textAlign: 'center' },
});
