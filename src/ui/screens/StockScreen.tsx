/** Inventaire : liste filtrable, détail des lots, consommation, ajout. */
import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import {
  InventoryError,
  ITEM_CATEGORIES,
  ITEM_UNITS,
  type InventoryItem,
  type InventoryLot,
  type ItemCategory,
  type ItemUnit,
} from '../../inventory';
import { daysBetween, localToday } from '../../lib/dates';
import { Button, Chip, Field, Notice } from '../components/controls';
import {
  CATEGORY_LABELS,
  formatDate,
  formatNumber,
  formatRelativeDays,
  parseDecimal,
  UNIT_LABELS,
} from '../format';
import { useSession } from '../session';
import { colors, space, text } from '../theme';
import { useLoader } from '../useLoader';

type Feedback = { message: string; tone: 'ok' | 'error' } | null;

function errorMessage(error: unknown): string {
  return error instanceof InventoryError || error instanceof Error
    ? error.message
    : String(error);
}

export function StockScreen() {
  const { repo } = useSession();
  const [filter, setFilter] = useState<ItemCategory | 'all'>('all');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);

  const { data, error, reload } = useLoader(async () => {
    const all = await repo.listItems();
    const items =
      filter === 'all' ? all : all.filter(i => i.category === filter);
    const detail =
      expanded === null ? null : await repo.getItem(expanded).catch(() => null);
    return {
      items,
      detail,
      hasExpired: all.some(i => i.totalQuantity > i.usableQuantity),
    };
  }, [filter, expanded]);

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

  return (
    <ScrollView
      contentContainerStyle={styles.page}
      keyboardShouldPersistTaps="handled"
    >
      {feedback ? <Notice {...feedback} /> : null}
      {error ? <Notice tone="error" message={error} /> : null}

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.row}
      >
        <Chip
          label="Tout"
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

      <View style={styles.row}>
        <Button
          label={adding ? 'Fermer' : '+ Ajouter un article'}
          onPress={() => {
            setAdding(!adding);
            setFeedback(null);
          }}
        />
        <Button
          label="Jeter les périmés"
          disabled={!data?.hasExpired}
          onPress={() => setConfirmDiscard(true)}
        />
      </View>

      {confirmDiscard ? (
        <View style={styles.confirm}>
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
            <Button label="Annuler" onPress={() => setConfirmDiscard(false)} />
          </View>
        </View>
      ) : null}

      {adding ? (
        <AddItemForm
          onDone={async (item, message) => {
            setAdding(false);
            setFilter('all');
            setExpanded(item.id);
            setFeedback({ message, tone: 'ok' });
            await reload();
          }}
        />
      ) : null}

      {data?.items.length === 0 ? (
        <Text style={text.dim}>Aucun article dans cette catégorie.</Text>
      ) : null}

      {data?.items.map(item => {
        const open = expanded === item.id;
        return (
          <View key={item.id} style={styles.item}>
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
              <View style={styles.itemMain}>
                <Text style={[text.body, open && styles.open]}>
                  {item.name}
                  {item.isCritical ? (
                    <Text style={styles.critical}> ●</Text>
                  ) : null}
                </Text>
                <Text style={text.dim}>
                  {CATEGORY_LABELS[item.category]}
                  {item.location ? ` · ${item.location}` : ''}
                </Text>
              </View>
              <View style={styles.itemSide}>
                <Text style={text.mono}>
                  {formatNumber(item.usableQuantity)}{' '}
                  <Text style={text.dim}>{UNIT_LABELS[item.unit]}</Text>
                </Text>
                {item.nextExpiration ? (
                  <Text style={text.dim}>
                    {formatRelativeDays(
                      daysBetween(today, item.nextExpiration),
                    )}
                  </Text>
                ) : null}
              </View>
            </Pressable>
            {open && data.detail ? (
              <ItemDetail
                item={data.detail.item}
                lots={data.detail.lots}
                onConsumed={async message => {
                  setFeedback(message);
                  await reload();
                }}
              />
            ) : null}
          </View>
        );
      })}
    </ScrollView>
  );
}

