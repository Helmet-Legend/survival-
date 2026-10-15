/**
 * Stocks : catégories, recherche, état de chaque article, lots,
 * consommation, réglages et ajout.
 */
import {
  ChevronDown,
  ChevronRight,
  PackageOpen,
  Plus,
  SearchX,
  Trash2,
  X,
} from 'lucide-react-native';
import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import {
  InventoryError,
  ITEM_CATEGORIES,
  ITEM_UNITS,
  type InventoryItem,
  type InventoryLot,
  type ItemCategory,
  type ItemSummary,
  type ItemUnit,
} from '../../inventory';
import { daysBetween, localToday } from '../../lib/dates';
import {
  Button,
  Chip,
  EmptyState,
  Field,
  IconTile,
  Notice,
  Panel,
  SearchField,
  SectionTitle,
  StatusChip,
} from '../components/controls';
import {
  CATEGORY_COLORS,
  CATEGORY_ICONS,
  CATEGORY_LABELS,
  formatDate,
  formatNumber,
  formatRelativeDays,
  parseDecimal,
  UNIT_LABELS,
} from '../format';
import { useSession } from '../session';
import {
  colors,
  radius,
  sizes,
  space,
  text,
  toneColor,
  type StatusTone,
} from '../theme';
import { useLoader } from '../useLoader';
import { ArmorySection } from './ArmorySection';

type Feedback = { message: string; tone: 'ok' | 'error' } | null;

const SOON_DAYS = 30;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Valeur numérique facultative : vide → null. */
function optionalNumber(value: string): number | null {
  return value.trim() === '' ? null : parseDecimal(value);
}

/** État le plus urgent d'un article, pour la bande de couleur et la pastille. */
function itemState(
  item: ItemSummary,
  today: string,
): { tone: StatusTone; label: string } | null {
  if (item.totalQuantity > item.usableQuantity) {
    return { tone: 'danger', label: 'Lot périmé' };
  }
  if (item.minStock !== null && item.usableQuantity < item.minStock) {
    return { tone: 'warn', label: 'Sous le minimum' };
  }
  if (
    item.nextExpiration !== null &&
    daysBetween(today, item.nextExpiration) <= SOON_DAYS
  ) {
    return { tone: 'warn', label: 'Bientôt périmé' };
  }
  return null;
}

/** Quantité parlante d'une catégorie : litres d'eau, kcal de vivres. */
function categoryAmount(
  category: ItemCategory,
  items: readonly ItemSummary[],
): string | null {
  if (category === 'water') {
    const liters = items.reduce(
      (sum, i) =>
        sum + (i.unit === 'mL' ? i.usableQuantity / 1000 : i.usableQuantity),
      0,
    );
    return `${formatNumber(liters)} L`;
  }
  if (category === 'weapon') {
    const rounds = items
      .filter(i => i.unit === 'unit' && i.caliber !== null)
      .reduce((sum, i) => sum + i.usableQuantity, 0);
    return `${formatNumber(rounds, 0)} munition${rounds > 1 ? 's' : ''}`;
  }
  if (category === 'food') {
    const known = items.filter(i => i.caloriesPerUnit !== null);
    if (known.length === 0) {
      return null;
    }
    const kcal = known.reduce(
      (sum, i) => sum + i.usableQuantity * (i.caloriesPerUnit ?? 0),
      0,
    );
    return `${formatNumber(kcal, 0)} kcal`;
  }
  return null;
}

function articles(count: number): string {
  return `${count} article${count > 1 ? 's' : ''}`;
}

