/**
 * Lignes de fiche (pack « fiches ») : carte sombre, icône de la couleur de
 * la catégorie, libellé au-dessus de la valeur, erreur sous la ligne.
 * Cibles tactiles ≥ 54 px ; chaque saisie porte un libellé accessible.
 */
import { CalendarDays, Check } from 'lucide-react-native';
import React, { useState } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type KeyboardTypeOptions,
} from 'react-native';
import type { Icon } from '../icons';

import { colors, space, tint } from '../theme';
import type { Option } from './config';

function Row(props: {
  icon: Icon;
  color: string;
  focused?: boolean;
  error?: string;
  children: React.ReactNode;
  side?: React.ReactNode;
}) {
  const Icon = props.icon;
  return (
    <View style={styles.wrap}>
      <View style={styles.line}>
        <View
          style={[
            styles.row,
            styles.grow,
            props.focused && { borderColor: props.color },
            props.error ? styles.rowError : null,
          ]}
        >
          <Icon color={props.color} size={22} strokeWidth={2} />
          <View style={styles.body}>{props.children}</View>
        </View>
        {props.side}
      </View>
      {props.error ? <Text style={styles.error}>{props.error}</Text> : null}
    </View>
  );
}

/** Libellé sans l'astérisque des champs obligatoires. */
const bare = (label: string) => label.replace(/ \*$/, '');
/** Libellé lu par le lecteur d'écran : « obligatoire » plutôt que « * ». */
const spoken = (label: string) =>
  label.endsWith(' *') ? `${bare(label)}, obligatoire` : label;

export function TextRow(props: {
  icon: Icon;
  color: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  error?: string;
  multiline?: boolean;
  maxLength?: number;
  keyboardType?: KeyboardTypeOptions;
  suffix?: string;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <Row
      icon={props.icon}
      color={props.color}
      focused={focused}
      error={props.error}
    >
      <Text style={styles.label}>{props.label}</Text>
      <View style={styles.inputLine}>
        <TextInput
          accessibilityLabel={spoken(props.label)}
          value={props.value}
          onChangeText={props.onChange}
          placeholder={props.placeholder}
          placeholderTextColor={colors.textSubtle}
          selectionColor={props.color}
          multiline={props.multiline}
          maxLength={props.maxLength}
          keyboardType={props.keyboardType}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          style={[styles.input, styles.grow]}
        />
        {props.suffix ? (
          <Text style={styles.suffix}>{props.suffix}</Text>
        ) : null}
      </View>
    </Row>
  );
}

/** Saisie JJ/MM/AAAA : les barres s'ajoutent pendant la frappe. */
export function DateRow(props: {
  icon: Icon;
  color: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
}) {
  const [focused, setFocused] = useState(false);
  const format = (raw: string) => {
    if (raw.length < props.value.length) {
      return raw; // effacement : on ne réinsère rien
    }
    const digits = raw.replace(/\D/g, '').slice(0, 8);
    return [digits.slice(0, 2), digits.slice(2, 4), digits.slice(4)]
      .filter(Boolean)
      .join('/');
  };
  return (
    <Row
      icon={props.icon}
      color={props.color}
      focused={focused}
      error={props.error}
    >
      <Text style={styles.label}>{props.label}</Text>
      <View style={styles.inputLine}>
        <TextInput
          accessibilityLabel={spoken(props.label)}
          accessibilityHint="Date au format jour, mois, année"
          value={props.value}
          onChangeText={v => props.onChange(format(v))}
          placeholder="JJ/MM/AAAA"
          placeholderTextColor={colors.textSubtle}
          selectionColor={props.color}
          keyboardType="number-pad"
          maxLength={10}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          style={[styles.input, styles.grow]}
        />
        <CalendarDays color={colors.textMuted} size={20} />
      </View>
    </Row>
  );
}

/** Pastille de choix (une ligne de pastilles = un choix en un geste). */
function Pill(props: {
  label: string;
  selected: boolean;
  color: string;
  onPress: () => void;
  role?: 'radio' | 'button';
}) {
  return (
    <Pressable
      accessibilityRole={props.role ?? 'radio'}
      accessibilityState={
        props.role === 'button' ? undefined : { selected: props.selected }
      }
      accessibilityLabel={props.label}
      hitSlop={4}
      onPress={props.onPress}
      style={({ pressed }) => [
        styles.pill,
        props.selected && {
          borderColor: props.color,
          backgroundColor: tint(props.color, '26'),
        },
        pressed && styles.pressed,
      ]}
    >
      {props.selected ? (
        <Check color={props.color} size={14} strokeWidth={3} />
      ) : null}
      <Text style={[styles.pillText, props.selected && styles.pillTextOn]}>
        {props.label}
      </Text>
    </Pressable>
  );
}

/**
 * Choix parmi quelques options, affichées en pastilles : un appui choisit,
 * un second appui sur la même pastille efface le choix.
 */
export function ChoiceRow(props: {
  icon: Icon;
  color: string;
  label: string;
  value: string;
  options: readonly Option[];
  onChange: (value: string) => void;
  error?: string;
}) {
  return (
    <Row icon={props.icon} color={props.color} error={props.error}>
      <Text style={styles.label}>{props.label}</Text>
      <View
        accessibilityRole="radiogroup"
        accessibilityLabel={bare(props.label)}
        style={styles.pills}
      >
        {props.options.map(option => {
          const selected = option.value === props.value;
          return (
            <Pill
              key={option.value}
              label={option.label}
              selected={selected}
              color={props.color}
              onPress={() => props.onChange(selected ? '' : option.value)}
            />
          );
        })}
      </View>
    </Row>
  );
}

