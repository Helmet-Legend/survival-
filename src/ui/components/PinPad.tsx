/** Pavé numérique de saisie de code, avec indicateur de longueur. */
import { Check, Delete } from 'lucide-react-native';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, fonts, space } from '../theme';

export const PIN_MAX = 12;

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'back', '0', 'ok'];

export function PinDots({ length }: { length: number }) {
  const slots = Math.max(6, length);
  return (
    <View
      style={styles.dots}
      accessible
      accessibilityLabel={`${length} chiffre${length > 1 ? 's' : ''} saisi${
        length > 1 ? 's' : ''
      }`}
    >
      {Array.from({ length: slots }, (_, i) => (
        <View key={i} style={[styles.dot, i < length && styles.dotOn]} />
      ))}
    </View>
  );
}

export function PinPad(props: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  disabled?: boolean;
  submitLabel?: string;
}) {
  const press = (key: string) => {
    if (key === 'ok') {
      props.onSubmit();
    } else if (key === 'back') {
      props.onChange(props.value.slice(0, -1));
    } else if (props.value.length < PIN_MAX) {
      props.onChange(props.value + key);
    }
  };

  return (
    <View style={styles.pad}>
      {KEYS.map(key => {
        const isOk = key === 'ok';
        const isBack = key === 'back';
        const a11y = isBack ? 'Effacer' : isOk ? 'Valider' : `Chiffre ${key}`;
        return (
          <Pressable
            key={key}
            accessibilityRole="button"
            accessibilityLabel={a11y}
            disabled={props.disabled}
            onPress={() => press(key)}
            style={({ pressed }) => [
              styles.key,
              isOk && styles.keyOk,
              isBack && styles.keyFn,
              pressed && styles.pressed,
              props.disabled && styles.disabled,
            ]}
          >
            {isBack ? (
              <Delete color={colors.textMuted} size={28} strokeWidth={1.8} />
            ) : isOk ? (
              props.submitLabel ? (
                <Text style={styles.keyOkText}>{props.submitLabel}</Text>
              ) : (
                <Check color={colors.onPrimary} size={30} strokeWidth={2.6} />
              )
            ) : (
              <Text style={styles.keyText}>{key}</Text>
            )}
          </Pressable>
        );
      })}
    </View>
  );
}

const KEY_SIZE = 76;

const styles = StyleSheet.create({
  dots: { flexDirection: 'row', gap: 14, minHeight: 16 },
  dot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 1.5,
    borderColor: colors.borderActive,
  },
  dotOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  pad: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: space.m,
    width: KEY_SIZE * 3 + 2 * 22,
  },
  key: {
    width: KEY_SIZE,
    height: KEY_SIZE,
    borderRadius: KEY_SIZE / 2,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  keyOk: { backgroundColor: colors.primary, borderColor: colors.primary },
  keyFn: { backgroundColor: 'transparent', borderColor: 'transparent' },
  pressed: { opacity: 0.6 },
  disabled: { opacity: 0.38 },
  keyText: {
    color: colors.text,
    fontFamily: fonts.display,
    fontSize: 30,
    fontWeight: '600',
  },
  keyOkText: { color: colors.onPrimary, fontSize: 20, fontWeight: '700' },
});