export function StockScreen() {
  const { repo, armory } = useSession();
  const [filter, setFilter] = useState<ItemCategory | 'all'>('all');
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);

  const { data, error, reload } = useLoader(async () => {
    const all = (await repo.listItems()) as ItemSummary[];
    const items = (await repo.listItems({
      category: filter === 'all' ? undefined : filter,
      query,
    })) as ItemSummary[];
    const detail =
      expanded === null ? null : await repo.getItem(expanded).catch(() => null);
    const weapons = await armory.listWeapons();
    return {
      weapons,
      all,
      items,
      detail,
      hasExpired: all.some(i => i.totalQuantity > i.usableQuantity),
    };
  }, [filter, expanded, query]);

  const discard = async () => {
    try {
      const removed = await repo.discardExpired();
      setFeedback({
        message: `${removed.length} lot(s) périmé(s) jeté(s).`,
        tone: 'ok',
      });
    } catch (e) {
      setFeedback({ message: errorMessage(e), tone: 'error' });
    }
    setConfirmDiscard(false);
    await reload();
  };

  const today = localToday();
  const showCategories = filter === 'all' && query.trim() === '';

  return (
    <ScrollView
      contentContainerStyle={styles.page}
      keyboardShouldPersistTaps="handled"
    >
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chips}
      >
        <Chip
          label="Tous"
          selected={filter === 'all'}
          onPress={() => setFilter('all')}
        />
        {ITEM_CATEGORIES.map(c => (
          <Chip
            key={c}
            label={CATEGORY_LABELS[c]}
            selected={filter === c}
            onPress={() => setFilter(c)}
          />
        ))}
      </ScrollView>

      <SearchField
        label="Rechercher un article"
        value={query}
        onChangeText={setQuery}
        placeholder="Rechercher un article…"
      />

      {feedback ? <Notice {...feedback} /> : null}
      {error ? <Notice tone="error" message={error} /> : null}

      <View style={styles.row}>
        <Button
          compact
          variant={adding ? 'ghost' : 'primary'}
          icon={adding ? X : Plus}
          label={adding ? 'Fermer' : 'Ajouter'}
          accessibilityLabel={adding ? 'Fermer' : '+ Ajouter un article'}
          onPress={() => {
            setAdding(!adding);
            setFeedback(null);
          }}
        />
        <Button
          compact
          variant="danger"
          icon={Trash2}
          label="Jeter les périmés"
          style={styles.grow}
          disabled={!data?.hasExpired}
          onPress={() => setConfirmDiscard(true)}
        />
      </View>

      {confirmDiscard ? (
        <Panel accent={colors.danger} style={styles.dialog}>
          <Text style={text.body}>
            Supprimer définitivement les lots périmés ?
          </Text>
          <View style={styles.row}>
            <Button
              variant="danger"
              label="Jeter"
              onPress={() => {
                void discard();
              }}
            />
            <Button
              variant="ghost"
              label="Annuler"
              onPress={() => setConfirmDiscard(false)}
            />
          </View>
        </Panel>
      ) : null}

      {adding ? (
        <AddItemForm
          initialCategory={filter === 'all' ? 'food' : filter}
          calibers={[...new Set((data?.weapons ?? []).map(w => w.caliber))]}
          onDone={async (item, message) => {
            setAdding(false);
            setFilter(item.category);
            setQuery('');
            setExpanded(item.id);
            setFeedback({ message, tone: 'ok' });
            await reload();
          }}
        />
      ) : null}

      {showCategories && data
        ? ITEM_CATEGORIES.map(c => {
            const inCategory = data.all.filter(i => i.category === c);
            const amount = categoryAmount(c, inCategory);
            const alerts = inCategory.filter(
              i => itemState(i, today) !== null,
            ).length;
            return (
              <Pressable
                key={c}
                accessibilityRole="button"
                accessibilityLabel={`${CATEGORY_LABELS[c]} : ${
                  amount ? `${amount}, ` : ''
                }${
                  c === 'weapon'
                    ? `${data.weapons.length} arme${
                        data.weapons.length > 1 ? 's' : ''
                      }, `
                    : ''
                }${articles(inCategory.length)}${
                  alerts > 0 ? `, ${alerts} à vérifier` : ''
                }`}
                onPress={() => setFilter(c)}
                style={({ pressed }) => [
                  styles.category,
                  pressed && styles.pressed,
                ]}
              >
                <IconTile icon={CATEGORY_ICONS[c]} color={CATEGORY_COLORS[c]} />
                <View style={styles.grow}>
                  <Text style={text.h3}>{CATEGORY_LABELS[c]}</Text>
                  {amount ? <Text style={styles.amount}>{amount}</Text> : null}
                  <Text style={text.muted}>
                    {c === 'weapon'
                      ? `${data.weapons.length} arme${
                          data.weapons.length > 1 ? 's' : ''
                        } · `
                      : ''}
                    {articles(inCategory.length)}
                    {alerts > 0 ? (
                      <Text style={styles.warn}> · {alerts} à vérifier</Text>
                    ) : null}
                  </Text>
                </View>
                <ChevronRight color={colors.text} size={22} />
              </Pressable>
            );
          })
        : null}

      {filter === 'weapon' && query.trim() === '' && data ? (
        <>
          <ArmorySection
            weapons={data.weapons}
            onChanged={async message => {
              setFeedback(message);
              await reload();
            }}
          />
          <SectionTitle title="Munitions" />
        </>
      ) : null}

      {!showCategories && data?.items.length === 0 ? (
        <EmptyState
          icon={query ? SearchX : PackageOpen}
          title={
            query
              ? 'Aucun article ne correspond.'
              : 'Aucun article dans cette catégorie.'
          }
          message={
            query
              ? 'Vérifiez l’orthographe ou changez de catégorie.'
              : undefined
          }
        />
      ) : null}

      {!showCategories
        ? data?.items.map(item => {
            const open = expanded === item.id;
            const state = itemState(item, today);
            const stripe = state ? toneColor[state.tone] : colors.border;
            const Chevron = open ? ChevronDown : ChevronRight;
            return (
              <View
                key={item.id}
                style={[styles.item, open && styles.itemOpen]}
              >
                <View style={[styles.stripe, { backgroundColor: stripe }]} />
                <View style={styles.itemBody}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityState={{ expanded: open }}
                    accessibilityLabel={`${item.name}, ${formatNumber(
                      item.usableQuantity,
                    )} ${UNIT_LABELS[item.unit]}`}
                    onPress={() => {
                      setExpanded(open ? null : item.id);
                      setFeedback(null);
                    }}
                    style={styles.itemHead}
                  >
                    <View style={styles.grow}>
                      <Text style={[styles.itemName, open && styles.open]}>
                        {item.name}
                        {item.isCritical ? (
                          <Text style={styles.critical}> ●</Text>
                        ) : null}
                      </Text>
                      <Text style={text.subtle}>
                        {CATEGORY_LABELS[item.category]}
                        {item.caliber ? ` · ${item.caliber}` : ''}
                        {item.location ? ` · ${item.location}` : ''}
                      </Text>
                    </View>
                    <View style={styles.itemSide}>
                      <Text style={styles.qty}>
                        {formatNumber(item.usableQuantity)}{' '}
                        <Text style={styles.qtyUnit}>
                          {UNIT_LABELS[item.unit]}
                        </Text>
                      </Text>
                      {state ? (
                        <StatusChip tone={state.tone} label={state.label} />
                      ) : item.nextExpiration ? (
                        <Text style={text.subtle}>
                          {formatRelativeDays(
                            daysBetween(today, item.nextExpiration),
                          )}
                        </Text>
                      ) : null}
                    </View>
                    <Chevron color={colors.textMuted} size={20} />
                  </Pressable>
                  {open && data.detail ? (
                    <ItemDetail
                      item={data.detail.item}
                      lots={data.detail.lots}
                      onChanged={async message => {
                        setFeedback(message);
                        await reload();
                      }}
                    />
                  ) : null}
                </View>
              </View>
            );
          })
        : null}
    </ScrollView>
  );
}

