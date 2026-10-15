/** Composants de base : boutons, puces, champs, messages. */
import React from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from 'react-native';

import { colors, fonts, space, text } from '../theme';

type ButtonVariant = 'primary' | 'ghost' | 'danger';

export function Button(props: {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  disabled?: boolean;
  accessibilityLabel?: string;
}) {
  const variant = props.variant ?? 'ghost';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={props.accessibilityLabel ?? props.label}
      accessibilityState={{ disabled: props.disabled === true }}
      disabled={props.disabled}
      onPress={props.onPress}
      style={({ pressed }) => [
        styles.button,
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

export function Field(
  props: TextInputProps & { label: string; error?: string | null },
) {
  const { label, error, style, ...input } = props;
  return (
    <View style={styles.field}>
      <Text style={text.dim}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={colors.faint}
        selectionColor={colors.amber}
        style={[styles.input, error ? styles.inputError : null, style]}
        {...input}
      />
      {error ? <Text style={styles.errorText}>{error}</Text> : null}
    </View>
  );
}

export function Notice(props: { message: string; tone: 'ok' | 'error' }) {
  return (
    <View
      accessibilityLiveRegion="polite"
      style={[styles.notice, props.tone === 'error' && styles.noticeError]}
    >
      <Text style={props.tone === 'error' ? styles.errorText : styles.okText}>
        {props.message}
      </Text>
    </View>
  );
}

export function Reading(props: { label: string; value: string }) {
  return (
    <View style={styles.reading}>
      <Text style={text.label}>{props.label}</Text>
      <Text selectable style={[text.mono, styles.readingValue]}>
        {props.value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  button: {
    borderRadius: 999,
    borderWidth: 1,
    paddingVertical: 9,
    paddingHorizontal: 16,
    alignItems: 'center',
    minHeight: 40,
    justifyContent: 'center',
  },
  primary: { backgroundColor: colors.amber, borderColor: colors.amber },
  ghost: { borderColor: colors.line },
  danger: { backgroundColor: colors.danger, borderColor: colors.danger },
  pressed: { opacity: 0.7 },
  disabled: { opacity: 0.35 },
  buttonText: { fontSize: 15, fontWeight: '500' },
  primaryText: { color: colors.amberInk, fontWeight: '700' },
  ghostText: { color: colors.text },
  dangerText: { color: colors.bg, fontWeight: '700' },
  chip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.line,
    paddingVertical: 7,
    paddingHorizontal: 14,
  },
  chipOn: { borderColor: colors.amber },
  chipText: { color: colors.dim, fontSize: 14 },
  chipTextOn: { color: colors.amber },
  field: { gap: space.xs },
  input: {
    backgroundColor: colors.raise,
    borderColor: colors.line,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: colors.text,
    fontSize: 15,
  },
  inputError: { borderColor: colors.danger },
  errorText: { color: colors.danger, fontSize: 14 },
  okText: { color: colors.ok, fontSize: 14 },
  notice: {
    borderWidth: 1,
    borderColor: colors.ok,
    borderRadius: 10,
    padding: space.m,
  },
  noticeError: { borderColor: colors.danger },
  reading: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    gap: space.m,
    paddingVertical: space.s,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  readingValue: { flexShrink: 1, textAlign: 'right', fontFamily: fonts.mono },
});
