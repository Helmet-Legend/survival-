/**
 * Armes enregistrées (modèle, type, calibre, n° de série) et munitions
 * disponibles pour chacune, affichées dans la catégorie « Armes et
 * munitions » de l'écran Stocks.
 */
import { Crosshair, Pencil, Plus, Trash2, X } from 'lucide-react-native';
import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import {
  InventoryError,
  WEAPON_KINDS,
  type WeaponKind,
  type WeaponSummary,
} from '../../inventory';
import {
  Button,
  Chip,
  Field,
  IconTile,
  Panel,
  SectionTitle,
  StatusChip,
} from '../components/controls';
import { PhotoStrip } from '../components/PhotoStrip';
import { formatNumber, WEAPON_KIND_LABELS } from '../format';
import { useSession } from '../session';
import { colors, radius, space, text } from '../theme';

type Feedback = { message: string; tone: 'ok' | 'error' };

function rounds(count: number): string {
  return `${formatNumber(count, 0)} munition${count > 1 ? 's' : ''}`;
}

export function ArmorySection(props: {
  weapons: readonly WeaponSummary[];
  onChanged: (feedback: Feedback) => Promise<void>;
}) {
  const { armory } = useSession();
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const remove = async (weapon: WeaponSummary) => {
    setConfirmDelete(null);
    setExpanded(null);
    try {
      await armory.deleteWeapon(weapon.id);
      await props.onChanged({
        message: `« ${weapon.model} » retirée. Les munitions restent en stock.`,
        tone: 'ok',
      });
    } catch (e) {
      await props.onChanged({
        message: e instanceof Error ? e.message : String(e),
        tone: 'error',
      });
    }
  };

  return (
    <View style={styles.section}>
      <SectionTitle
        title="Armes"
        right={
          <Button
            compact
            variant={editing === 'new' ? 'ghost' : 'secondary'}
            icon={editing === 'new' ? X : Plus}
            label={editing === 'new' ? 'Fermer' : 'Ajouter une arme'}
            onPress={() => setEditing(editing === 'new' ? null : 'new')}
          />
        }
      />

      {editing === 'new' ? (
        <WeaponForm
          onDone={async message => {
            setEditing(null);
            await props.onChanged({ message, tone: 'ok' });
          }}
        />
      ) : null}

      {props.weapons.length === 0 && editing !== 'new' ? (
        <Text style={text.muted}>
          Aucune arme enregistrée. Ajoutez-en une pour suivre ses munitions par
          calibre.
        </Text>
      ) : null}

      {props.weapons.map(weapon =>
        editing === weapon.id ? (
          <WeaponForm
            key={weapon.id}
            weapon={weapon}
            onCancel={() => setEditing(null)}
            onDone={async message => {
              setEditing(null);
              await props.onChanged({ message, tone: 'ok' });
            }}
          />
        ) : (
          <View key={weapon.id} style={styles.card}>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ expanded: expanded === weapon.id }}
              accessibilityLabel={`${weapon.model}, ${weapon.caliber}, ${rounds(
                weapon.rounds,
              )}`}
              onPress={() =>
                setExpanded(expanded === weapon.id ? null : weapon.id)
              }
              style={({ pressed }) => [styles.head, pressed && styles.pressed]}
            >
              <IconTile icon={Crosshair} color={colors.purple} />
              <View style={styles.grow}>
                <Text style={text.h3}>{weapon.model}</Text>
                <Text style={text.muted}>
                  {WEAPON_KIND_LABELS[weapon.kind]} · {weapon.caliber}
                </Text>
                {weapon.rounds === 0 ? (
                  <StatusChip tone="warn" label="Aucune munition" />
                ) : null}
              </View>
              {weapon.rounds > 0 ? (
                <View style={styles.side}>
                  <Text style={styles.rounds}>
                    {formatNumber(weapon.rounds, 0)}
                  </Text>
                  <Text style={text.subtle}>munitions</Text>
                </View>
              ) : null}
            </Pressable>
            {expanded === weapon.id ? (
              <View style={styles.detail}>
                <Text style={text.muted}>
                  N° de série : {weapon.serialNumber ?? 'non renseigné'}
                </Text>
                {weapon.notes ? (
                  <Text style={text.body}>{weapon.notes}</Text>
                ) : null}
                <PhotoStrip
                  owner="weapon"
                  ownerId={weapon.id}
                  label={weapon.model}
                />
                <Text style={text.subtle}>
                  Munitions comptées : articles « Armes et munitions » en
                  pièces, au calibre {weapon.caliber}, lots non périmés.
                </Text>
                {confirmDelete === weapon.id ? (
                  <Panel accent={colors.danger} style={styles.dialog}>
                    <Text style={text.body}>
                      Retirer « {weapon.model} » ? Les munitions restent en
                      stock.
                    </Text>
                    <View style={styles.row}>
                      <Button
                        variant="danger"
                        label="Retirer"
                        onPress={() => {
                          void remove(weapon);
                        }}
                      />
                      <Button
                        variant="ghost"
                        label="Annuler"
                        onPress={() => setConfirmDelete(null)}
                      />
                    </View>
                  </Panel>
                ) : (
                  <View style={styles.row}>
                    <Button
                      compact
                      icon={Pencil}
                      label="Modifier"
                      onPress={() => setEditing(weapon.id)}
                    />
                    <Button
                      compact
                      variant="danger"
                      icon={Trash2}
                      label="Retirer l’arme"
                      onPress={() => setConfirmDelete(weapon.id)}
                    />
                  </View>
                )}
              </View>
            ) : null}
          </View>
        ),
      )}
    </View>
  );
}