function ItemDetail(props: {
  item: InventoryItem;
  lots: InventoryLot[];
  onChanged: (feedback: Feedback) => Promise<void>;
}) {
  const { repo } = useSession();
  const [quantity, setQuantity] = useState('');
  const [minStock, setMinStock] = useState(
    props.item.minStock === null ? '' : String(props.item.minStock),
  );
  const [alertDays, setAlertDays] = useState(
    props.item.alertDays === null ? '' : String(props.item.alertDays),
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const unit = UNIT_LABELS[props.item.unit];

  const consume = async () => {
    try {
      const result = await repo.consume(props.item.id, parseDecimal(quantity));
      const parts = result.taken.map(
        t =>
          `${formatNumber(t.quantity)} ${unit} ${
            t.expirationDate
              ? `du lot du ${formatDate(t.expirationDate)}`
              : 'du lot sans date'
          }`,
      );
      setQuantity('');
      await props.onChanged({
        message: `Retiré : ${parts.join(', ')}. Reste ${formatNumber(
          result.remaining,
        )} ${unit}.`,
        tone: 'ok',
      });
    } catch (e) {
      await props.onChanged({ message: errorMessage(e), tone: 'error' });
    }
  };

  const saveSettings = async () => {
    setErrors({});
    try {
      await repo.updateItem(props.item.id, {
        minStock: optionalNumber(minStock),
        alertDays: optionalNumber(alertDays),
      });
      await props.onChanged({
        message: `Réglages de « ${props.item.name} » enregistrés.`,
        tone: 'ok',
      });
    } catch (e) {
      if (e instanceof InventoryError && e.field) {
        setErrors({ [e.field]: e.message });
      } else {
        await props.onChanged({ message: errorMessage(e), tone: 'error' });
      }
    }
  };

  return (
    <View style={styles.detail}>
      <Text style={text.label}>Lots, du premier au dernier consommé</Text>
      {props.lots.length === 0 ? (
        <Text style={text.muted}>Aucun lot.</Text>
      ) : null}
      {props.lots.map(lot => (
        <View key={lot.id} style={styles.lot}>
          <Text style={[text.mono, lot.isExpired && styles.expired]}>
            {formatNumber(lot.quantity)} {unit}
          </Text>
          <Text style={[text.muted, lot.isExpired && styles.expired]}>
            {lot.expirationDate
              ? `${lot.isExpired ? 'périmé le' : 'jusqu’au'} ${formatDate(
                  lot.expirationDate,
                )}`
              : 'non périssable'}
          </Text>
        </View>
      ))}

      <View style={styles.inline}>
        <View style={styles.grow}>
          <Field
            label={`Quantité à retirer (${unit})`}
            value={quantity}
            onChangeText={setQuantity}
            keyboardType="decimal-pad"
            placeholder="0"
          />
        </View>
        <Button
          variant="primary"
          label="Retirer"
          disabled={quantity.trim() === ''}
          onPress={() => {
            void consume();
          }}
        />
      </View>

      <Text style={[text.label, styles.section]}>Réglages de l’article</Text>
      <View style={styles.inline}>
        <View style={styles.grow}>
          <Field
            label={`Stock minimal (${unit})`}
            value={minStock}
            onChangeText={setMinStock}
            keyboardType="decimal-pad"
            placeholder="aucun"
            error={errors.minStock}
          />
        </View>
        <View style={styles.grow}>
          <Field
            label="Prévenir (jours avant)"
            value={alertDays}
            onChangeText={setAlertDays}
            keyboardType="number-pad"
            placeholder="30/60/90"
            error={errors.alertDays}
          />
        </View>
      </View>
      <Text style={text.muted}>
        Sous le stock minimal, l’article apparaît dans « À racheter ». Le délai
        d’alerte s’ajoute aux seuils de 30, 60 et 90 jours.
      </Text>
      <View style={styles.row}>
        <Button
          compact
          label="Enregistrer les réglages"
          onPress={() => {
            void saveSettings();
          }}
        />
      </View>
    </View>
  );
}

function defaultUnit(category: ItemCategory): ItemUnit {
  return category === 'water' ? 'L' : category === 'food' ? 'kg' : 'unit';
}

function AddItemForm(props: {
  initialCategory: ItemCategory;
  /** Calibres des armes enregistrées, proposés pour les munitions. */
  calibers: readonly string[];
  onDone: (item: InventoryItem, message: string) => Promise<void>;
}) {
  const { repo } = useSession();
  const [name, setName] = useState('');
  const [category, setCategory] = useState<ItemCategory>(props.initialCategory);
  const [unit, setUnit] = useState<ItemUnit>(
    defaultUnit(props.initialCategory),
  );
  const [caliber, setCaliber] = useState('');
  const [quantity, setQuantity] = useState('');
  const [kcal, setKcal] = useState('');
  const [expiration, setExpiration] = useState('');
  const [minStock, setMinStock] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});

  const submit = async () => {
    setErrors({});
    try {
      const item = await repo.createItem(
        {
          name,
          category,
          unit,
          caloriesPerUnit: optionalNumber(kcal),
          minStock: optionalNumber(minStock),
          caliber,
        },
        {
          quantity: parseDecimal(quantity),
          expirationDate: expiration.trim() === '' ? null : expiration.trim(),
        },
      );
      await props.onDone(item, `« ${item.name} » ajouté au stock.`);
    } catch (e) {
      if (e instanceof InventoryError && e.field) {
        setErrors({ [e.field]: e.message });
      } else {
        setErrors({ form: errorMessage(e) });
      }
    }
  };

  return (
    <Panel title="Nouvel article" accent={colors.primary}>
      <Field
        label="Nom"
        value={name}
        onChangeText={setName}
        placeholder="Ex. Flocons d’avoine"
        maxLength={120}
        error={errors.name}
      />
      <Text style={styles.fieldLabel}>Catégorie</Text>
      <View style={styles.wrap}>
        {ITEM_CATEGORIES.map(c => (
          <Chip
            key={c}
            label={CATEGORY_LABELS[c]}
            selected={category === c}
            onPress={() => {
              setCategory(c);
              setUnit(defaultUnit(c));
            }}
          />
        ))}
      </View>
      {category === 'weapon' ? (
        <>
          <Field
            label="Calibre des munitions"
            value={caliber}
            onChangeText={setCaliber}
            placeholder="Ex. 12/70, .22 LR, 9x19"
            autoCapitalize="none"
            autoCorrect={false}
            maxLength={40}
            error={errors.caliber}
            hint="Comptées en pièces, elles s’affichent sur les armes du même calibre."
          />
          {props.calibers.length > 0 ? (
            <View style={styles.wrap}>
              {props.calibers.map(c => (
                <Chip
                  key={c}
                  label={c}
                  selected={caliber.trim() === c}
                  onPress={() => setCaliber(c)}
                />
              ))}
            </View>
          ) : null}
        </>
      ) : null}
      <Text style={styles.fieldLabel}>Unité</Text>
      <View style={styles.wrap}>
        {ITEM_UNITS.map(u => (
          <Chip
            key={u}
            label={UNIT_LABELS[u]}
            selected={unit === u}
            onPress={() => setUnit(u)}
          />
        ))}
      </View>
      {errors.unit ? <Text style={styles.expired}>{errors.unit}</Text> : null}
      <View style={styles.inline}>
        <View style={styles.grow}>
          <Field
            label="Quantité"
            value={quantity}
            onChangeText={setQuantity}
            keyboardType="decimal-pad"
            placeholder="2"
            error={errors.quantity}
          />
        </View>
        <View style={styles.grow}>
          <Field
            label="kcal par unité"
            value={kcal}
            onChangeText={setKcal}
            keyboardType="number-pad"
            placeholder="facultatif"
            error={errors.caloriesPerUnit}
          />
        </View>
      </View>
      <Field
        label="À consommer avant le (AAAA-MM-JJ, facultatif)"
        value={expiration}
        onChangeText={setExpiration}
        placeholder="2027-06-30"
        autoCapitalize="none"
        error={errors.expirationDate}
      />
      <Field
        label="Stock minimal (facultatif)"
        value={minStock}
        onChangeText={setMinStock}
        keyboardType="decimal-pad"
        placeholder="ex. 2"
        error={errors.minStock}
        hint="L’article apparaîtra dans « À racheter » en dessous de ce seuil."
      />
      {errors.form ? <Text style={styles.expired}>{errors.form}</Text> : null}
      <Button
        variant="primary"
        label="Ajouter au stock"
        onPress={() => {
          void submit();
        }}
      />
    </Panel>
  );
}

