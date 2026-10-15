/** Inventaire : liste filtrable, état de chaque article, lots, consommation, ajout. */
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
  Field,
  Notice,
  Panel,
  StatusChip,
} from '../components/controls';
import {
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
  space,
  text,
  toneColor,
  type StatusTone,
} from '../theme';
import { useLoader } from '../useLoader';

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

export function StockScreen() {
  const { repo } = useSession();
  const [filter, setFilter] = useState<ItemCategory | 'all'>('all');
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);

  const { data, error, reload } = useLoader(async () => {
    const all = await repo.listItems();
    const items = (await repo.listItems({
      category: filter === 'all' ? undefined : filter,
      query,
    })) as ItemSummary[];
    const detail =
      expanded === null ? null : await repo.getItem(expanded).catch(() => null);
    return {
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

  return (
    <ScrollView
      contentContainerStyle={styles.page}
      keyboardShouldPersistTaps="handled"
    >
      {feedback ? <Notice {...feedback} /> : null}
      {error ? <Notice tone="error" message={error} /> : null}

      <Field
        label="Rechercher un article"
        value={query}
        onChangeText={setQuery}
        placeholder="riz, piles, filtre…"
        autoCorrect={false}
      />

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
          compact
          variant={adding ? 'ghost' : 'primary'}
          label={adding ? 'Fermer' : '+ Ajouter un article'}
          onPress={() => {
            setAdding(!adding);
            setFeedback(null);
          }}
        />
        <Button
          compact
          label="Jeter les périmés"
          disabled={!data?.hasExpired}
          onPress={() => setConfirmDiscard(true)}
        />
      </View>

      {confirmDiscard ? (
        <Panel accent={colors.danger}>
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
        </Panel>
      ) : null}

      {adding ? (
        <AddItemForm
          onDone={async (item, message) => {
            setAdding(false);
            setFilter('all');
            setQuery('');
            setExpanded(item.id);
            setFeedback({ message, tone: 'ok' });
            await reload();
          }}
        />
      ) : null}

      {data?.items.length === 0 ? (
        <Text style={text.dim}>
          {query
            ? 'Aucun article ne correspond.'
            : 'Aucun article dans cette catégorie.'}
        </Text>
      ) : null}

      {data?.items.map(item => {
        const open = expanded === item.id;
        const state = itemState(item, today);
        const stripe = state ? toneColor[state.tone] : colors.line;
        return (
          <View key={item.id} style={[styles.item, open && styles.itemOpen]}>
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
                  <Text style={text.dim}>
                    {CATEGORY_LABELS[item.category]}
                    {item.location ? ` · ${item.location}` : ''}
                  </Text>
                </View>
                <View style={styles.itemSide}>
                  <Text style={styles.qty}>
                    {formatNumber(item.usableQuantity)}{' '}
                    <Text style={styles.qtyUnit}>{UNIT_LABELS[item.unit]}</Text>
                  </Text>
                  {state ? (
                    <StatusChip tone={state.tone} label={state.label} />
                  ) : item.nextExpiration ? (
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
                  onChanged={async message => {
                    setFeedback(message);
                    await reload();
                  }}
                />
              ) : null}
            </View>
          </View>
        );
      })}
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
      <Text style={text.dim}>
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
    <Panel title="Nouvel article" accent={colors.amber}>
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
            onPress={() => setCategory(c)}
          />
        ))}
      </View>
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
  page: { padding: space.l, gap: space.m, paddingBottom: space.xl },
  row: { flexDirection: 'row', gap: space.s, flexWrap: 'wrap' },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: space.s },
  inline: { flexDirection: 'row', alignItems: 'flex-end', gap: space.s },
  item: {
    flexDirection: 'row',
    backgroundColor: colors.panel,
    borderColor: colors.line,
    borderWidth: 1,
    borderRadius: radius.m,
    overflow: 'hidden',
  },
  itemOpen: { borderColor: colors.lineStrong },
  stripe: { width: 4 },
  itemBody: { flex: 1, minWidth: 0 },
  itemHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: space.m,
    padding: space.m,
  },
  itemName: { ...text.body, fontWeight: '600' },
  itemSide: { alignItems: 'flex-end', gap: 4 },
  qty: { ...text.mono, fontSize: 18, fontWeight: '700' },
  qtyUnit: { color: colors.dim, fontSize: 13, fontWeight: '400' },
  grow: { flex: 1, minWidth: 0 },
  open: { color: colors.amber },
  critical: { color: colors.danger, fontSize: 12 },
  detail: {
    gap: space.s,
    paddingHorizontal: space.m,
    paddingBottom: space.m,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    paddingTop: space.m,
  },
  section: { marginTop: space.s },
  lot: { flexDirection: 'row', justifyContent: 'space-between', gap: space.m },
  expired: { color: colors.danger },
  fieldLabel: { color: colors.dim, fontSize: 14 },
});
