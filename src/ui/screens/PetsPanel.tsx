/**
 * Mon foyer › Animaux : nom, espèce, poids, rations de croquettes et de
 * pâtée, eau par jour (estimée d'après le poids, modifiable) et source de
 * cette eau. Retrait d'un animal après confirmation. Les rations sont
 * saisies par l'utilisateur : aucune n'est supposée.
 */
import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import type { SqlDatabase } from '../../db/types';
import { randomUuid } from '../../inventory/inventoryRepository';
import {
  estimatedWater,
  newPet,
  PET_SPECIES,
  PET_SPECIES_LABELS,
  PET_WATER_NOTE,
  petWater,
  rationMissing,
  savePets,
  takeNewPetRequest,
  WATER_ML_PER_KG,
  type Pet,
} from '../../resilience/pets';
import { Chip, Panel } from '../components/controls';
import { formatNumber, parseDecimal } from '../format';
import { PetsIcon } from '../icons';
import { colors, radius, sizes, space, text, tint } from '../theme';

const SPECIES_ICON: Record<Pet['species'], string> = {
  dog: '🐕',
  cat: '🐈',
  other: '🐾',
};

export function PetsPanel(props: {
  db: SqlDatabase;
  pets: readonly Pet[];
  /** Après chaque enregistrement (le besoin en eau du foyer change). */
  onSaved: () => Promise<void>;
  /** Eau non potable en stock : sinon, l'eau potable est utilisée. */
  hasRawWater: boolean;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const open = props.pets.find(p => p.id === openId) ?? null;

  const save = async (next: readonly Pet[]) => {
    await savePets(props.db, next);
    await props.onSaved();
  };
  const update = (patch: Partial<Pet>) => {
    if (open) {
      void save(
        props.pets.map(p => (p.id === open.id ? { ...p, ...patch } : p)),
      );
    }
  };
  const add = () => {
    const pet = newPet(randomUuid(), props.pets.length + 1);
    setOpenId(pet.id);
    setAsking(false);
    void save([...props.pets, pet]);
  };
  // Arrivée depuis une fiche de stock : fiche d'un nouvel animal ouverte.
  useEffect(() => {
    if (takeNewPetRequest()) {
      add();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const remove = () => {
    if (open) {
      setOpenId(null);
      setAsking(false);
      void save(props.pets.filter(p => p.id !== open.id));
    }
  };

  return (
    <Panel title="Animaux" right={<PetsIcon color={colors.pets} size={20} />}>
      {props.pets.length === 0 ? (
        <Text style={text.subtle}>
          Les rations de nourriture et d’eau de vos animaux se règlent ici, une
          fois pour toutes. Leur nourriture reste à part de celle du foyer.
        </Text>
      ) : null}
      {props.pets.map(p => {
        const missing = rationMissing(p);
        const water = petWater(p);
        const rations = [
          p.kibbleG > 0 ? `croquettes ${formatNumber(p.kibbleG, 0)} g` : '',
          p.wetG > 0 ? `pâtée ${formatNumber(p.wetG, 0)} g` : '',
        ]
          .filter(Boolean)
          .join(' + ');
        return (
          <Pressable
            key={p.id}
            accessibilityRole="button"
            accessibilityState={{ expanded: p.id === openId }}
            accessibilityLabel={`${p.name}, ${PET_SPECIES_LABELS[p.species]}${
              missing ? ', ration à renseigner' : ''
            }`}
            onPress={() => {
              setOpenId(p.id === openId ? null : p.id);
              setAsking(false);
            }}
            style={({ pressed }) => [
              styles.pet,
              p.id === openId && styles.petOpen,
              pressed && styles.pressed,
            ]}
          >
            <View style={styles.petHead}>
              <Text style={styles.petName}>
                {`${SPECIES_ICON[p.species]} ${p.name}`}
              </Text>
              <Text style={text.subtle}>
                {PET_SPECIES_LABELS[p.species]}
                {p.weightKg === null ? '' : ` · ${formatNumber(p.weightKg)} kg`}
              </Text>
            </View>
            <Text style={[text.subtle, missing && styles.warn]}>
              {missing
                ? 'Ration à renseigner'
                : `${rations} / jour · eau ${
                    water === null ? '—' : `${formatNumber(water, 2)} L`
                  } (${p.waterSource === 'raw' ? 'pluie / cuve' : 'potable'})`}
            </Text>
          </Pressable>
        );
      })}
      <Pressable
        accessibilityRole="button"
        onPress={add}
        style={({ pressed }) => [styles.add, pressed && styles.pressed]}
      >
        <Text style={styles.addText}>+ Ajouter un animal</Text>
      </Pressable>

      {open ? (
        <View style={styles.card}>
          <Text style={[text.label, { color: colors.pets }]}>
            {`Fiche de ${open.name}`}
          </Text>
          <TextField
            label="Nom"
            value={open.name}
            onSave={v => update({ name: v.trim() || open.name })}
          />
          <View style={styles.chips}>
            {PET_SPECIES.map(s => (
              <Chip
                key={s}
                label={`${SPECIES_ICON[s]} ${PET_SPECIES_LABELS[s]}`}
                selected={open.species === s}
                onPress={() => update({ species: s })}
              />
            ))}
          </View>
          <NumberField
            label="Poids"
            unit="kg"
            step={1}
            value={open.weightKg}
            onSave={v => update({ weightKg: v })}
            hint={
              open.weightKg === null
                ? 'Facultatif, mais nécessaire pour estimer l’eau.'
                : undefined
            }
          />
          <NumberField
            label="Croquettes par jour"
            unit="g"
            step={10}
            value={open.kibbleG}
            onSave={v => update({ kibbleG: v ?? 0 })}
            hint="D’après le paquet ou le vétérinaire. 0 si aucune."
          />
          <NumberField
            label="Pâtée par jour"
            unit="g"
            step={10}
            value={open.wetG}
            onSave={v => update({ wetG: v ?? 0 })}
            hint="D’après le paquet ou le vétérinaire. 0 si aucune."
          />
          <NumberField
            label="Eau par jour"
            unit="L"
            step={0.1}
            value={petWater(open)}
            onSave={v => update({ waterL: v })}
            hint={waterHint(open)}
            hintTone={open.waterL === null ? 'warn' : 'muted'}
          />
          <Text style={text.subtle}>{`Eau utilisée pour ${open.name}`}</Text>
          <View style={styles.chips}>
            <Chip
              label="Eau potable"
              selected={open.waterSource === 'potable'}
              onPress={() => update({ waterSource: 'potable' })}
            />
            <Chip
              label="Eau de pluie / cuve (non potable)"
              selected={open.waterSource === 'raw'}
              onPress={() => update({ waterSource: 'raw' })}
            />
          </View>
          {open.waterSource === 'raw' && !props.hasRawWater ? (
            <Text style={[text.subtle, styles.warn]}>
              Aucune réserve non potable dans Stocks › Eau : l’eau potable sera
              utilisée.
            </Text>
          ) : null}
          {asking ? (
            <View style={styles.confirm}>
              <Text style={text.body}>
                {`Retirer ${open.name} du foyer ? Ses rations ne seront plus comptées. Les stocks de nourriture restent dans Animaux.`}
              </Text>
              <View style={styles.row}>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => setAsking(false)}
                  style={({ pressed }) => [
                    styles.button,
                    pressed && styles.pressed,
                  ]}
                >
                  <Text style={styles.buttonText}>Annuler</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  onPress={remove}
                  style={({ pressed }) => [
                    styles.button,
                    styles.danger,
                    pressed && styles.pressed,
                  ]}
                >
                  <Text style={styles.buttonText}>Retirer</Text>
                </Pressable>
              </View>
            </View>
          ) : (
            <Pressable
              accessibilityRole="button"
              onPress={() => setAsking(true)}
              style={({ pressed }) => [
                styles.removeButton,
                pressed && styles.pressed,
              ]}
            >
              <Text style={styles.removeText}>
                {`Retirer ${open.name} du foyer`}
              </Text>
            </Pressable>
          )}
        </View>
      ) : null}
    </Panel>
  );
}

function waterHint(pet: Pet): string {
  if (pet.waterL !== null) {
    return 'Valeur saisie par vous.';
  }
  if (estimatedWater(pet) === null) {
    return pet.species === 'other'
      ? 'Indiquez l’eau bue par jour.'
      : 'Indiquez le poids pour une estimation de l’eau.';
  }
  return `Estimation : ${
    WATER_ML_PER_KG[pet.species]
  } mL par kg et par jour. ${PET_WATER_NOTE}`;
}

function TextField(props: {
  label: string;
  value: string;
  onSave: (value: string) => void;
}) {
  const [draft, setDraft] = useState(props.value);
  return (
    <View style={styles.field}>
      <Text style={text.subtle}>{props.label}</Text>
      <TextInput
        accessibilityLabel={props.label}
        value={draft}
        onChangeText={setDraft}
        onEndEditing={() => props.onSave(draft)}
        onBlur={() => props.onSave(draft)}
        maxLength={40}
        selectionColor={colors.primary}
        style={styles.input}
      />
    </View>
  );
}

/** Champ chiffré : saisie directe, avec − et + en complément. */
function NumberField(props: {
  label: string;
  unit: string;
  step: number;
  value: number | null;
  onSave: (value: number | null) => void;
  hint?: string;
  hintTone?: 'warn' | 'muted';
}) {
  const shown = (v: number | null) =>
    v === null ? '' : formatNumber(v, props.step < 1 ? 2 : 0);
  const [draft, setDraft] = useState(shown(props.value));
  const [last, setLast] = useState(props.value);
  if (last !== props.value) {
    setLast(props.value);
    setDraft(shown(props.value));
  }
  const commit = (raw: string) => {
    const n = raw.trim() === '' ? null : parseDecimal(raw);
    props.onSave(n === null || !Number.isFinite(n) || n < 0 ? null : n);
  };
  const stepBy = (sign: 1 | -1) => {
    const base = props.value ?? 0;
    const next = Math.max(
      0,
      Math.round((base + sign * props.step) * 100) / 100,
    );
    props.onSave(next);
  };
  return (
    <View style={styles.field}>
      <Text style={text.subtle}>{props.label}</Text>
      <View style={styles.row}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${props.label} : moins`}
          onPress={() => stepBy(-1)}
          style={({ pressed }) => [styles.step, pressed && styles.pressed]}
        >
          <Text style={styles.stepText}>−</Text>
        </Pressable>
        <TextInput
          accessibilityLabel={props.label}
          value={draft}
          onChangeText={setDraft}
          onEndEditing={() => commit(draft)}
          onBlur={() => commit(draft)}
          keyboardType="decimal-pad"
          placeholder="—"
          placeholderTextColor={colors.textSubtle}
          selectionColor={colors.primary}
          style={[styles.input, styles.number]}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${props.label} : plus`}
          onPress={() => stepBy(1)}
          style={({ pressed }) => [styles.step, pressed && styles.pressed]}
        >
          <Text style={[styles.stepText, { color: colors.cyan }]}>+</Text>
        </Pressable>
        <Text style={[text.subtle, styles.unit]}>{props.unit}</Text>
      </View>
      {props.hint ? (
        <Text style={[text.subtle, props.hintTone === 'warn' && styles.warn]}>
          {props.hint}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  pressed: { opacity: 0.7 },
  warn: { color: colors.warning },
  pet: {
    minHeight: sizes.touch,
    gap: 2,
    borderRadius: radius.m,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingHorizontal: space.m,
    paddingVertical: space.s,
  },
  petOpen: { borderColor: colors.pets },
  petHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: space.s,
  },
  petName: { color: colors.text, fontSize: 16, fontWeight: '700' },
  add: {
    minHeight: sizes.touch,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.m,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.borderActive,
  },
  addText: { color: colors.cyan, fontSize: 16, fontWeight: '700' },
  card: {
    gap: space.m,
    borderRadius: radius.m,
    borderWidth: 1,
    borderColor: colors.pets,
    backgroundColor: colors.surfaceRaised,
    padding: space.m,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.s },
  field: { gap: space.xs },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.s },
  input: {
    minHeight: sizes.inputHeight,
    borderRadius: radius.m,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    color: colors.text,
    fontSize: 17,
    paddingHorizontal: space.m,
  },
  number: { flex: 1, minWidth: 0, textAlign: 'center', fontWeight: '700' },
  step: {
    width: sizes.touch,
    height: sizes.touch,
    borderRadius: sizes.touch / 2,
    borderWidth: 1,
    borderColor: colors.borderActive,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepText: { color: colors.text, fontSize: 22 },
  unit: { width: 28 },
  confirm: {
    gap: space.s,
    borderRadius: radius.m,
    borderWidth: 1,
    borderColor: tint(colors.danger, '80'),
    backgroundColor: colors.dangerSurface,
    padding: space.m,
  },
  button: {
    flex: 1,
    minHeight: sizes.touch,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.m,
    borderWidth: 1,
    borderColor: colors.borderActive,
  },
  danger: { backgroundColor: colors.danger, borderColor: colors.danger },
  buttonText: { color: colors.text, fontSize: 16, fontWeight: '700' },
  removeButton: {
    minHeight: sizes.touch,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.m,
    borderWidth: 1,
    borderColor: tint(colors.danger, '80'),
  },
  removeText: { color: '#FF8A94', fontSize: 15, fontWeight: '700' },
});
