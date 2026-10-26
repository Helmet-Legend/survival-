/**
 * Stocks : catégories, recherche, état de chaque article, lots,
 * consommation, réglages et ajout. Le filtre « À surveiller » réunit les
 * lots périmés, bientôt périmés et sous le stock minimal.
 */
import {
  Backpack,
  Box as BoxIcon,
  ChevronDown,
  ChevronRight,
  FolderLock,
  History,
  Minus,
  MoreHorizontal,
  PackageOpen,
  Pencil,
  Plus,
  ScanBarcode,
  SearchX,
  Trash2,
} from 'lucide-react-native';
import React, { useRef, useState } from 'react';
import {
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SvgXml } from 'react-native-svg';

import {
  caloriesPerUnit,
  InventoryError,
  roundCount,
  type InventoryItem,
  type InventoryLot,
  type ItemCategory,
  type ItemSummary,
  type BagSummary,
  type DocumentSummary,
} from '../../inventory';
import { daysBetween, frToIso, localToday } from '../../lib/dates';
import {
  Button,
  Chip,
  EmptyState,
  Field,
  IconButton,
  IconTile,
  Notice,
  Panel,
  SearchField,
  SectionTitle,
  StatusChip,
} from '../components/controls';
import { MovementRow } from '../components/Movements';
import {
  CATEGORY_COLORS,
  CATEGORY_ICONS,
  CATEGORY_LABELS,
  CATEGORY_TITLES,
  formatDate,
  formatNumber,
  formatRelativeDays,
  parseDecimal,
  STOCK_ORDER,
  UNIT_LABELS,
} from '../format';
import { PhotoStrip } from '../components/PhotoStrip';
import { ExpiryIcon, QuantityIcon } from '../icons';
import { useNavigation } from '../navigation';
import { DateRow, MeasureRow } from '../stockForms/FormRows';
import {
  CATEGORY_ILLUSTRATIONS,
  ILLUSTRATION_FADE,
  ILLUSTRATION_FADE_SIDE,
} from '../stockForms/illustrations';
import { itemFacts, itemTypeLabel, itemUnitLabel } from '../stockForms/details';
import { useSession } from '../session';
import {
  colors,
  radius,
  sizes,
  space,
  text,
  tint,
  toneColor,
  type StatusTone,
} from '../theme';
import { PROFILES, packageSummary, unitLabel } from '../itemProfiles';
import { useLoader } from '../useLoader';
import { ScrollEndContext, useProgressive } from '../useProgressive';
import { ArmorySection } from './ArmorySection';
import { BAG_COLOR, BagHeader, BagsSection } from './BagsSection';
import { BOX_COLOR, BoxesSection } from './BoxesSection';
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
/** Gravité d'un état, pour trier « À surveiller » : le plus urgent d'abord. */
const STATE_RANK: Record<string, number> = {
  'Lot périmé': 0,
  'Bientôt périmé': 1,
  'Sous le minimum': 2,
};

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
      .reduce(
        (sum, i) =>
          sum +
          (roundCount(i.usableQuantity, i.packageSize, i.attributes) ?? 0),
        0,
      );
    return `${formatNumber(rounds, 0)} munition${rounds > 1 ? 's' : ''}`;
  }
  if (category === 'food') {
    const known = items
      .map(i => ({
        quantity: i.usableQuantity,
        kcal: caloriesPerUnit(i.unit, i.caloriesPerUnit, i.attributes),
      }))
      .filter(i => i.kcal !== null);
    if (known.length === 0) {
      return null;
    }
    const kcal = known.reduce((sum, i) => sum + i.quantity * (i.kcal ?? 0), 0);
    return `${formatNumber(kcal, 0)} kcal`;
  }
  return null;
}

function renewCount(docs: readonly DocumentSummary[]): number {
  return docs.filter(d => documentStatus(d) !== null).length;
}

/** Quantité retirée par le bouton « − » : un contenant, sinon une unité. */
function quickStep(item: ItemSummary): number {
  return item.packageSize !== null && item.packageSize > 0
    ? item.packageSize
    : 1;
}

/** Lots périmés ou à moins de 30 jours, tous sacs confondus. */
function bagAlerts(list: readonly BagSummary[]): number {
  return list.reduce((sum, b) => sum + b.expiredLots + b.soonLots, 0);
}

function boxCount(list: readonly { id: string }[]): string {
  return `${list.length} boîte${list.length > 1 ? 's' : ''}`;
}

