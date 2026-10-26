/**
 * Scanner : lit des codes-barres (un article ou en série), les range dans
 * un panier conservé hors ligne, puis complète le stock. Un code déjà associé
 * à une fiche ajoute un lot (quantité et péremption à confirmer) ; un code
 * nouveau ouvre la fiche d'ajout habituelle, préremplie si Open Food Facts le
 * connaît. Le code-barres ne contient ni date ni lot : ils se saisissent ici.
 * En mode « Retirer », les codes lus retrouvent leur fiche et la quantité
 * confirmée est prise dans les lots qui périment le plus tôt.
 */
import { ScanBarcode, Trash2 } from 'lucide-react-native';
import React, { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import type { ItemSummary } from '../../inventory';
import { frToIso, isoToFr } from '../../lib/dates';
import { normalizeBarcode } from '../../scanner/barcode';
import {
  addScans,
  getProduct,
  linkBarcode,
  listBasket,
  loadOnlineLookup,
  lookupPending,
  nameKey,
  prefillFor,
  CATEGORY_CHOICES,
  defaultChoice,
  type CategoryChoice,
  removeFromBasket,
  saveOnlineLookup,
  setBasketCount,
  type BasketEntry,
} from '../../scanner/products';
import {
  Button,
  Chip,
  Field,
  IconButton,
  Notice,
  Panel,
  ScreenTitle,
  Stepper,
} from '../components/controls';
import { formatNumber } from '../format';
import { itemUnitLabel } from '../stockForms/details';
import { useNavigation } from '../navigation';
import { useSession } from '../session';
import { colors, radius, sizes, space, text } from '../theme';
import { useLoader } from '../useLoader';

interface Feedback {
  message: string;
  tone: 'ok' | 'error';
}

export function ScanScreen() {
  const { db, repo, scanSource, productFetch } = useSession();
  const navigation = useNavigation();
  const [manual, setManual] = useState('');
  const [manualError, setManualError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [offline, setOffline] = useState(false);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<'add' | 'remove'>('add');
  // Retraits scannés, à confirmer : code et nombre de lectures.
  const [withdrawals, setWithdrawals] = useState<Withdrawal[]>([]);

  const { data, error, reload } = useLoader(async () => {
    const [online, basket, items, links] = await Promise.all([
      loadOnlineLookup(db),
      listBasket(db),
      repo.listItems(),
      Promise.all(
        withdrawals.map(
          async w =>
            [w.code, (await getProduct(db, w.code))?.itemId ?? null] as const,
        ),
      ),
    ]);
    return { online, basket, items, links: new Map(links) };
  }, [withdrawals]);

  // Recherche en ligne des codes en attente, si elle est autorisée : à
  // l'ouverture, après un scan et sur demande (pas à chaque modification).
  const lookup = async () => {
    if ((await loadOnlineLookup(db)) === true) {
      setOffline((await lookupPending(db, productFetch)).offline);
    }
  };
  useEffect(() => {
    let alive = true;
    lookup()
      .then(() => (alive ? reload() : undefined))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const title = (
    <ScreenTitle
      title="Scanner"
      onBack={() => navigation.goTo('stock')}
      backLabel="Retour aux stocks"
    />
  );
  if (error) {
    return (
      <View style={styles.page}>
        {title}
        <Notice tone="error" message={error} />
      </View>
    );
  }
  if (data === null) {
    return <View style={styles.page}>{title}</View>;
  }
  const { online, basket, items } = data;
  const byId = new Map(items.map(i => [i.id, i]));
  const byName = new Map(items.map(i => [nameKey(i.name), i]));
  const waiting = basket.filter(
    e => e.product.status === 'pending' && e.product.itemId === null,
  ).length;

  const run = async (task: () => Promise<Feedback | null>) => {
    setBusy(true);
    try {
      const result = await task();
      if (result !== null) {
        setFeedback(result);
      }
      await reload();
    } catch (e) {
      setFeedback({
        tone: 'error',
        message: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setBusy(false);
    }
  };

  const queueWithdrawals = (codes: readonly string[]) =>
    setWithdrawals(current => {
      const next = current.map(w => ({ ...w }));
      for (const code of codes) {
        const found = next.find(w => w.code === code);
        if (found) {
          found.count = Math.min(999, found.count + 1);
        } else {
          next.push({ code, count: 1 });
        }
      }
      return next;
    });
  const dropWithdrawal = (code: string) =>
    setWithdrawals(current => current.filter(w => w.code !== code));

  const scan = (series: boolean) =>
    run(async () => {
      const reads = await scanSource.scan(series);
      if (reads === null) {
        return null;
      }
      // Étiquette d'une boîte de rangement, lue seule : on ouvre la boîte.
      const boxRead = reads.find(r => r.box !== undefined);
      if (boxRead?.box !== undefined && reads.length === 1) {
        navigation.goTo('stock', { category: 'boxes', boxId: boxRead.box });
        return null;
      }
      const codes = reads.filter(r => r.box === undefined);
      if (codes.length === 0 && boxRead !== undefined) {
        return {
          tone: 'error',
          message:
            'Étiquettes de boîtes ignorées en série : scannez une boîte seule pour l’ouvrir.',
        };
      }
      if (codes.length === 0) {
        return { tone: 'error', message: 'Aucun code-barres reconnu.' };
      }
      if (mode === 'remove') {
        queueWithdrawals(codes.map(r => r.code));
        return {
          tone: 'ok',
          message:
            codes.length === 1
              ? 'Code lu : confirmez le retrait ci-dessous.'
              : `${codes.length} lectures : confirmez les retraits ci-dessous.`,
        };
      }
      await addScans(db, codes);
      await lookup();
      return {
        tone: 'ok',
        message:
          codes.length === 1
            ? 'Code lu, ajouté au panier.'
            : `${codes.length} lectures ajoutées au panier.`,
      };
    });

  const addManual = () => {
    const code = normalizeBarcode(manual);
    if (code === null) {
      setManualError('Code EAN ou UPC invalide (8, 12 ou 13 chiffres).');
      return;
    }
    setManualError(null);
    setManual('');
    if (mode === 'remove') {
      queueWithdrawals([code]);
      return;
    }
    return run(async () => {
      await addScans(db, [code]);
      await lookup();
      return { tone: 'ok', message: 'Code ajouté au panier.' };
    });
  };

  return (
    <ScrollView
      contentContainerStyle={styles.page}
      keyboardShouldPersistTaps="handled"
    >
      {title}
      <Panel
        title="Lire un code-barres"
        right={<ScanBarcode color={colors.primary} size={20} />}
      >
        <View style={styles.chips}>
          <Chip
            label="Ajouter au stock"
            selected={mode === 'add'}
            onPress={() => setMode('add')}
          />
          <Chip
            label="Retirer du stock"
            selected={mode === 'remove'}
            onPress={() => setMode('remove')}
          />
        </View>
        {scanSource.available ? (
          <View style={styles.actions}>
            <Button
              variant="primary"
              icon={ScanBarcode}
              label="Scanner un article"
              disabled={busy}
              onPress={() => scan(false)}
            />
            <Button
              label="Scanner en série"
              accessibilityLabel="Scanner plusieurs articles à la suite"
              disabled={busy}
              onPress={() => scan(true)}
            />
            <Text style={text.muted}>
              Une étiquette de boîte ouvre directement son contenu.
            </Text>
          </View>
        ) : (
          <Text style={text.muted}>
            Lecteur indisponible sur cet appareil : saisissez le code imprimé
            sous les barres.
          </Text>
        )}
        <Field
          label="Code-barres"
          value={manual}
          onChangeText={setManual}
          keyboardType="number-pad"
          placeholder="Ex : 3017620422003"
          error={manualError}
        />
        <Button
          compact
          label={
            mode === 'add' ? 'Ajouter le code' : 'Retirer : valider le code'
          }
          disabled={busy || manual.trim() === ''}
          onPress={addManual}
        />
        <Text style={text.subtle}>
          {mode === 'add'
            ? 'La lecture se fait dans le téléphone, sans réseau. Scanner deux fois le même produit augmente sa quantité.'
            : 'Chaque lecture retire un article, pris dans le lot qui périme le plus tôt. Le retrait est confirmé avant d’être appliqué.'}
        </Text>
      </Panel>

      {feedback ? (
        <Notice tone={feedback.tone} message={feedback.message} />
      ) : null}

      {online === null && waiting > 0 ? (
        <Panel title="Reconnaître les produits en ligne ?">
          <Text style={text.body}>
            Fenrir peut chercher le nom, la contenance et les calories sur Open
            Food Facts, et les produits d’hygiène sur Open Beauty Facts : deux
            bases libres et collaboratives. Les médicaments sont reconnus sans
            réseau.
          </Text>
          <Text style={text.muted}>
            Seul le code-barres est envoyé, jamais votre stock. Sans réseau, les
            codes restent en attente et sont recherchés au retour de la
            connexion. Modifiable dans Réglages.
          </Text>
          <View style={styles.actions}>
            <Button
              variant="primary"
              label="Autoriser la recherche"
              onPress={() =>
                run(async () => {
                  await saveOnlineLookup(db, true);
                  await lookup();
                  return null;
                })
              }
            />
            <Button
              label="Rester hors ligne"
              onPress={() =>
                run(async () => {
                  await saveOnlineLookup(db, false);
                  return null;
                })
              }
            />
          </View>
        </Panel>
      ) : null}

      {online === true && offline && waiting > 0 ? (
        <View style={styles.offline}>
          <Text style={[text.body, styles.grow]}>
            Hors ligne : {waiting} code{waiting > 1 ? 's' : ''} en attente de
            recherche.
          </Text>
          <Button
            compact
            label="Réessayer"
            disabled={busy}
            onPress={() =>
              run(async () => {
                await lookup();
                return null;
              })
            }
          />
        </View>
      ) : null}

      {withdrawals.length > 0 ? (
        <>
          <Text style={text.label}>À retirer · {withdrawals.length}</Text>
          {withdrawals.map(w => {
            const itemId = data.links.get(w.code) ?? null;
            return (
              <WithdrawRow
                key={w.code}
                withdrawal={w}
                item={itemId === null ? undefined : byId.get(itemId)}
                busy={busy}
                run={run}
                onCount={count =>
                  count < 1
                    ? dropWithdrawal(w.code)
                    : setWithdrawals(current =>
                        current.map(x =>
                          x.code === w.code ? { ...x, count } : x,
                        ),
                      )
                }
                onDone={() => dropWithdrawal(w.code)}
              />
            );
          })}
        </>
      ) : null}

      <Text style={text.label}>
        Panier{basket.length > 0 ? ` · ${basket.length}` : ''}
      </Text>
      {basket.length === 0 ? (
        <Text style={text.muted}>
          Aucun article scanné. Les codes lus apparaissent ici jusqu’à leur
          ajout au stock, même sans réseau.
        </Text>
      ) : (
        basket.map(entry => {
          const linked =
            entry.product.itemId === null
              ? undefined
              : byId.get(entry.product.itemId);
          const match =
            linked === undefined && entry.product.data.name
              ? byName.get(nameKey(entry.product.data.name))
              : undefined;
          return (
            <BasketRow
              key={entry.code}
              entry={entry}
              online={online}
              linked={linked}
              match={match}
              busy={busy}
              run={run}
            />
          );
        })
      )}
    </ScrollView>
  );
}

interface Withdrawal {
  code: string;
  count: number;
}

function WithdrawRow(props: {
  withdrawal: Withdrawal;
  item: ItemSummary | undefined;
  busy: boolean;
  run: (task: () => Promise<Feedback | null>) => Promise<void>;
  onCount: (count: number) => void;
  onDone: () => void;
}) {
  const { repo } = useSession();
  const { withdrawal, item, run } = props;
  const { code, count } = withdrawal;
  const [amount, setAmount] = useState('');
  const [rowError, setRowError] = useState<string | null>(null);

  if (item === undefined) {
    return (
      <View style={styles.row}>
        <View style={styles.rowHead}>
          <View style={styles.grow}>
            <Text style={text.body}>Code {code}</Text>
            <Text style={text.subtle}>
              Inconnu de vos stocks : scannez-le d’abord en mode « Ajouter au
              stock » pour l’associer à une fiche.
            </Text>
          </View>
          <IconButton
            icon={Trash2}
            label={`Ne pas retirer ${code}`}
            color={colors.textMuted}
            onPress={props.onDone}
          />
        </View>
      </View>
    );
  }

  // Par lecture : une pièce, ou la contenance connue d'un contenant.
  const perRead =
    item.unit === 'unit'
      ? 1
      : item.packageSize !== null && item.packageSize > 0
      ? item.packageSize
      : null;
  const defaultAmount = perRead === null ? null : count * perRead;
  const unit = itemUnitLabel(item);
  const withdraw = () => {
    const typed = amount.trim().replace(',', '.');
    const quantity = typed === '' ? defaultAmount : Number(typed);
    if (quantity === null || !(quantity > 0)) {
      setRowError(`Indiquez la quantité retirée (${unit}).`);
      return;
    }
    setRowError(null);
    return run(async () => {
      try {
        const result = await repo.consume(item.id, quantity, {
          origin: 'scan',
        });
        props.onDone();
        return {
          tone: 'ok',
          message: `Retrait de « ${item.name} » : ${formatNumber(
            quantity,
          )} ${itemUnitLabel(item, quantity)}. Reste ${formatNumber(
            result.remaining,
          )}.`,
        };
      } catch (e) {
        setRowError(e instanceof Error ? e.message : String(e));
        return null;
      }
    });
  };

  return (
    <View style={[styles.row, styles.withdrawRow]}>
      <View style={styles.rowHead}>
        <View style={styles.grow}>
          <Text style={text.body}>{item.name}</Text>
          <Text style={text.subtle}>
            En stock : {formatNumber(item.usableQuantity)} {unit} · {code}
          </Text>
        </View>
        <IconButton
          icon={Trash2}
          label={`Ne pas retirer ${item.name}`}
          color={colors.textMuted}
          onPress={props.onDone}
        />
      </View>
      <View style={styles.rowHead}>
        <Text style={[text.muted, styles.grow]}>Articles scannés</Text>
        <Stepper
          value={`× ${count}`}
          onDecrease={() => props.onCount(count - 1)}
          onIncrease={() => props.onCount(count + 1)}
          canDecrease={!props.busy}
          canIncrease={!props.busy && count < 999}
          decreaseLabel={`Un de moins à retirer (${code})`}
          increaseLabel={`Un de plus à retirer (${code})`}
        />
      </View>
      <Field
        label={`Quantité retirée (${unit})`}
        value={amount}
        onChangeText={setAmount}
        keyboardType="decimal-pad"
        placeholder={
          defaultAmount === null ? 'À saisir' : formatNumber(defaultAmount)
        }
      />
      {rowError ? <Notice tone="error" message={rowError} /> : null}
      <Button
        variant="danger"
        compact
        label="Retirer du stock"
        accessibilityLabel={`Retirer du stock : ${item.name}`}
        disabled={props.busy}
        onPress={withdraw}
      />
    </View>
  );
}

function BasketRow(props: {
  entry: BasketEntry;
  online: boolean | null;
  linked: ItemSummary | undefined;
  match: ItemSummary | undefined;
  busy: boolean;
  run: (task: () => Promise<Feedback | null>) => Promise<void>;
}) {
  const { db, repo } = useSession();
  const navigation = useNavigation();
  const { entry, linked, match, run } = props;
  const { code, count, product } = entry;
  const [amount, setAmount] = useState('');
  // Péremption lue dans un Data Matrix : préremplie, modifiable.
  const [expiry, setExpiry] = useState(
    entry.expiry ? isoToFr(entry.expiry) : '',
  );
  const [choice, setChoice] = useState<CategoryChoice>(defaultChoice(product));
  const [rowError, setRowError] = useState<string | null>(null);

  const counter = (
    <Stepper
      value={`× ${count}`}
      onDecrease={() =>
        run(async () => {
          await setBasketCount(db, code, count - 1);
          return null;
        })
      }
      onIncrease={() =>
        run(async () => {
          await setBasketCount(db, code, count + 1);
          return null;
        })
      }
      canDecrease={!props.busy}
      canIncrease={!props.busy && count < 999}
      decreaseLabel={`Un de moins (${code})`}
      increaseLabel={`Un de plus (${code})`}
    />
  );
  const remove = (
    <IconButton
      icon={Trash2}
      label={`Retirer ${code} du panier`}
      color={colors.textMuted}
      onPress={() =>
        run(async () => {
          await removeFromBasket(db, code);
          return null;
        })
      }
    />
  );

  if (linked !== undefined) {
    // Quantité par défaut : le nombre d'articles, ou leur contenance connue.
    const defaultAmount =
      linked.unit === 'unit'
        ? count
        : linked.packageSize !== null
        ? count * linked.packageSize
        : null;
    const unit = itemUnitLabel(linked);
    const addToStock = () => {
      const typed = amount.trim().replace(',', '.');
      const quantity = typed === '' ? defaultAmount : Number(typed);
      if (quantity === null || !(quantity > 0)) {
        setRowError(`Indiquez la quantité ajoutée (${unit}).`);
        return;
      }
      const expirationDate = expiry.trim() === '' ? null : frToIso(expiry);
      if (expirationDate === null && expiry.trim() !== '') {
        setRowError('Date invalide (JJ/MM/AAAA)');
        return;
      }
      setRowError(null);
      return run(async () => {
        await repo.addLot(
          linked.id,
          { quantity, expirationDate },
          { origin: 'scan' },
        );
        await removeFromBasket(db, code);
        return {
          tone: 'ok',
          message: `Stock de « ${linked.name} » complété : +${formatNumber(
            quantity,
          )} ${itemUnitLabel(linked, quantity)}.`,
        };
      });
    };
    return (
      <View style={styles.row}>
        <View style={styles.rowHead}>
          <View style={styles.grow}>
            <Text style={text.body}>{linked.name}</Text>
            <Text style={text.subtle}>
              En stock : {formatNumber(linked.usableQuantity)} {unit} · {code}
            </Text>
          </View>
          {remove}
        </View>
        <View style={styles.rowHead}>
          <Text style={[text.muted, styles.grow]}>Articles scannés</Text>
          {counter}
        </View>
        <View style={styles.fields}>
          <View style={styles.grow}>
            <Field
              label={`Quantité (${unit})`}
              value={amount}
              onChangeText={setAmount}
              keyboardType="decimal-pad"
              placeholder={
                defaultAmount === null
                  ? 'À saisir'
                  : formatNumber(defaultAmount)
              }
            />
          </View>
          <View style={styles.grow}>
            <Field
              label="Péremption"
              value={expiry}
              onChangeText={setExpiry}
              keyboardType="number-pad"
              placeholder="JJ/MM/AAAA"
            />
          </View>
        </View>
        {rowError ? <Notice tone="error" message={rowError} /> : null}
        <Button
          variant="primary"
          compact
          label="Ajouter au stock"
          accessibilityLabel={`Ajouter au stock : ${linked.name}`}
          disabled={props.busy}
          onPress={addToStock}
        />
      </View>
    );
  }

  const d = product.data;
  const found = product.status === 'found';
  const status =
    product.status === 'pending'
      ? props.online === false
        ? 'Recherche en ligne désactivée : fiche à compléter.'
        : 'En attente de connexion pour la recherche.'
      : product.status === 'not_found'
      ? 'Inconnu des bases en ligne : fiche à compléter.'
      : 'Fiche supprimée : à recréer.';
  const details = [
    d.brand,
    d.quantityLabel,
    d.kcalPer100g !== undefined ? `${d.kcalPer100g} kcal / 100 g` : undefined,
  ].filter(Boolean);
  const createForm = () => {
    const { category, prefill } = prefillFor(
      found ? product : { ...product, data: {} },
      {
        choice,
        expiry: entry.expiry,
        lot: entry.lot,
      },
    );
    navigation.openStockForm({
      category,
      prefill:
        category === 'food' ? { ...prefill, quantity: String(count) } : prefill,
      barcode: code,
    });
  };
  return (
    <View style={styles.row}>
      <View style={styles.rowHead}>
        <View style={styles.grow}>
          <Text style={text.body}>
            {found && d.name ? d.name : `Code ${code}`}
          </Text>
          <Text style={text.subtle}>
            {found ? [...details, code].join(' · ') : status}
          </Text>
        </View>
        {remove}
      </View>
      <View style={styles.rowHead}>
        <Text style={[text.muted, styles.grow]}>Articles scannés</Text>
        {counter}
      </View>
      {match !== undefined ? (
        <Button
          compact
          label={`Associer à « ${match.name} »`}
          accessibilityLabel={`Déjà en stock : associer le code à « ${match.name} »`}
          disabled={props.busy}
          onPress={() =>
            run(async () => {
              await linkBarcode(db, code, match.id);
              return {
                tone: 'ok',
                message: `Code associé à « ${match.name} ».`,
              };
            })
          }
        />
      ) : null}
      {entry.expiry || entry.lot ? (
        <Text style={text.subtle}>
          Lu dans le code :{' '}
          {[
            entry.expiry ? `péremption ${isoToFr(entry.expiry)}` : null,
            entry.lot ? `lot ${entry.lot}` : null,
          ]
            .filter(Boolean)
            .join(', ')}
        </Text>
      ) : null}
      <Text style={text.label}>Ranger dans</Text>
      <View style={styles.chips}>
        {CATEGORY_CHOICES.map(c => (
          <Chip
            key={c.id}
            label={c.label}
            selected={choice === c.id}
            onPress={() => setChoice(c.id)}
          />
        ))}
      </View>
      <Button
        compact
        variant={match === undefined ? 'primary' : 'secondary'}
        label={
          found ? 'Créer la fiche préremplie' : 'Créer une fiche à compléter'
        }
        disabled={props.busy}
        onPress={createForm}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  page: {
    paddingHorizontal: sizes.screenPadding,
    paddingBottom: space.xl,
    gap: space.m,
  },
  actions: { gap: space.s },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.s },
  withdrawRow: { borderColor: colors.danger },
  row: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.card,
    padding: space.m,
    gap: space.s,
  },
  rowHead: { flexDirection: 'row', alignItems: 'center', gap: space.m },
  fields: { flexDirection: 'row', gap: space.s },
  offline: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.m,
    padding: space.m,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.warning,
  },
  grow: { flex: 1, minWidth: 0 },
});
