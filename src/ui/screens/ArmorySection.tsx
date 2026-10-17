/**
 * Armes enregistrées (modèle, type, calibre, n° de série) et munitions
 * disponibles pour chacune, affichées dans la catégorie « Armes et
 * munitions » de l'écran Stocks.
 */
import {
  Crosshair,
  Eye,
  EyeOff,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-react-native';
import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import {
  caliberKey,
  roundCount,
  type ItemSummary,
  type WeaponSummary,
} from '../../inventory';
import {
  Button,
  IconTile,
  Panel,
  SectionTitle,
  StatusChip,
} from '../components/controls';
import { PhotoStrip } from '../components/PhotoStrip';
import { CATEGORY_COLORS, formatNumber, WEAPON_KIND_LABELS } from '../format';
import { useNavigation } from '../navigation';
import { itemUnitLabel, weaponFacts } from '../stockForms/details';
import { useSession } from '../session';
import { colors, radius, space, text } from '../theme';

type Feedback = { message: string; tone: 'ok' | 'error' };

/** Munitions (pas les accessoires) au même calibre qu'une arme. */
function matchingAmmo(
  items: readonly ItemSummary[],
  caliber: string,
): ItemSummary[] {
  const key = caliberKey(caliber);
  return items.filter(
    i =>
      i.attributes.recordType !== 'accessory' &&
      i.caliber !== null &&
      caliberKey(i.caliber) === key &&
      roundCount(1, i.packageSize, i.attributes) !== null,
  );
}

function rounds(count: number): string {
  return `${formatNumber(count, 0)} munition${count > 1 ? 's' : ''}`;
}

export function ArmorySection(props: {
  weapons: readonly WeaponSummary[];
  /** Articles de la catégorie Armement (munitions et accessoires). */
  ammo: readonly ItemSummary[];
  /** Ouvre la fiche d'un article de munitions (pour compléter son stock). */
  onOpenItem: (itemId: string) => void;
  onChanged: (feedback: Feedback) => Promise<void>;
}) {
  const { armory } = useSession();
  const navigation = useNavigation();
  const [revealed, setRevealed] = useState<string | null>(null);
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
            variant="secondary"
            icon={Plus}
            label="Ajouter une arme"
            onPress={() =>
              navigation.openStockForm({
                category: 'weapon',
                recordType: 'weapon',
              })
            }
          />
        }
      />

      {props.weapons.length === 0 ? (
        <Text style={text.muted}>
          Aucune arme enregistrée. Ajoutez-en une pour suivre ses munitions par
          calibre.
        </Text>
      ) : null}

      {props.weapons.map(weapon => (
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
            <IconTile icon={Crosshair} color={CATEGORY_COLORS.weapon} />
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
              {weaponFacts(weapon).map(([label, value]) => (
                <Text key={label} style={text.muted}>
                  {label} : <Text style={styles.factValue}>{value}</Text>
                </Text>
              ))}
              {weapon.attributes.location ? (
                <Text style={text.muted}>
                  Emplacement :{' '}
                  <Text style={styles.factValue}>
                    {weapon.attributes.location}
                  </Text>
                </Text>
              ) : null}
              {weapon.serialNumber ? (
                <View style={styles.serial}>
                  <Text style={[text.muted, styles.grow]}>
                    N° de série :{' '}
                    <Text style={styles.factValue}>
                      {revealed === weapon.id
                        ? weapon.serialNumber
                        : '•'.repeat(Math.min(weapon.serialNumber.length, 10))}
                    </Text>
                  </Text>
                  <Button
                    compact
                    variant="ghost"
                    icon={revealed === weapon.id ? EyeOff : Eye}
                    label={revealed === weapon.id ? 'Masquer' : 'Afficher'}
                    accessibilityLabel={
                      revealed === weapon.id
                        ? 'Masquer le numéro de série'
                        : 'Afficher le numéro de série'
                    }
                    onPress={() =>
                      setRevealed(revealed === weapon.id ? null : weapon.id)
                    }
                  />
                </View>
              ) : null}
              <PhotoStrip
                owner="weapon"
                ownerId={weapon.id}
                label={weapon.model}
              />
              <Text style={[text.label, styles.ammoTitle]}>
                Munitions en {weapon.caliber}
              </Text>
              {matchingAmmo(props.ammo, weapon.caliber).map(item => (
                <Pressable
                  key={item.id}
                  accessibilityRole="button"
                  accessibilityLabel={`Compléter « ${
                    item.name
                  } », ${formatNumber(item.usableQuantity)} ${itemUnitLabel(
                    item,
                    item.usableQuantity,
                  )}`}
                  onPress={() => props.onOpenItem(item.id)}
                  style={({ pressed }) => [
                    styles.ammo,
                    pressed && styles.pressed,
                  ]}
                >
                  <Text style={[text.body, styles.grow]} numberOfLines={1}>
                    {item.name}
                  </Text>
                  <Text style={styles.factValue}>
                    {formatNumber(item.usableQuantity)}{' '}
                    {itemUnitLabel(item, item.usableQuantity)}
                  </Text>
                  <Text style={styles.link}>Compléter</Text>
                </Pressable>
              ))}
              {matchingAmmo(props.ammo, weapon.caliber).length === 0 ? (
                <Text style={text.subtle}>
                  Aucune munition de ce calibre en stock.
                </Text>
              ) : null}
              <Button
                compact
                variant="primary"
                icon={Plus}
                label="Ajouter des munitions"
                accessibilityLabel={`Ajouter des munitions en ${weapon.caliber}`}
                onPress={() =>
                  navigation.openStockForm({
                    category: 'weapon',
                    recordType: 'ammo',
                    prefill: {
                      caliber: weapon.caliber,
                      name: `Munitions ${weapon.caliber}`,
                    },
                  })
                }
              />
              <Text style={text.subtle}>
                Comptées : cartouches, ou boîtes dont la contenance est
                renseignée, lots non périmés.
              </Text>
              {confirmDelete === weapon.id ? (
                <Panel accent={colors.danger} style={styles.dialog}>
                  <Text style={text.body}>
                    Retirer « {weapon.model} » ? Les munitions restent en stock.
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
                    onPress={() =>
                      navigation.openStockForm({
                        category: 'weapon',
                        weaponId: weapon.id,
                      })
                    }
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
      ))}
    </View>
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
  serial: { flexDirection: 'row', alignItems: 'center', gap: space.s },
  ammoTitle: { marginTop: space.s },
  ammo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.m,
    minHeight: 48,
    paddingHorizontal: space.m,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bg,
  },
  link: { color: colors.primary, fontWeight: '700' },
  factValue: { color: colors.text },
});