function articles(count: number): string {
  return `${count} article${count > 1 ? 's' : ''}`;
}

/** Bandeau illustré en tête d'une catégorie : décoratif, le texte reste lisible. */
function CategoryBanner(props: { category: ItemCategory; detail: string }) {
  const color = CATEGORY_COLORS[props.category];
  return (
    <View
      accessible
      accessibilityRole="header"
      accessibilityLabel={`${CATEGORY_LABELS[props.category]} : ${
        props.detail
      }`}
      style={[styles.banner, { borderColor: tint(color, '55') }]}
    >
      <Image
        source={CATEGORY_ILLUSTRATIONS[props.category]}
        resizeMode="cover"
        accessibilityIgnoresInvertColors
        style={styles.bannerImage}
      />
      <SvgXml
        xml={ILLUSTRATION_FADE_SIDE}
        width="100%"
        height="100%"
        style={StyleSheet.absoluteFill}
      />
      <View style={styles.bannerText}>
        <Text style={[text.label, { color }]}>
          {CATEGORY_TITLES[props.category]}
        </Text>
        <Text style={styles.bannerDetail}>{props.detail}</Text>
      </View>
    </View>
  );
}

type StockFilter =
  | ItemCategory
  | 'all'
  | 'watch'
  | 'documents'
  | 'bags'
  | 'boxes';

/** Articles du stock général à surveiller (périmés, bientôt, sous le minimum). */
function watchCount(items: readonly ItemSummary[]): number {
  const today = localToday();
  return items.filter(i => itemState(i, today) !== null).length;
}

