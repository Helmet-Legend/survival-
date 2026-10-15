/** Composants de base : boutons, puces, champs, panneaux, jauges, messages. */
import React from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from 'react-native';

import {
  colors,
  fonts,
  radius,
  space,
  text,
  tint,
  toneColor,
  type StatusTone,
} from '../theme';

/** Marque : losange ambré (repère de carte) et nom de l'application. */
export function Brand({ size = 20 }: { size?: number }) {
  const mark = Math.round(size * 0.6);
  return (
    <View style={styles.brand}>
      <View style={[styles.brandMark, { width: mark, height: mark }]} />
      <Text style={[text.brand, { fontSize: size }]}>ResiliOS</Text>
    </View>
  );
}

type ButtonVariant = 'primary' | 'ghost' | 'danger';

export function Button(props: {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  disabled?: boolean;
  accessibilityLabel?: string;
  compact?: boolean;
}) {
  const variant = props.variant ?? 'ghost';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={props.accessibilityLabel ?? props.label}
      accessibilityState={{ disabled: props.disabled === true }}
      disabled={props.disabled}
      onPress={props.onPress}
      hitSlop={6}
      style={({ pressed }) => [
        styles.button,
        props.compact && styles.buttonCompact,
        styles[variant],
        pressed && styles.pressed,
        props.disabled && styles.disabled,
      ]}
    >
      <Text style={[styles.buttonText, styles[`${variant}Text`]]}>
        {props.label}
      </Text>
    </Pressable>
  );
}

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
      style={[styles.chip, props.selected && styles.chipOn]}
    >
      <Text style={[styles.chipText, props.selected && styles.chipTextOn]}>
        {props.label}
      </Text>
    </Pressable>
  );
}

/** Pastille d'état : point coloré + libellé, sur fond teinté. */
export function StatusChip(props: { tone: StatusTone; label: string }) {
  const color = toneColor[props.tone];
  return (
    <View style={[styles.status, { backgroundColor: tint(color) }]}>
      <View style={[styles.statusDot, { backgroundColor: color }]} />
      <Text style={[styles.statusText, { color }]}>{props.label}</Text>
    </View>
  );
}

/** Panneau surélevé avec titre facultatif et zone à droite du titre. */
export function Panel(props: {
  title?: string;
  right?: React.ReactNode;
  children: React.ReactNode;
  accent?: string;
}) {
  return (
    <View
      style={[
        styles.panel,
        props.accent
          ? [styles.panelAccent, { borderTopColor: props.accent }]
          : null,
      ]}
    >
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
    </View>
  );
}

/**
 * Jauge horizontale. `value` et `secondary` sont des fractions de 0 à 1 ;
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

/** Sélecteur − valeur + avec libellés d'accessibilité explicites. */
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
      hitSlop={8}
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
        placeholderTextColor={colors.faint}
        selectionColor={colors.amber}
        style={[styles.input, error ? styles.inputError : null, style]}
        {...input}
      />
      {error ? (
        <Text style={styles.errorText}>{error}</Text>
      ) : hint ? (
        <Text style={styles.hint}>{hint}</Text>
      ) : null}
    </View>
  );
}

export function Notice(props: { message: string; tone: 'ok' | 'error' }) {
  const color = props.tone === 'error' ? colors.danger : colors.ok;
  return (
    <View
      accessibilityLiveRegion="polite"
      style={[
        styles.notice,
        { borderColor: color, backgroundColor: tint(color, '14') },
      ]}
    >
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

const styles = StyleSheet.create({
  brand: { flexDirection: 'row', alignItems: 'center', gap: space.s },
  brandMark: {
    backgroundColor: colors.amber,
    transform: [{ rotate: '45deg' }],
  },
  button: {
    borderRadius: radius.pill,
    borderWidth: 1,
    paddingVertical: 11,
    paddingHorizontal: 18,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 46,
  },
  buttonCompact: { minHeight: 38, paddingVertical: 7, paddingHorizontal: 14 },
  primary: { backgroundColor: colors.amber, borderColor: colors.amber },
  ghost: { borderColor: colors.lineStrong, backgroundColor: colors.panelHi },
  danger: { backgroundColor: colors.danger, borderColor: colors.danger },
  pressed: { opacity: 0.7 },
  disabled: { opacity: 0.35 },
  buttonText: { fontSize: 15, fontWeight: '600' },
  primaryText: { color: colors.amberInk, fontWeight: '800' },
  ghostText: { color: colors.text },
  dangerText: { color: colors.bg, fontWeight: '800' },
  chip: {
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.lineStrong,
    paddingVertical: 8,
    paddingHorizontal: 14,
  },
  chipOn: {
    borderColor: colors.amber,
    backgroundColor: tint(colors.amber, '1f'),
  },
  chipText: { color: colors.dim, fontSize: 14, fontWeight: '600' },
  chipTextOn: { color: colors.amber },
  status: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    borderRadius: radius.pill,
    paddingVertical: 4,
    paddingHorizontal: 10,
  },
  statusDot: { width: 7, height: 7, borderRadius: 4 },
  statusText: {
    fontFamily: fonts.display,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  panel: {
    backgroundColor: colors.panel,
    borderColor: colors.line,
    borderWidth: 1,
    borderRadius: radius.m,
    padding: space.l,
    gap: space.m,
  },
  panelAccent: { borderTopWidth: 2 },
  panelHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: space.s,
  },
  gauge: { backgroundColor: colors.panelHi, overflow: 'hidden' },
  gaugeFill: { position: 'absolute', top: 0, bottom: 0, left: 0 },
  gaugeSecondary: { backgroundColor: colors.lineStrong },
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
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.lineStrong,
    backgroundColor: colors.panelHi,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepText: { color: colors.text, fontSize: 22, lineHeight: 24 },
  stepValue: { minWidth: 70, textAlign: 'center' },
  field: { gap: 6 },
  fieldLabel: { color: colors.dim, fontSize: 14 },
  input: {
    backgroundColor: colors.panelHi,
    borderColor: colors.lineStrong,
    borderWidth: 1,
    borderRadius: radius.s,
    paddingHorizontal: 12,
    paddingVertical: 11,
    color: colors.text,
    fontSize: 16,
  },
  inputError: { borderColor: colors.danger },
  errorText: { color: colors.danger, fontSize: 14 },
  hint: { color: colors.faint, fontSize: 13 },
  notice: { borderWidth: 1, borderRadius: radius.s, padding: space.m },
  noticeText: { fontSize: 15, lineHeight: 21 },
  reading: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    gap: space.m,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  readingValue: { flexShrink: 1, textAlign: 'right' },
});