function WeaponForm(props: {
  weapon?: WeaponSummary;
  onDone: (message: string) => Promise<void>;
  onCancel?: () => void;
}) {
  const { armory } = useSession();
  const [model, setModel] = useState(props.weapon?.model ?? '');
  const [kind, setKind] = useState<WeaponKind>(props.weapon?.kind ?? 'rifle');
  const [caliber, setCaliber] = useState(props.weapon?.caliber ?? '');
  const [serial, setSerial] = useState(props.weapon?.serialNumber ?? '');
  const [notes, setNotes] = useState(props.weapon?.notes ?? '');
  const [errors, setErrors] = useState<Record<string, string>>({});

  const submit = async () => {
    setErrors({});
    const input = { model, kind, caliber, serialNumber: serial, notes };
    try {
      const saved = props.weapon
        ? await armory.updateWeapon(props.weapon.id, input)
        : await armory.createWeapon(input);
      await props.onDone(
        props.weapon
          ? `« ${saved.model} » modifiée.`
          : `« ${saved.model} » ajoutée.`,
      );
    } catch (e) {
      if (e instanceof InventoryError && e.field) {
        setErrors({ [e.field]: e.message });
      } else {
        setErrors({ form: e instanceof Error ? e.message : String(e) });
      }
    }
  };

  return (
    <Panel
      title={props.weapon ? 'Modifier l’arme' : 'Nouvelle arme'}
      accent={colors.primary}
    >
      <Field
        label="Marque et modèle"
        value={model}
        onChangeText={setModel}
        placeholder="Ex. Browning B525"
        maxLength={120}
        error={errors.model}
      />
      <Text style={styles.fieldLabel}>Type</Text>
      <View style={styles.wrap}>
        {WEAPON_KINDS.map(k => (
          <Chip
            key={k}
            label={WEAPON_KIND_LABELS[k]}
            selected={kind === k}
            onPress={() => setKind(k)}
          />
        ))}
      </View>
      <Field
        label="Calibre"
        value={caliber}
        onChangeText={setCaliber}
        placeholder="Ex. 12/70, .22 LR, 9x19"
        autoCapitalize="none"
        autoCorrect={false}
        maxLength={40}
        error={errors.caliber}
      />
      <Field
        label="N° de série (facultatif)"
        value={serial}
        onChangeText={setSerial}
        autoCapitalize="characters"
        autoCorrect={false}
        maxLength={60}
        error={errors.serialNumber}
      />
      <Field
        label="Notes (facultatif)"
        value={notes}
        onChangeText={setNotes}
        placeholder="Lunette, rangement, entretien…"
        multiline
        maxLength={500}
        error={errors.notes}
      />
      {errors.form ? <Text style={styles.error}>{errors.form}</Text> : null}
      <View style={styles.row}>
        <Button
          variant="primary"
          label={props.weapon ? 'Enregistrer l’arme' : 'Ajouter l’arme'}
          onPress={() => {
            void submit();
          }}
        />
        {props.onCancel ? (
          <Button variant="ghost" label="Annuler" onPress={props.onCancel} />
        ) : null}
      </View>
    </Panel>
  );
}

const styles = StyleSheet.create({
  section: { gap: space.m },
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.card,
    overflow: 'hidden',
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.l,
    padding: space.l,
  },
  pressed: { opacity: 0.82 },
  grow: { flex: 1, minWidth: 0, gap: 4 },
  side: { alignItems: 'flex-end' },
  rounds: { ...text.value, fontSize: 24, color: colors.primaryBright },
  detail: {
    gap: space.s,
    paddingHorizontal: space.l,
    paddingBottom: space.l,
    paddingTop: space.m,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  dialog: { backgroundColor: colors.bgElevated },
  row: { flexDirection: 'row', gap: space.s, flexWrap: 'wrap' },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: space.s },
  fieldLabel: { color: colors.textMuted, fontSize: 14 },
  error: { color: colors.danger },
});