function ItemDetail(props: {
  item: InventoryItem;
  lots: InventoryLot[];
  onConsumed: (feedback: Feedback) => Promise<void>;
}) {
  const { repo } = useSession();
  const [quantity, setQuantity] = useState('');
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
      await props.onConsumed({
        message: `Retiré : ${parts.join(', ')}. Reste ${formatNumber(
          result.remaining,
        )} ${unit}.`,
        tone: 'ok',
      });
    } catch (e) {
      await props.onConsumed({ message: errorMessage(e), tone: 'error' });
    }
  };

  return (
    <View style={styles.detail}>
      {props.lots.length === 0 ? (
        <Text style={text.dim}>Aucun lot.</Text>
      ) : null}
      {props.lots.map(lot => (
        <View key={lot.id} style={styles.lot}>
          <Text style={[text.mono, lot.isExpired && styles.expired]}>
            {formatNumber(lot.quantity)} {unit}
          </Text>
          <Text style={[text.dim, lot.isExpired && styles.expired]}>
            {lot.expirationDate
              ? `${lot.isExpired ? 'périmé le' : 'jusqu’au'} ${formatDate(
                  lot.expirationDate,
                )}`
              : 'non périssable'}
          </Text>
        </View>
      ))}
      <View style={styles.consume}>
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
      <Text style={text.dim}>
        Le lot qui périme le plus tôt est entamé en premier.
      </Text>
    </View>
  );
}

function AddItemForm(props: {
  onDone: (item: InventoryItem, message: string) => Promise<void>;
}) {
  const { repo } = useSession();
  const [name, setName] = useState('');
  const [category, setCategory] = useState<ItemCategory>('food');
  const [unit, setUnit] = useState<ItemUnit>('kg');
  const [quantity, setQuantity] = useState('');
  const [kcal, setKcal] = useState('');
  const [expiration, setExpiration] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});

  const submit = async () => {
    setErrors({});
    try {
      const item = await repo.createItem(
        {
          name,
          category,
          unit,
          caloriesPerUnit: kcal.trim() === '' ? null : parseDecimal(kcal),
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
    <View style={styles.form}>
      <Field
        label="Nom"
        value={name}
        onChangeText={setName}
        placeholder="Ex. Flocons d’avoine"
        maxLength={120}
        error={errors.name}
      />
      <Text style={text.dim}>Catégorie</Text>
      <View style={styles.wrap}>
        {ITEM_CATEGORIES.map(c => (
          <Chip
            key={c}
            label={CATEGORY_LABELS[c]}
            selected={category === c}
            onPress={() => setCategory(c)}
          />
        ))}
      </View>
      <Text style={text.dim}>Unité</Text>
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
      <Field
        label="Quantité"
        value={quantity}
        onChangeText={setQuantity}
        keyboardType="decimal-pad"
        placeholder="2"
        error={errors.quantity}
      />
      <Field
        label="kcal par unité (facultatif)"
        value={kcal}
        onChangeText={setKcal}
        keyboardType="number-pad"
        placeholder="3700"
        error={errors.caloriesPerUnit}
      />
      <Field
        label="À consommer avant le (AAAA-MM-JJ, facultatif)"
        value={expiration}
        onChangeText={setExpiration}
        placeholder="2027-06-30"
        autoCapitalize="none"
        error={errors.expirationDate}
      />
      {errors.form ? <Text style={styles.expired}>{errors.form}</Text> : null}
      <Button
        variant="primary"
        label="Ajouter au stock"
        onPress={() => {
          void submit();
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  page: { padding: space.l, gap: space.m },
  row: { flexDirection: 'row', gap: space.s, flexWrap: 'wrap' },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: space.s },
  confirm: {
    gap: space.s,
    padding: space.m,
    borderWidth: 1,
    borderColor: colors.danger,
    borderRadius: 10,
  },
  form: {
    gap: space.s,
    padding: space.m,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 14,
  },
  item: { borderBottomWidth: 1, borderBottomColor: colors.line },
  itemHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: space.m,
    paddingVertical: space.m,
  },
  itemMain: { flex: 1 },
  itemSide: { alignItems: 'flex-end' },
  open: { color: colors.amber },
  critical: { color: colors.danger, fontSize: 11 },
  detail: { gap: space.s, paddingBottom: space.m },
  lot: { flexDirection: 'row', justifyContent: 'space-between', gap: space.m },
  expired: { color: colors.danger },
  consume: { flexDirection: 'row', alignItems: 'flex-end', gap: space.s },
  grow: { flex: 1 },
});
