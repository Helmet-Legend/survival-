/**
 * Scanner : lit des codes-barres (un article ou en série), les range dans
 * un panier conservé hors ligne, puis complète le stock. Un code déjà associé
 * à une fiche ajoute un lot (quantité et péremption à confirmer) ; un code
 * nouveau ouvre la fiche d'ajout habituelle, préremplie si Open Food Facts le
 * connaît. Le code-barres ne contient ni date ni lot : ils se saisissent ici.
 */
import { ScanBarcode, Trash2 } from 'lucide-react-native';
import React, { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import type { ItemSummary } from '../../inventory';
import { frToIso } from '../../lib/dates';
import { normalizeBarcode } from '../../scanner/barcode';
import {
  addScans,
  linkBarcode,
  listBasket,
  loadOnlineLookup,
  lookupPending,
  nameKey,
  prefillFor,
  removeFromBasket,
  saveOnlineLookup,
  setBasketCount,
  type BasketEntry,
} from '../../scanner/products';
import {
  Button,
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

  const { data, error, reload } = useLoader(async () => {
    const [online, basket, items] = await Promise.all([
      loadOnlineLookup(db),
      listBasket(db),
      repo.listItems(),
    ]);
    return { online, basket, items };
  });

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

  const scan = (series: boolean) =>
    run(async () => {
      const codes = await scanSource.scan(series);
      if (codes === null) {
        return null;
      }
      if (codes.length === 0) {
        return { tone: 'error', message: 'Aucun code-barres reconnu.' };
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
          label="Ajouter le code"
          disabled={busy || manual.trim() === ''}
          onPress={addManual}
        />
        <Text style={text.subtle}>
          La lecture se fait dans le téléphone, sans réseau. Scanner deux fois
          le même produit augmente sa quantité.
        </Text>
      </Panel>

      {feedback ? (
        <Notice tone={feedback.tone} message={feedback.message} />
      ) : null}

      {online === null && waiting > 0 ? (
        <Panel title="Reconnaître les produits en ligne ?">
          <Text style={text.body}>
            Fenrir peut chercher le nom, la contenance et les calories sur Open
            Food Facts, une base libre et collaborative.
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
  const [expiry, setExpiry] = useState('');
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
        await repo.addLot(linked.id, { quantity, expirationDate });
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
      ? 'Inconnu d’Open Food Facts : fiche à compléter.'
      : 'Fiche supprimée : à recréer.';
  const details = [
    d.brand,
    d.quantityLabel,
    d.kcalPer100g !== undefined ? `${d.kcalPer100g} kcal / 100 g` : undefined,
  ].filter(Boolean);
  const createForm = () => {
    const { category, prefill } = found
      ? prefillFor(product)
      : {
          category: 'food' as const,
          prefill: { notes: `Code-barres ${code}` },
        };
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