/** Suggestions qui remplissent la fiche d'un appui (nom, calibre…). */
export function Suggestions(props: {
  label: string;
  color: string;
  items: readonly string[];
  current?: string;
  onPick: (index: number) => void;
}) {
  return (
    <View
      accessibilityLabel={props.label}
      style={[styles.pills, styles.suggestions]}
    >
      {props.items.map((item, i) => (
        <Pill
          key={item}
          role="button"
          label={item}
          selected={item === props.current}
          color={props.color}
          onPress={() => props.onPick(i)}
        />
      ))}
    </View>
  );
}

/** Ajoute `delta` à une saisie décimale (virgule française), sans négatif. */
function step(value: string, delta: number): string {
  const current = Number(value.replace(',', '.').trim() || '0');
  const next = Math.max(0, (Number.isFinite(current) ? current : 0) + delta);
  return String(Math.round(next * 1000) / 1000).replace('.', ',');
}

/**
 * Nombre + unité (quantité, poids, valeur énergétique, capacité) : unité
 * choisie d'un appui ; boutons − / + pour les quantités.
 */
export function MeasureRow(props: {
  icon: Icon;
  color: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  unit: string;
  units: readonly Option[];
  onUnit: (value: string) => void;
  placeholder?: string;
  error?: string;
  /** Boutons − / + (quantités). */
  stepper?: boolean;
  /** Saisie masquée : seule l'unité se choisit (modification d'une fiche). */
  unitOnly?: boolean;
  /** Nombre entier (clavier sans virgule). */
  integer?: boolean;
}) {
  const [focused, setFocused] = useState(false);
  const name = bare(props.label);
  const current = props.units.find(x => x.value === props.unit);
  return (
    <Row
      icon={props.icon}
      color={props.color}
      focused={focused}
      error={props.error}
    >
      <Text style={styles.label}>{props.label}</Text>
      {props.unitOnly ? null : (
        <View style={styles.inputLine}>
          {props.stepper ? (
            <StepButton
              label={`Retirer 1 (${name})`}
              symbol="−"
              color={props.color}
              onPress={() => props.onChange(step(props.value, -1))}
            />
          ) : null}
          <TextInput
            accessibilityLabel={spoken(props.label)}
            value={props.value}
            onChangeText={props.onChange}
            placeholder={props.placeholder ?? '0'}
            placeholderTextColor={colors.textSubtle}
            selectionColor={props.color}
            keyboardType={props.integer ? 'number-pad' : 'decimal-pad'}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            style={[
              styles.input,
              styles.grow,
              props.stepper && styles.inputCentered,
            ]}
          />
          {props.stepper ? (
            <StepButton
              label={`Ajouter 1 (${name})`}
              symbol="+"
              color={props.color}
              onPress={() => props.onChange(step(props.value, 1))}
            />
          ) : null}
          {props.units.length === 1 ? (
            <Text style={styles.suffix}>{current?.label}</Text>
          ) : null}
        </View>
      )}
      {props.units.length > 1 ? (
        <View
          accessibilityRole="radiogroup"
          accessibilityLabel={`Unité (${name})`}
          style={styles.pills}
        >
          {props.units.map(option => (
            <Pill
              key={option.value}
              label={option.label}
              selected={option.value === props.unit}
              color={props.color}
              onPress={() => props.onUnit(option.value)}
            />
          ))}
        </View>
      ) : null}
    </Row>
  );
}

function StepButton(props: {
  label: string;
  symbol: string;
  color: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={props.label}
      hitSlop={4}
      onPress={props.onPress}
      style={({ pressed }) => [
        styles.stepButton,
        { borderColor: tint(props.color, '66') },
        pressed && styles.pressed,
      ]}
    >
      <Text style={[styles.stepText, { color: props.color }]}>
        {props.symbol}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 4 },
  line: { flexDirection: 'row', gap: space.s, alignItems: 'stretch' },
  grow: { flex: 1, minWidth: 0 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.m,
    minHeight: 54,
    paddingHorizontal: space.m,
    paddingVertical: 6,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  rowError: { borderColor: colors.danger },
  body: { flex: 1, minWidth: 0 },
  label: { color: colors.textMuted, fontSize: 13 },
  inputLine: { flexDirection: 'row', alignItems: 'center', gap: space.s },
  input: {
    color: colors.text,
    fontSize: 16,
    paddingVertical: 2,
    paddingHorizontal: 0,
    minHeight: 26,
  },
  value: { color: colors.text, fontSize: 16 },
  placeholder: { color: colors.textSubtle },
  suffix: { color: colors.textMuted, fontSize: 15 },
  error: { color: colors.danger, fontSize: 13, paddingHorizontal: space.xs },
  inputCentered: { textAlign: 'center', fontSize: 18, fontWeight: '700' },
  pills: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.s,
    paddingTop: space.s,
    paddingBottom: 2,
  },
  suggestions: { paddingTop: 0 },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    minHeight: 36,
    paddingHorizontal: 12,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bg,
  },
  pillText: { color: colors.textMuted, fontSize: 14 },
  pillTextOn: { color: colors.text, fontWeight: '700' },
  stepButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bg,
  },
  stepText: { fontSize: 24, lineHeight: 28, fontWeight: '600' },
  pressed: { opacity: 0.8 },
});
