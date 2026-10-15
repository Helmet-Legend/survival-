/**
 * Lignes de fiche (pack « fiches ») : carte sombre, icône de la couleur de
 * la catégorie, libellé au-dessus de la valeur, erreur sous la ligne.
 * Cibles tactiles ≥ 54 px ; chaque saisie porte un libellé accessible.
 */
import {
  CalendarDays,
  Check,
  ChevronDown,
  type LucideIcon,
} from 'lucide-react-native';
import React, { useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type KeyboardTypeOptions,
} from 'react-native';

import { colors, radius, space, text, tint } from '../theme';
import type { Option } from './config';

function Row(props: {
  icon: LucideIcon;
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
  icon: LucideIcon;
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
  icon: LucideIcon;
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

/** Liste de choix dans une feuille modale. */
export function SelectRow(props: {
  icon: LucideIcon;
  color: string;
  label: string;
  value: string;
  options: readonly Option[];
  onChange: (value: string) => void;
  placeholder?: string;
  error?: string;
}) {
  const [open, setOpen] = useState(false);
  const current = props.options.find(x => x.value === props.value);
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${props.label} : ${
          current?.label ?? 'non renseigné'
        }`}
        onPress={() => setOpen(true)}
      >
        <Row icon={props.icon} color={props.color} error={props.error}>
          <Text style={styles.label}>{props.label}</Text>
          <View style={styles.inputLine}>
            <Text
              style={[
                styles.value,
                styles.grow,
                !current && styles.placeholder,
              ]}
              numberOfLines={1}
            >
              {current?.label ?? props.placeholder ?? 'Choisir…'}
            </Text>
            <ChevronDown color={colors.textMuted} size={20} />
          </View>
        </Row>
      </Pressable>
      <OptionSheet
        open={open}
        title={props.label}
        color={props.color}
        options={props.options}
        value={props.value}
        onClose={() => setOpen(false)}
        onPick={value => {
          props.onChange(value);
          setOpen(false);
        }}
      />
    </>
  );
}

function OptionSheet(props: {
  open: boolean;
  title: string;
  color: string;
  options: readonly Option[];
  value: string;
  onClose: () => void;
  onPick: (value: string) => void;
}) {
  return (
    <Modal
      visible={props.open}
      transparent
      animationType="slide"
      onRequestClose={props.onClose}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Fermer la liste"
        style={styles.backdrop}
        onPress={props.onClose}
      />
      <View style={styles.sheet}>
        <Text accessibilityRole="header" style={text.h3}>
          {props.title}
        </Text>
        <ScrollView contentContainerStyle={styles.options}>
          {props.options.map(option => {
            const selected = option.value === props.value;
            return (
              <Pressable
                key={option.value}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                accessibilityLabel={option.label}
                onPress={() => props.onPick(option.value)}
                style={({ pressed }) => [
                  styles.option,
                  selected && {
                    borderColor: props.color,
                    backgroundColor: tint(props.color, '18'),
                  },
                  pressed && styles.pressed,
                ]}
              >
                <Text style={[styles.value, styles.grow]}>{option.label}</Text>
                {selected ? <Check color={props.color} size={20} /> : null}
              </Pressable>
            );
          })}
        </ScrollView>
      </View>
    </Modal>
  );
}

/** Nombre + unité (quantité, poids, valeur énergétique, capacité). */
export function MeasureRow(props: {
  icon: LucideIcon;
  color: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  unit: string;
  units: readonly Option[];
  onUnit: (value: string) => void;
  placeholder?: string;
  error?: string;
}) {
  const [focused, setFocused] = useState(false);
  const [open, setOpen] = useState(false);
  const current = props.units.find(x => x.value === props.unit);
  const fixed = props.units.length <= 1;
  return (
    <>
      <Row
        icon={props.icon}
        color={props.color}
        focused={focused}
        error={props.error}
        side={
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Unité (${bare(props.label)}) : ${
              current?.label ?? ''
            }`}
            disabled={fixed}
            onPress={() => setOpen(true)}
            style={[styles.row, styles.unit]}
          >
            <Text style={styles.value} numberOfLines={1}>
              {current?.label ?? ''}
            </Text>
            {fixed ? null : <ChevronDown color={colors.textMuted} size={18} />}
          </Pressable>
        }
      >
        <Text style={styles.label}>{props.label}</Text>
        <TextInput
          accessibilityLabel={spoken(props.label)}
          value={props.value}
          onChangeText={props.onChange}
          placeholder={props.placeholder ?? '0'}
          placeholderTextColor={colors.textSubtle}
          selectionColor={props.color}
          keyboardType="decimal-pad"
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          style={styles.input}
        />
      </Row>
      <OptionSheet
        open={open}
        title={`Unité : ${bare(props.label)}`}
        color={props.color}
        options={props.units}
        value={props.unit}
        onClose={() => setOpen(false)}
        onPick={value => {
          props.onUnit(value);
          setOpen(false);
        }}
      />
    </>
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
  unit: { minWidth: 104, maxWidth: 150, justifyContent: 'space-between' },
  error: { color: colors.danger, fontSize: 13, paddingHorizontal: space.xs },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)' },
  sheet: {
    maxHeight: '70%',
    backgroundColor: colors.bgElevated,
    borderTopLeftRadius: radius.panel,
    borderTopRightRadius: radius.panel,
    borderWidth: 1,
    borderColor: colors.border,
    padding: space.l,
    gap: space.m,
  },
  options: { gap: space.s, paddingBottom: space.xl },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 52,
    paddingHorizontal: space.l,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  pressed: { opacity: 0.8 },
});