export function StockScreen() {
  const { repo, armory, documents, bags, boxes } = useSession();
  const navigation = useNavigation();
  const focus = navigation.stockFocus;
  const [filter, setFilter] = useState<StockFilter>(focus?.category ?? 'all');
  // Sac d'évacuation ouvert (dossier « Sacs »), sinon null.
  const [bagId, setBagId] = useState<string | null>(focus?.bagId ?? null);
  const [choosing, setChoosing] = useState(false);
  const isDocs = filter === 'documents';
  const isBoxes = filter === 'boxes';
  const isBags = filter === 'bags';
  const inBag = isBags && bagId !== null;
  const isWatch = filter === 'watch';
  const [menuOpen, setMenuOpen] = useState(false);
  const showFilter = (next: StockFilter) => {
    setFilter(next);
    setBagId(null);
  };
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(
    focus?.message ? { message: focus.message, tone: 'ok' } : null,
  );
  const addInto = (category: ItemCategory) => {
    setChoosing(false);
    navigation.openStockForm({
      category,
      recordType: category === 'weapon' ? 'ammo' : undefined,
      bagId: inBag ? bagId : undefined,
    });
  };

  const { data, error, reload } = useLoader(async () => {
    // Le contenu des sacs d'évacuation reste dans son dossier.
    const all = (await repo.listItems({ bag: 'none' })) as ItemSummary[];
    const today = localToday();
    const items =
      isDocs || isBoxes
        ? []
        : isWatch
        ? ((await repo.listItems({ query, bag: 'none' })) as ItemSummary[])
            .map(item => ({ item, state: itemState(item, today) }))
            .filter(x => x.state !== null)
            .sort(
              (a, b) =>
                STATE_RANK[a.state!.label] - STATE_RANK[b.state!.label] ||
                (a.item.nextExpiration ?? '9999').localeCompare(
                  b.item.nextExpiration ?? '9999',
                ),
            )
            .map(x => x.item)
        : isBags
        ? bagId === null
          ? []
          : ((await repo.listItems({ bag: bagId, query })) as ItemSummary[])
        : ((await repo.listItems({
            category: filter === 'all' || isWatch ? undefined : filter,
            query,
            bag: 'none',
          })) as ItemSummary[]);
    const detail =
      expanded === null ? null : await repo.getItem(expanded).catch(() => null);
    const weapons = await armory.listWeapons();
    const docs = await documents.list();
    const bagList = await bags.list();
    const boxList = await boxes.list();
    return {
      weapons,
      docs,
      bags: bagList,
      boxes: boxList,
      bag: bagList.find(b => b.id === bagId) ?? null,
      all,
      items,
      detail,
      hasExpired: (inBag ? items : all).some(
        i => i.totalQuantity > i.usableQuantity,
      ),
    };
  }, [filter, bagId, expanded, query]);

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

  // Consommer en un geste : un contenant (bidon, boîte) ou une unité, pris
  // dans le lot qui périme le plus tôt.
  const quickConsume = async (item: ItemSummary) => {
    try {
      const step = quickStep(item);
      const result = await repo.consume(item.id, step);
      setFeedback({
        message: `${item.name} : ${formatNumber(step)} ${itemUnitLabel(
          item,
        )} retiré${step > 1 ? 's' : ''}. Reste ${formatNumber(
          result.remaining,
        )}.`,
        tone: 'ok',
      });
    } catch (e) {
      setFeedback({ message: errorMessage(e), tone: 'error' });
    }
    await reload();
  };

  const today = localToday();
  const showCategories = filter === 'all' && query.trim() === '';
  // Lignes dessinées au fil du défilement ; remis à zéro à chaque liste.

  const rowActions = useRef<RowActions>(null as unknown as RowActions);
  rowActions.current = {
    toggle: id => {
      setExpanded(current => (current === id ? null : id));
      setFeedback(null);
    },
    consume: quickConsume,
    collapse: () => setExpanded(null),
    changed: async message => {
      setFeedback(message);
      await reload();
    },
  };
  const [scrollTick, setScrollTick] = useState(0);
  const progressive = useProgressive(
    data?.items.length ?? 0,
    [filter, bagId, query].join('|'),
    scrollTick,
  );
  const lastHeight = useRef(0);

  // Sans arme ni article d'armement, pas de carte « 0 munition » dans la vue
  // d'ensemble ; la puce Armement reste pour en enregistrer une.
  const visibleCategories = STOCK_ORDER.filter(
    c =>
      c !== 'weapon' ||
      data === null ||
      data.weapons.length > 0 ||
      data.all.some(i => i.category === 'weapon'),
  );

  return (
    <ScrollEndContext.Provider value={scrollTick}>
      <ScrollView
        contentContainerStyle={styles.page}
        keyboardShouldPersistTaps="handled"
        testID="stock-scroll"
        scrollEventThrottle={100}
        onScroll={({ nativeEvent: e }) => {
          // Bas de page proche : la liste affichée s'allonge (une fois par
          // hauteur de contenu).
          const height = e.contentSize.height;
          if (
            e.layoutMeasurement.height + e.contentOffset.y >= height - 800 &&
            height !== lastHeight.current
          ) {
            lastHeight.current = height;
            setScrollTick(t => t + 1);
          }
        }}
      >
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chips}
        >
          <Chip
            label="Tous"
            selected={filter === 'all'}
            onPress={() => showFilter('all')}
          />
          <Chip
            label={
              data && watchCount(data.all) > 0
                ? `À surveiller · ${watchCount(data.all)}`
                : 'À surveiller'
            }
            selected={isWatch}
            onPress={() => showFilter('watch')}
          />
          {STOCK_ORDER.map(c => (
            <Chip
              key={c}
              label={CATEGORY_LABELS[c]}
              selected={filter === c}
              onPress={() => showFilter(c)}
            />
          ))}
          <Chip
            label="Sacs"
            selected={isBags}
            onPress={() => showFilter('bags')}
          />
          <Chip
            label="Boîtes"
            selected={isBoxes}
            onPress={() => showFilter('boxes')}
          />
          <Chip
            label="Documents"
            selected={isDocs}
            onPress={() => showFilter('documents')}
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

        {isBags && !inBag && data ? (
          <>
            {feedback ? <Notice {...feedback} /> : null}
            {error ? <Notice tone="error" message={error} /> : null}
            <BagsSection
              bags={data.bags}
              onOpen={id => {
                setExpanded(null);
                setBagId(id);
              }}
              onChanged={async message => {
                setFeedback(message);
                await reload();
              }}
            />
          </>
        ) : null}

        {inBag && data?.bag ? (
          <BagHeader
            bag={data.bag}
            onBack={() => {
              setFeedback(null);
              setBagId(null);
            }}
            onChanged={async message => {
              setFeedback(message);
              await reload();
            }}
            onDeleted={async message => {
              setFeedback(message);
              setBagId(null);
              await reload();
            }}
          />
        ) : null}

        {isBoxes ? <BoxesSection /> : null}

        {isDocs || isBoxes || (isBags && !inBag) ? null : (
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
                variant="primary"
                icon={Plus}
                label={
                  filter === 'all' || isWatch ? 'Ajouter un article' : 'Ajouter'
                }
                style={styles.grow}
                accessibilityLabel={
                  filter === 'all' || isWatch
                    ? '+ Ajouter un article'
                    : filter === 'bags'
                    ? '+ Ajouter dans le sac'
                    : `+ Ajouter : ${CATEGORY_TITLES[filter]}`
                }
                onPress={() => {
                  setFeedback(null);
                  if (filter === 'all' || filter === 'bags' || isWatch) {
                    setChoosing(true);
                  } else {
                    addInto(filter);
                  }
                }}
              />
              {inBag ? null : (
                <Button
                  compact
                  icon={ScanBarcode}
                  label="Scanner"
                  accessibilityLabel="Scanner des codes-barres"
                  onPress={() => navigation.open('scan')}
                />
              )}
              <IconButton
                icon={MoreHorizontal}
                label="Plus d’actions"
                color={menuOpen ? colors.primary : colors.text}
                onPress={() => setMenuOpen(!menuOpen)}
              />
            </View>
            {menuOpen ? (
              <View style={styles.menu}>
                {inBag ? null : (
                  <Button
                    variant="ghost"
                    icon={History}
                    label="Historique des mouvements"
                    onPress={() => {
                      setMenuOpen(false);
                      navigation.open('history');
                    }}
                  />
                )}
                <Button
                  variant="danger"
                  icon={Trash2}
                  label="Jeter les périmés"
                  disabled={!data?.hasExpired}
                  onPress={() => {
                    setMenuOpen(false);
                    setConfirmDiscard(true);
                  }}
                />
              </View>
            ) : null}

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

            <CategoryChooser
              open={choosing}
              onClose={() => setChoosing(false)}
              onPick={addInto}
            />

            {showCategories && data
              ? visibleCategories.map(c => {
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
                accessibilityLabel={`Sacs d’évacuation : ${
                  data.bags.length
                } sac${data.bags.length > 1 ? 's' : ''}${
                  bagAlerts(data.bags) > 0
                    ? `, ${bagAlerts(data.bags)} à vérifier`
                    : ''
                }`}
                onPress={() => showFilter('bags')}
                style={({ pressed }) => [
                  styles.category,
                  pressed && styles.pressed,
                ]}
              >
                <IconTile icon={Backpack} color={BAG_COLOR} />
                <View style={styles.grow}>
                  <Text style={text.h3}>Sacs d’évacuation</Text>
                  <Text style={text.muted}>
                    {data.bags.length} sac{data.bags.length > 1 ? 's' : ''}
                    {bagAlerts(data.bags) > 0 ? (
                      <Text style={styles.warn}>
                        {' '}
                        · {bagAlerts(data.bags)} à vérifier
                      </Text>
                    ) : null}
                  </Text>
                </View>
                <ChevronRight color={colors.text} size={22} />
              </Pressable>
            ) : null}

            {showCategories && data ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Boîtes : ${boxCount(data.boxes)}`}
                onPress={() => showFilter('boxes')}
                style={({ pressed }) => [
                  styles.category,
                  pressed && styles.pressed,
                ]}
              >
                <IconTile icon={BoxIcon} color={BOX_COLOR} />
                <View style={styles.grow}>
                  <Text style={text.h3}>Boîtes</Text>
                  <Text style={text.muted}>{boxCount(data.boxes)}</Text>
                </View>
                <ChevronRight color={colors.text} size={22} />
              </Pressable>
            ) : null}

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
                onPress={() => showFilter('documents')}
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

            {data &&
            filter !== 'all' &&
            filter !== 'watch' &&
            filter !== 'bags' ? (
              <CategoryBanner
                category={filter}
                detail={[
                  categoryAmount(
                    filter,
                    data.all.filter(i => i.category === filter),
                  ),
                  articles(data.all.filter(i => i.category === filter).length),
                ]
                  .filter(Boolean)
                  .join(' · ')}
              />
            ) : null}

            {filter === 'weapon' && query.trim() === '' && data ? (
              <>
                <ArmorySection
                  weapons={data.weapons}
                  ammo={data.items}
                  onOpenItem={id => {
                    setFeedback(null);
                    setExpanded(id);
                  }}
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
                    : inBag
                    ? 'Ce sac est vide.'
                    : isWatch
                    ? 'Rien à surveiller : aucun lot périmé, bientôt périmé ou sous le minimum.'
                    : 'Aucun article dans cette catégorie.'
                }
                message={
                  query
                    ? 'Vérifiez l’orthographe ou changez de catégorie.'
                    : undefined
                }
              />
            ) : null}

            {!showCategories && data ? (
              <>
                {data.items.slice(0, progressive.visible).map(item => (
                  <ItemRow
                    key={item.id}
                    item={item}
                    open={expanded === item.id}
                    detail={expanded === item.id ? data.detail : null}
                    today={today}
                    actions={rowActions}
                  />
                ))}
                {progressive.rest > 0 ? (
                  <Button
                    variant="ghost"
                    label={`Afficher la suite (${progressive.rest})`}
                    onPress={progressive.more}
                  />
                ) : null}
              </>
            ) : null}
          </>
        )}
      </ScrollView>
    </ScrollEndContext.Provider>
  );
}

/** Choix de la catégorie avant d'ouvrir sa fiche (depuis « Tous »). */
function CategoryChooser(props: {
  open: boolean;
  onClose: () => void;
  onPick: (category: ItemCategory) => void;
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
        accessibilityLabel="Fermer"
        style={styles.backdrop}
        onPress={props.onClose}
      />
      <View style={styles.sheet}>
        <Text accessibilityRole="header" style={text.h3}>
          Que voulez-vous ajouter ?
        </Text>
        <View style={styles.tiles}>
          {STOCK_ORDER.map(c => {
            const Icon = CATEGORY_ICONS[c];
            const color = CATEGORY_COLORS[c];
            return (
              <Pressable
                key={c}
                accessibilityRole="button"
                accessibilityLabel={`Ajouter : ${CATEGORY_TITLES[c]}`}
                onPress={() => props.onPick(c)}
                style={({ pressed }) => [
                  styles.tile,
                  { borderColor: tint(color, '66') },
                  pressed && styles.pressed,
                ]}
              >
                <Image
                  source={CATEGORY_ILLUSTRATIONS[c]}
                  resizeMode="cover"
                  accessibilityIgnoresInvertColors
                  style={styles.tileImage}
                />
                <SvgXml
                  xml={ILLUSTRATION_FADE}
                  width="100%"
                  height="100%"
                  style={StyleSheet.absoluteFill}
                />
                <View
                  style={[
                    styles.tileBadge,
                    {
                      borderColor: color,
                      backgroundColor: tint(colors.bg, 'd9'),
                    },
                  ]}
                >
                  <Icon color={color} size={22} strokeWidth={2} />
                </View>
                <Text style={styles.tileText}>{CATEGORY_TITLES[c]}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>
    </Modal>
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

/** Derniers mouvements d'un article, rafraîchis à chaque changement de lots. */
function ItemMovements(props: { itemId: string; lots: InventoryLot[] }) {
  const { repo } = useSession();
  const navigation = useNavigation();
  const { data } = useLoader(
    () => repo.listMovements({ itemId: props.itemId, limit: 5 }),
    [props.itemId, props.lots],
  );
  if (data === null || data.length === 0) {
    return null;
  }
  return (
    <View style={styles.movements}>
      <Text style={text.label}>Derniers mouvements</Text>
      {data.map(m => (
        <MovementRow key={m.id} movement={m} showDate />
      ))}
      <Button
        compact
        variant="ghost"
        label="Tout l’historique"
        onPress={() => navigation.open('history')}
      />
    </View>
  );
}

/** Ce dont une ligne d'article a besoin de l'écran, sans la redessiner. */
interface RowActions {
  toggle(id: string): void;
  consume(item: ItemSummary): Promise<void>;
  collapse(): void;
  changed(message: Feedback): Promise<void>;
}

type ItemDetailData = { item: InventoryItem; lots: InventoryLot[] };

/** Clé d'une ligne : elle ne se redessine que si l'article a changé. */
function rowKey(item: ItemSummary): string {
  return [
    item.id,
    item.updatedAt,
    item.totalQuantity,
    item.usableQuantity,
    item.lotCount,
    item.nextExpiration,
  ].join('|');
}

/** Une ligne de la liste des articles, dépliable. */
const ItemRow = React.memo(
  function ItemRow(props: {
    item: ItemSummary;
    open: boolean;
    detail: ItemDetailData | null;
    today: string;
    actions: React.MutableRefObject<RowActions>;
  }) {
    const { item, open, today } = props;
    const state = itemState(item, today);
    const stripe = state ? toneColor[state.tone] : colors.border;
    const Chevron = open ? ChevronDown : ChevronRight;
    return (
      <View key={item.id} style={[styles.item, open && styles.itemOpen]}>
        <View style={[styles.stripe, { backgroundColor: stripe }]} />
        <View style={styles.itemBody}>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded: open }}
            accessibilityLabel={`${item.name}, ${formatNumber(
              item.usableQuantity,
            )} ${itemUnitLabel(item)}`}
            onPress={() => props.actions.current.toggle(item.id)}
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
                {itemTypeLabel(item) ?? CATEGORY_LABELS[item.category]}
                {item.caliber ? ` · ${item.caliber}` : ''}
                {packageSummary(item, item.usableQuantity)
                  ? ` · ${packageSummary(item, item.usableQuantity)}`
                  : ''}
                {item.location && item.category !== 'weapon'
                  ? ` · ${item.location}`
                  : ''}
              </Text>
            </View>
            <View style={styles.itemSide}>
              <Text style={styles.qty}>
                {formatNumber(item.usableQuantity)}{' '}
                <Text style={styles.qtyUnit}>{itemUnitLabel(item)}</Text>
              </Text>
              {state ? (
                <StatusChip tone={state.tone} label={state.label} />
              ) : item.nextExpiration ? (
                <Text style={text.subtle}>
                  {formatRelativeDays(daysBetween(today, item.nextExpiration))}
                </Text>
              ) : null}
            </View>
            {item.usableQuantity >= quickStep(item) ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Retirer ${formatNumber(
                  quickStep(item),
                )} ${itemUnitLabel(item)} de ${item.name}`}
                hitSlop={6}
                onPress={() => {
                  void props.actions.current.consume(item);
                }}
                style={({ pressed }) => [
                  styles.quick,
                  pressed && styles.pressed,
                ]}
              >
                <Minus color={colors.text} size={18} />
              </Pressable>
            ) : null}
            <Chevron color={colors.textMuted} size={20} />
          </Pressable>
          {open && props.detail ? (
            <ItemDetail
              item={props.detail.item}
              lots={props.detail.lots}
              onDeleted={() => props.actions.current.collapse()}
              onChanged={message => props.actions.current.changed(message)}
            />
          ) : null}
        </View>
      </View>
    );
  },
  (a, b) =>
    a.open === b.open &&
    a.detail === b.detail &&
    a.today === b.today &&
    rowKey(a.item) === rowKey(b.item),
);

