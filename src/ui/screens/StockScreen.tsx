/**
 * Stocks : catégories, recherche, état de chaque article, lots,
 * consommation, réglages et ajout.
 */
import {
  ChevronDown,
  ChevronRight,
  FolderLock,
  Minus,
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
  type InventoryItem,
  type InventoryLot,
  type ItemCategory,
  type ItemSummary,
  type ItemUnit,
  type DocumentSummary,
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
import { PROFILES, packageSummary, unitLabel } from '../itemProfiles';
import { useLoader } from '../useLoader';
import { ArmorySection } from './ArmorySection';
import { DocumentsSection, documentStatus } from './DocumentsSection';

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

function renewCount(docs: readonly DocumentSummary[]): number {
  return docs.filter(d => documentStatus(d) !== null).length;
}

function articles(count: number): string {
  return `${count} article${count > 1 ? 's' : ''}`;
}

export function StockScreen() {
  const { repo, armory, documents } = useSession();
  const [filter, setFilter] = useState<ItemCategory | 'all' | 'documents'>(
    'all',
  );
  const isDocs = filter === 'documents';
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);

  const { data, error, reload } = useLoader(async () => {
    const all = (await repo.listItems()) as ItemSummary[];
    const items = isDocs
      ? []
      : ((await repo.listItems({
          category: filter === 'all' ? undefined : filter,
          query,
        })) as ItemSummary[]);
    const detail =
      expanded === null ? null : await repo.getItem(expanded).catch(() => null);
    const weapons = await armory.listWeapons();
    const docs = await documents.list();
    return {
      weapons,
      docs,
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
        <Chip
          label="Documents"
          selected={isDocs}
          onPress={() => setFilter('documents')}
        />
      </ScrollView>

      {isDocs && data ? (
        <>
          {feedback ? <Notice {...feedback} /> : null}
          {error ? <Notice tone="error" message={error} /> : null}
          <DocumentsSection
            documents={data.docs}
            onChanged={async message => {
              setFeedback(message);
              await reload();
            }}
          />
        </>
      ) : null}

      {isDocs ? null : (
        <>
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
                    <IconTile
                      icon={CATEGORY_ICONS[c]}
                      color={CATEGORY_COLORS[c]}
                    />
                    <View style={styles.grow}>
                      <Text style={text.h3}>{CATEGORY_LABELS[c]}</Text>
                      {amount ? (
                        <Text style={styles.amount}>{amount}</Text>
                      ) : null}
                      <Text style={text.muted}>
                        {c === 'weapon'
                          ? `${data.weapons.length} arme${
                              data.weapons.length > 1 ? 's' : ''
                            } · `
                          : ''}
                        {articles(inCategory.length)}
                        {alerts > 0 ? (
                          <Text style={styles.warn}>
                            {' '}
                            · {alerts} à vérifier
                          </Text>
                        ) : null}
                      </Text>
                    </View>
                    <ChevronRight color={colors.text} size={22} />
                  </Pressable>
                );
              })
            : null}

          {showCategories && data ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Documents : ${data.docs.length} document${
                data.docs.length > 1 ? 's' : ''
              }${
                renewCount(data.docs) > 0
                  ? `, ${renewCount(data.docs)} à renouveler`
                  : ''
              }`}
              onPress={() => setFilter('documents')}
              style={({ pressed }) => [
                styles.category,
                pressed && styles.pressed,
              ]}
            >
              <IconTile icon={FolderLock} color={colors.cyan} />
              <View style={styles.grow}>
                <Text style={text.h3}>Documents</Text>
                <Text style={text.muted}>
                  {data.docs.length} document{data.docs.length > 1 ? 's' : ''}
                  {renewCount(data.docs) > 0 ? (
                    <Text style={styles.warn}>
                      {' '}
                      · {renewCount(data.docs)} à renouveler
                    </Text>
                  ) : null}
                </Text>
              </View>
              <ChevronRight color={colors.text} size={22} />
            </Pressable>
          ) : null}

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
                    <View
                      style={[styles.stripe, { backgroundColor: stripe }]}
                    />
                    <View style={styles.itemBody}>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityState={{ expanded: open }}
                        accessibilityLabel={`${item.name}, ${formatNumber(
                          item.usableQuantity,
                        )} ${unitLabel(item.category, item.unit)}`}
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
                            {packageSummary(item, item.usableQuantity)
                              ? ` · ${packageSummary(
                                  item,
                                  item.usableQuantity,
                                )}`
                              : ''}
                            {item.location ? ` · ${item.location}` : ''}
                          </Text>
                        </View>
                        <View style={styles.itemSide}>
                          <Text style={styles.qty}>
                            {formatNumber(item.usableQuantity)}{' '}
                            <Text style={styles.qtyUnit}>
                              {unitLabel(item.category, item.unit)}
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
        </>
      )}
    </ScrollView>
  );
}

/**
 * Quantité saisie selon la catégorie : « contenance × nombre » pour les
 * articles en contenants (bidons d'eau, boîtes de cartouches), quantité
 * directe sinon. Renvoie aussi le total calculé, affiché sous les champs.
 */
function QuantityFields(props: {
  category: ItemCategory;
  unit: ItemUnit;
  /** Contenance déjà connue (article existant) : seul le nombre est demandé. */
  knownSize: number | null;
  size: string;
  onSize: (value: string) => void;
  count: string;
  onCount: (value: string) => void;
  errors: Record<string, string>;
}) {
  const container = PROFILES[props.category].container;
  const unitText = unitLabel(props.category, props.unit);
  const sizeValue =
    props.knownSize ??
    (props.size.trim() === '' ? null : parseDecimal(props.size));
  const packaged = container !== null && sizeValue !== null;
  const total = totalQuantity(props.count, sizeValue, container !== null);
  return (
    <>
      {container !== null && props.knownSize === null ? (
        <Field
          label={`Contenance d’un ${container.one} (${unitText})`}
          value={props.size}
          onChangeText={props.onSize}
          keyboardType="decimal-pad"
          placeholder={props.category === 'water' ? 'ex. 10' : 'ex. 25'}
          error={props.errors.packageSize}
          hint={
            props.category === 'water'
              ? 'Bidon, bouteille, jerrican… Laisser vide pour saisir des litres.'
              : 'Laisser vide pour saisir des cartouches à l’unité.'
          }
        />
      ) : null}
      <Field
        label={
          packaged ? `Nombre de ${container.many}` : `Quantité (${unitText})`
        }
        value={props.count}
        onChangeText={props.onCount}
        keyboardType="decimal-pad"
        placeholder={packaged ? 'ex. 3' : 'ex. 2'}
        error={props.errors.quantity}
      />
      {packaged && Number.isFinite(total) && total > 0 ? (
        <Text style={styles.total}>
          = {formatNumber(total)} {unitText}
        </Text>
      ) : null}
    </>
  );
}

/** Total dans l'unité de l'article ; NaN si la saisie est incomplète. */
function totalQuantity(
  count: string,
  size: number | null,
  hasContainer: boolean,
): number {
  const n = parseDecimal(count);
  return hasContainer && size !== null ? n * size : n;
}

function ItemDetail(props: {
  item: InventoryItem;
  lots: InventoryLot[];
  onChanged: (feedback: Feedback) => Promise<void>;
}) {
  const { repo } = useSession();
  const { item } = props;
  const profile = PROFILES[item.category];
  const container = profile.container;
  const [quantity, setQuantity] = useState('');
  const [addCount, setAddCount] = useState('');
  const [addSize, setAddSize] = useState('');
  const [addExpiration, setAddExpiration] = useState('');
  const [minStock, setMinStock] = useState(
    item.minStock === null ? '' : String(item.minStock),
  );
  const [alertDays, setAlertDays] = useState(
    item.alertDays === null ? '' : String(item.alertDays),
  );
  const [packageSize, setPackageSize] = useState(
    item.packageSize === null ? '' : String(item.packageSize),
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const unit = unitLabel(item.category, item.unit);
  const usable = props.lots
    .filter(l => !l.isExpired)
    .reduce((sum, l) => sum + l.quantity, 0);
  const summary = packageSummary(item, usable);

  const consume = async (amount: number) => {
    try {
      const result = await repo.consume(item.id, amount);
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

  const addStock = async () => {
    setErrors({});
    try {
      const size =
        item.packageSize ??
        (addSize.trim() === '' ? null : parseDecimal(addSize));
      await repo.addLot(item.id, {
        quantity: totalQuantity(addCount, size, container !== null),
        expirationDate:
          addExpiration.trim() === '' ? null : addExpiration.trim(),
      });
      setAddCount('');
      setAddExpiration('');
      await props.onChanged({
        message: `Stock de « ${item.name} » complété.`,
        tone: 'ok',
      });
    } catch (e) {
      if (e instanceof InventoryError && e.field) {
        setErrors({
          [e.field === 'expirationDate' ? 'addExpiration' : e.field]: e.message,
        });
      } else {
        await props.onChanged({ message: errorMessage(e), tone: 'error' });
      }
    }
  };

  const saveSettings = async () => {
    setErrors({});
    try {
      await repo.updateItem(item.id, {
        minStock: optionalNumber(minStock),
        alertDays: optionalNumber(alertDays),
        ...(container !== null
          ? { packageSize: optionalNumber(packageSize) }
          : {}),
      });
      await props.onChanged({
        message: `Réglages de « ${item.name} » enregistrés.`,
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
      {summary ? <Text style={styles.summary}>{summary}</Text> : null}
      {item.caliber ? (
        <Text style={text.muted}>Calibre : {item.caliber}</Text>
      ) : null}

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

      <Text style={[text.label, styles.section]}>Utiliser</Text>
      {container !== null && item.packageSize !== null ? (
        <Button
          compact
          icon={Minus}
          label={`Retirer 1 ${container.one} (${formatNumber(
            item.packageSize,
          )} ${unitLabel(item.category, item.unit, item.packageSize)})`}
          disabled={usable < item.packageSize}
          onPress={() => {
            void consume(item.packageSize ?? 0);
          }}
        />
      ) : null}
      <View style={styles.inline}>
        <View style={styles.grow}>
          <Field
            label={`Quantité à retirer (${UNIT_LABELS[item.unit]})`}
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
            void consume(parseDecimal(quantity));
          }}
        />
      </View>

      <Text style={[text.label, styles.section]}>Ajouter du stock</Text>
      <QuantityFields
        category={item.category}
        unit={item.unit}
        knownSize={item.packageSize}
        size={addSize}
        onSize={setAddSize}
        count={addCount}
        onCount={setAddCount}
        errors={errors}
      />
      <Field
        label="À consommer avant le (AAAA-MM-JJ, facultatif)"
        value={addExpiration}
        onChangeText={setAddExpiration}
        placeholder="2027-06-30"
        autoCapitalize="none"
        error={errors.addExpiration}
      />
      <View style={styles.row}>
        <Button
          compact
          icon={Plus}
          label="Ajouter au stock existant"
          disabled={addCount.trim() === ''}
          onPress={() => {
            void addStock();
          }}
        />
      </View>

      <Text style={[text.label, styles.section]}>Réglages de l’article</Text>
      {container !== null ? (
        <Field
          label={`Contenance d’un ${container.one} (${unit})`}
          value={packageSize}
          onChangeText={setPackageSize}
          keyboardType="decimal-pad"
          placeholder="aucune"
          error={errors.packageSize}
        />
      ) : null}
      <View style={styles.inline}>
        <View style={styles.grow}>
          <Field
            label={`Stock minimal (${UNIT_LABELS[item.unit]})`}
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
    PROFILES[props.initialCategory].units[0],
  );
  const [caliber, setCaliber] = useState('');
  const [size, setSize] = useState('');
  const [count, setCount] = useState('');
  const [kcal, setKcal] = useState('');
  const [expiration, setExpiration] = useState('');
  const [minStock, setMinStock] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const profile = PROFILES[category];

  const chooseCategory = (next: ItemCategory) => {
    setCategory(next);
    setUnit(PROFILES[next].units[0]);
    setSize('');
    setErrors({});
  };

  const submit = async () => {
    setErrors({});
    const packageSize =
      profile.container !== null && size.trim() !== ''
        ? parseDecimal(size)
        : null;
    try {
      const item = await repo.createItem(
        {
          name,
          category,
          unit,
          caloriesPerUnit: profile.calories ? optionalNumber(kcal) : null,
          minStock: optionalNumber(minStock),
          caliber: profile.caliber ? caliber : null,
          packageSize,
        },
        {
          quantity: totalQuantity(
            count,
            packageSize,
            profile.container !== null,
          ),
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
    <Panel
      title={category === 'weapon' ? 'Nouvelles munitions' : 'Nouvel article'}
      accent={colors.primary}
    >
      <Text style={styles.fieldLabel}>Catégorie</Text>
      <View style={styles.wrap}>
        {ITEM_CATEGORIES.map(c => (
          <Chip
            key={c}
            label={CATEGORY_LABELS[c]}
            selected={category === c}
            onPress={() => chooseCategory(c)}
          />
        ))}
      </View>
      <Field
        label="Nom"
        value={name}
        onChangeText={setName}
        placeholder={profile.namePlaceholder}
        maxLength={120}
        error={errors.name}
      />
      {profile.caliber ? (
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
            hint="Elles s’affichent sur les armes du même calibre."
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
      {profile.units.length > 1 ? (
        <>
          <Text style={styles.fieldLabel}>Unité</Text>
          <View style={styles.wrap}>
            {profile.units.map(u => (
              <Chip
                key={u}
                label={UNIT_LABELS[u]}
                selected={unit === u}
                onPress={() => setUnit(u)}
              />
            ))}
          </View>
        </>
      ) : null}
      {errors.unit ? <Text style={styles.expired}>{errors.unit}</Text> : null}
      <QuantityFields
        category={category}
        unit={unit}
        knownSize={null}
        size={size}
        onSize={setSize}
        count={count}
        onCount={setCount}
        errors={errors}
      />
      {profile.calories ? (
        <Field
          label={`kcal par ${unit === 'unit' ? 'pièce' : UNIT_LABELS[unit]}`}
          value={kcal}
          onChangeText={setKcal}
          keyboardType="number-pad"
          placeholder="facultatif (indiqué sur l’emballage)"
          error={errors.caloriesPerUnit}
        />
      ) : null}
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
        placeholder={`ex. 2 (${unitLabel(category, unit)})`}
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
  total: { color: colors.primaryBright, fontSize: 15, fontWeight: '700' },
  summary: { color: colors.cyanSoft, fontSize: 15, fontWeight: '600' },
});