const styles = StyleSheet.create({
  page: {
    paddingHorizontal: sizes.screenPadding,
    paddingBottom: space.xl,
    gap: space.m,
  },
  chips: { flexDirection: 'row', gap: space.s },
  row: { flexDirection: 'row', gap: space.s },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: space.s },
  inline: { flexDirection: 'row', alignItems: 'flex-end', gap: space.s },
  dialog: { backgroundColor: colors.bgElevated },
  category: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.l,
    minHeight: 88,
    padding: space.l,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.card,
  },
  amount: { ...text.value, fontSize: 22 },
  warn: { color: colors.warning },
  pressed: { opacity: 0.82 },
  item: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.card,
    overflow: 'hidden',
  },
  itemOpen: { borderColor: colors.borderActive },
  stripe: { width: 4 },
  itemBody: { flex: 1, minWidth: 0 },
  itemHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.m,
    minHeight: sizes.touch,
    padding: space.m,
  },
  itemName: { ...text.body, fontWeight: '600' },
  itemSide: { alignItems: 'flex-end', gap: 4 },
  qty: { ...text.mono, fontSize: 18, fontWeight: '700' },
  qtyUnit: { color: colors.textMuted, fontSize: 13, fontWeight: '400' },
  grow: { flex: 1, minWidth: 0 },
  open: { color: colors.primary },
  critical: { color: colors.danger, fontSize: 12 },
  detail: {
    gap: space.s,
    paddingHorizontal: space.m,
    paddingBottom: space.m,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: space.m,
  },
  section: { marginTop: space.s },
  lot: { flexDirection: 'row', justifyContent: 'space-between', gap: space.m },
  expired: { color: colors.danger },
  fieldLabel: { color: colors.textMuted, fontSize: 14 },
});