function ItemDetail(props: {
  item: InventoryItem;
  lots: InventoryLot[];
  onChanged: (feedback: Feedback) => Promise<void>;
  /** L'article n'existe plus : refermer sa fiche. */
  onDeleted: () => void;
}) {
  const { repo } = useSession();
  const { item } = props;
  const profile = PROFILES[item.category];
  // Contenants « à l'ancienne » (quantité en L ou en cartouches) : les fiches
  // récentes comptent directement leurs boîtes, paquets… (`countUnit`).
  const container =
    item.attributes.countUnit === undefined ? profile.container : null;
  const [quantity, setQuantity] = useState('');
  const [addCount, setAddCount] = useState('');
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
  const unit = itemUnitLabel(item);
  const usable = props.lots
    .filter(l => !l.isExpired)
    .reduce((sum, l) => sum + l.quantity, 0);
  const summary = packageSummary(item, usable);
  const facts = itemFacts(item);
  const color = CATEGORY_COLORS[item.category];
  // Bidons, boîtes… de contenance connue : on compte les contenants.
  const packaged = container !== null && item.packageSize !== null;
  const addTotal =
    addCount.trim() === ''
      ? 0
      : totalQuantity(addCount, item.packageSize, container !== null);
  const navigation = useNavigation();

  const [confirm, setConfirm] = useState<
    { kind: 'item' } | { kind: 'lot'; lotId: string } | null
  >(null);

  const removeItem = async () => {
    setConfirm(null);
    try {
      await repo.deleteItem(item.id);
      props.onDeleted();
      await props.onChanged({
        message: `« ${item.name} » supprimé.`,
        tone: 'ok',
      });
    } catch (e) {
      await props.onChanged({ message: errorMessage(e), tone: 'error' });
    }
  };

  const removeLot = async (lotId: string, label: string) => {
    setConfirm(null);
    try {
      await repo.deleteLot(lotId);
      await props.onChanged({
        message: `Lot supprimé : ${label}.`,
        tone: 'ok',
      });
    } catch (e) {
      await props.onChanged({ message: errorMessage(e), tone: 'error' });
    }
  };

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
    const expirationDate =
      addExpiration.trim() === '' ? null : frToIso(addExpiration);
    if (expirationDate === null && addExpiration.trim() !== '') {
      setErrors({ addExpiration: 'Date invalide (JJ/MM/AAAA)' });
      return;
    }
    try {
      await repo.addLot(item.id, {
        quantity: addTotal,
        expirationDate,
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
      {facts.map(([label, value]) => (
        <View key={label} style={styles.fact}>
          <Text style={text.subtle}>{label}</Text>
          <Text selectable style={[text.body, styles.factValue]}>
            {value}
          </Text>
        </View>
      ))}
      <ItemMovements itemId={item.id} lots={props.lots} />
      <Button
        compact
        icon={Pencil}
        label="Modifier la fiche"
        onPress={() =>
          navigation.openStockForm({ category: item.category, itemId: item.id })
        }
      />
      <Button
        compact
        variant="danger"
        icon={Trash2}
        label="Supprimer l’article"
        accessibilityLabel={`Supprimer « ${item.name} »`}
        onPress={() => setConfirm({ kind: 'item' })}
      />
      {confirm?.kind === 'item' ? (
        <Panel accent={colors.danger} style={styles.dialog}>
          <Text style={text.body}>
            Supprimer « {item.name} » et tout son stock
            {props.lots.length > 0
              ? ` (${props.lots.length} lot${props.lots.length > 1 ? 's' : ''})`
              : ''}{' '}
            ? Cette action est définitive.
          </Text>
          <View style={styles.wrap}>
            <Button
              variant="danger"
              label="Oui, supprimer"
              onPress={() => {
                void removeItem();
              }}
            />
            <Button
              variant="ghost"
              label="Annuler"
              onPress={() => setConfirm(null)}
            />
          </View>
        </Panel>
      ) : null}
      <PhotoStrip owner="item" ownerId={item.id} label={item.name} />

      <Text style={text.label}>Lots, du premier au dernier consommé</Text>
      {props.lots.length === 0 ? (
        <Text style={text.muted}>Aucun lot.</Text>
      ) : null}
      {props.lots.map(lot => {
        const label = `${formatNumber(lot.quantity)} ${unit}, ${
          lot.expirationDate
            ? `${lot.isExpired ? 'périmé le' : 'jusqu’au'} ${formatDate(
                lot.expirationDate,
              )}`
            : 'non périssable'
        }`;
        return (
          <View key={lot.id}>
            <View style={styles.lot}>
              <Text style={[text.mono, lot.isExpired && styles.expired]}>
                {formatNumber(lot.quantity)} {unit}
              </Text>
              <Text
                style={[
                  text.muted,
                  styles.grow,
                  styles.lotDate,
                  lot.isExpired && styles.expired,
                ]}
              >
                {lot.expirationDate
                  ? `${lot.isExpired ? 'périmé le' : 'jusqu’au'} ${formatDate(
                      lot.expirationDate,
                    )}`
                  : 'non périssable'}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Supprimer le lot ${label}`}
                hitSlop={8}
                onPress={() => setConfirm({ kind: 'lot', lotId: lot.id })}
                style={({ pressed }) => [
                  styles.lotDelete,
                  pressed && styles.pressed,
                ]}
              >
                <Trash2 color={colors.danger} size={18} />
              </Pressable>
            </View>
            {confirm?.kind === 'lot' && confirm.lotId === lot.id ? (
              <View style={styles.row}>
                <Button
                  compact
                  variant="danger"
                  label="Supprimer ce lot"
                  onPress={() => {
                    void removeLot(lot.id, label);
                  }}
                />
                <Button
                  compact
                  variant="ghost"
                  label="Annuler"
                  onPress={() => setConfirm(null)}
                />
              </View>
            ) : null}
          </View>
        );
      })}

      <View style={[styles.panel, { borderColor: tint(color, '55') }]}>
        <Text style={[text.label, { color }]}>Ajouter du stock</Text>
        <MeasureRow
          icon={QuantityIcon}
          color={color}
          label={
            packaged ? `Nombre de ${container.many}` : 'Quantité à ajouter'
          }
          value={addCount}
          onChange={setAddCount}
          unit="u"
          units={[{ value: 'u', label: packaged ? container.many : unit }]}
          onUnit={() => undefined}
          stepper
          error={errors.quantity}
        />
        {packaged && addTotal > 0 ? (
          <Text style={styles.total}>
            = {formatNumber(addTotal)} {unit}
          </Text>
        ) : null}
        {profile.expiryLabel !== null ? (
          <DateRow
            icon={ExpiryIcon}
            color={color}
            label="Péremption de ce lot (facultatif)"
            value={addExpiration}
            onChange={setAddExpiration}
            error={errors.addExpiration}
          />
        ) : null}
        <Button
          variant="primary"
          icon={Plus}
          label={
            addTotal > 0
              ? `Ajouter ${formatNumber(addTotal)} ${itemUnitLabel(
                  item,
                  addTotal,
                )}`
              : 'Ajouter au stock'
          }
          accessibilityLabel="Ajouter au stock existant"
          disabled={!(addTotal > 0)}
          onPress={() => {
            void addStock();
          }}
        />
      </View>

      <View style={styles.panel}>
        <Text style={text.label}>Retirer (consommation)</Text>
        {packaged ? (
          <Button
            compact
            icon={Minus}
            label={`Retirer 1 ${container.one} (${formatNumber(
              item.packageSize ?? 0,
            )} ${unitLabel(
              item.category,
              item.unit,
              item.packageSize ?? undefined,
            )})`}
            disabled={usable < (item.packageSize ?? 0)}
            onPress={() => {
              void consume(item.packageSize ?? 0);
            }}
          />
        ) : null}
        <MeasureRow
          icon={QuantityIcon}
          color={colors.textMuted}
          label={`Quantité à retirer (${UNIT_LABELS[item.unit]})`}
          value={quantity}
          onChange={setQuantity}
          unit="u"
          units={[{ value: 'u', label: unit }]}
          onUnit={() => undefined}
          stepper
        />
        <Button
          label={
            quantity.trim() === ''
              ? 'Retirer'
              : `Retirer ${quantity.trim()} ${unit}`
          }
          accessibilityLabel="Retirer"
          disabled={quantity.trim() === ''}
          onPress={() => {
            void consume(parseDecimal(quantity));
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

const styles = StyleSheet.create({
  movements: { gap: space.xs },
  page: {
    paddingHorizontal: sizes.screenPadding,
    paddingBottom: space.xl,
    gap: space.m,
  },
  chips: { flexDirection: 'row', gap: space.s },
  row: { flexDirection: 'row', gap: space.s },
  menu: {
    gap: space.xs,
    padding: space.s,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.borderActive,
    backgroundColor: colors.overlay,
  },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: space.s },
  inline: { flexDirection: 'row', alignItems: 'flex-end', gap: space.s },
  lotDate: { textAlign: 'right' },
  lotDelete: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  panel: {
    gap: space.m,
    padding: space.m,
    marginTop: space.s,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bg,
  },
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
  quick: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.borderActive,
    alignItems: 'center',
    justifyContent: 'center',
  },
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
  lot: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: space.m,
  },
  expired: { color: colors.danger },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)' },
  sheet: {
    backgroundColor: colors.bgElevated,
    borderTopLeftRadius: radius.panel,
    borderTopRightRadius: radius.panel,
    borderWidth: 1,
    borderColor: colors.border,
    padding: space.l,
    paddingBottom: space.xxl,
    gap: space.m,
  },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: space.s },
  tile: {
    width: '48%',
    flexGrow: 1,
    minHeight: 112,
    justifyContent: 'flex-end',
    gap: space.xs,
    padding: space.m,
    borderRadius: 12,
    borderWidth: 1,
    overflow: 'hidden',
    backgroundColor: colors.surface,
  },
  banner: {
    height: 104,
    borderRadius: radius.card,
    borderWidth: 1,
    overflow: 'hidden',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  bannerImage: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: '100%',
    height: '100%',
  },
  bannerText: { paddingHorizontal: space.l, gap: space.xs, maxWidth: '70%' },
  bannerDetail: { color: colors.text, fontSize: 16, fontWeight: '700' },
  tileImage: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: '100%',
    height: '100%',
  },
  tileBadge: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tileText: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '700',
  },
  fieldLabel: { color: colors.textMuted, fontSize: 14 },
  total: { color: colors.primaryBright, fontSize: 15, fontWeight: '700' },
  summary: { color: colors.cyanSoft, fontSize: 15, fontWeight: '600' },
  fact: { flexDirection: 'row', gap: space.m, alignItems: 'baseline' },
  factValue: { flex: 1, minWidth: 0, textAlign: 'right' },
});
