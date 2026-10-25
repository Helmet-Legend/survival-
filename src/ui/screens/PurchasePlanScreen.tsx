/**
 * Plan d'achats échelonné : ce qui manque à la préparation, réparti mois par
 * mois, l'essentiel d'abord. Chaque achat se coche et peut recevoir son prix ;
 * un budget mensuel reporte ce qui dépasse. La mise à jour d'après le stock
 * garde les coches. Un rappel neutre peut être programmé le 1er de chaque
 * mois.
 */
import { CheckCircle2, Circle, ShoppingCart } from 'lucide-react-native';
import React, { useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';

import { localToday } from '../../lib/dates';
import {
  addMonths,
  createPurchasePlan,
  currentMonthIndex,
  loadPurchasePlan,
  monthLabel,
  PLAN_MONTHS,
  PLAN_MONTHS_DEFAULT,
  monthTotal,
  savePurchasePlan,
  setPurchaseBudget,
  setPurchaseDone,
  setPurchasePrice,
  updatePurchasePlan,
  type PurchaseEntry,
} from '../../plan/purchasePlan';
import {
  loadRemindersEnabled,
  saveRemindersEnabled,
  syncReminders,
} from '../../resilience/reminders';
import {
  Button,
  Chip,
  Field,
  Notice,
  Panel,
  ScreenTitle,
} from '../components/controls';
import { formatEuros, formatNumber, parseDecimal } from '../format';
import { useNavigation } from '../navigation';
import { useSession } from '../session';
import { colors, radius, sizes, space, text } from '../theme';
import { useLoader } from '../useLoader';

/** Montant saisi en euros, null si vide ; NaN si invalide. */
function parseEuros(input: string): number | null {
  if (input.trim() === '') {
    return null;
  }
  const value = parseDecimal(input.replace('€', ''));
  return value >= 0 && value <= 100000 ? value : NaN;
}

export function PurchasePlanScreen() {
  const { db, repo, armory, bags, documents, reminders } = useSession();
  const navigation = useNavigation();
  const [months, setMonths] = useState<number>(PLAN_MONTHS_DEFAULT);
  const [feedback, setFeedback] = useState<{
    message: string;
    tone: 'ok' | 'error';
  } | null>(null);
  const { data, error, reload } = useLoader(async () => ({
    plan: await loadPurchasePlan(db),
    remindersOn: await loadRemindersEnabled(db),
  }));

  const [budgetText, setBudgetText] = useState<string | null>(null);

  const stockInput = async () => {
    const [items, allItems, bagList, docs, weapons] = await Promise.all([
      repo.listItems({ bag: 'none' }),
      repo.listItems(),
      bags.list(),
      documents.list(),
      armory.listWeapons(),
    ]);
    return {
      items,
      bags: bagList,
      documentCount: docs.length,
      asOf: localToday(),
      // Matériel de base « À prévoir », vérifié comme dans Kit et matériel.
      gear: {
        items: allItems,
        bagNames: bagList.map(b => b.name),
        weaponCount: weapons.length,
      },
    };
  };

  const update = async () => {
    try {
      const plan = await updatePurchasePlan(db, await stockInput());
      await syncReminders(db, reminders);
      const left = plan.entries.filter(e => !e.done).length;
      setFeedback({
        tone: 'ok',
        message:
          left === 0
            ? 'Plan à jour : plus rien à acheter.'
            : `Plan à jour : ${left} achat${left > 1 ? 's' : ''} restant${
                left > 1 ? 's' : ''
              }, coches gardées.`,
      });
      await reload();
    } catch (e) {
      setFeedback({
        tone: 'error',
        message: e instanceof Error ? e.message : String(e),
      });
    }
  };

  const saveBudget = async (input: string) => {
    const budget = parseEuros(input);
    if (Number.isNaN(budget) || budget === 0) {
      setFeedback({
        tone: 'error',
        message: 'Budget : saisissez un montant en euros, par exemple 50.',
      });
      return;
    }
    await setPurchaseBudget(db, budget, localToday());
    await syncReminders(db, reminders);
    setBudgetText(null);
    setFeedback({
      tone: 'ok',
      message:
        budget === null
          ? 'Budget retiré.'
          : `Budget de ${formatEuros(
              budget,
            )} par mois : les achats chiffrés sont répartis pour le respecter.`,
    });
    await reload();
  };

  const savePrice = async (entry: PurchaseEntry, input: string) => {
    const price = parseEuros(input);
    if (Number.isNaN(price)) {
      setFeedback({
        tone: 'error',
        message: `Prix de « ${entry.label} » : saisissez un montant en euros.`,
      });
      return;
    }
    if (price === (entry.price ?? null)) {
      return;
    }
    await setPurchasePrice(db, entry.id, price, localToday());
    await syncReminders(db, reminders);
    await reload();
  };

  const create = async () => {
    try {
      const plan = await createPurchasePlan(db, {
        ...(await stockInput()),
        months,
      });
      await syncReminders(db, reminders);
      setFeedback({
        tone: 'ok',
        message:
          plan.entries.length === 0
            ? 'Rien ne manque : votre préparation est complète.'
            : `Plan créé : ${plan.entries.length} achat${
                plan.entries.length > 1 ? 's' : ''
              } sur ${plan.months} mois.`,
      });
      await reload();
    } catch (e) {
      setFeedback({
        tone: 'error',
        message: e instanceof Error ? e.message : String(e),
      });
    }
  };

  const toggleReminders = async (on: boolean) => {
    if (on && !(await reminders.requestPermission())) {
      setFeedback({
        tone: 'error',
        message:
          'Notifications refusées : autorisez-les dans les réglages du téléphone.',
      });
      return;
    }
    await saveRemindersEnabled(db, on);
    await syncReminders(db, reminders);
    await reload();
  };

  const title = (
    <ScreenTitle
      title="Plan d’achats"
      onBack={navigation.close}
      backLabel={navigation.backLabel}
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
  const { plan, remindersOn } = data;
  const today = localToday();

  const monthChooser = (
    <>
      <Text style={text.label}>Étaler les achats sur</Text>
      <View style={styles.chips}>
        {PLAN_MONTHS.map(m => (
          <Chip
            key={m}
            label={`${m} mois`}
            selected={months === m}
            onPress={() => setMonths(m)}
          />
        ))}
      </View>
    </>
  );

  if (plan === null) {
    return (
      <ScrollView contentContainerStyle={styles.page}>
        {title}
        <Panel
          title="Compléter la préparation pas à pas"
          right={<ShoppingCart color={colors.primary} size={20} />}
        >
          <Text style={text.body}>
            Fenrir liste ce qui manque d’après votre stock : eau et vivres
            jusqu’à votre objectif d’autonomie, équipement du kit 72 h, matériel
            « À prévoir » de Kit et matériel, articles sous leur stock minimal,
            sac d’évacuation.
          </Text>
          <Text style={text.muted}>
            L’essentiel (eau et vivres pour 3 jours, lampe, radio, trousse, kit
            72 h officiel) tombe le premier mois ; le reste est réparti sur les
            mois suivants. Aucun prix n’est estimé.
          </Text>
          {monthChooser}
          <Button variant="primary" label="Créer le plan" onPress={create} />
        </Panel>
        {feedback ? <Notice {...feedback} /> : null}
      </ScrollView>
    );
  }

  const current = currentMonthIndex(plan, today);
  const done = plan.entries.filter(e => e.done).length;
  const byMonth = Array.from({ length: plan.months }, (_, m) =>
    plan.entries.filter(e => e.month === m),
  );

  const toggle = async (entry: PurchaseEntry) => {
    await setPurchaseDone(db, entry.id, !entry.done);
    await syncReminders(db, reminders);
    await reload();
  };

  return (
    <ScrollView contentContainerStyle={styles.page}>
      {title}
      {feedback ? <Notice {...feedback} /> : null}
      <Panel>
        <Text style={text.body}>
          {done} sur {plan.entries.length} achats faits · objectif{' '}
          {plan.targetDays} jours d’autonomie
        </Text>
        {reminders.available ? (
          <View style={styles.settingRow}>
            <Text style={[text.body, styles.grow]}>
              Rappel le 1er de chaque mois
            </Text>
            <Switch
              accessibilityLabel="Rappel le 1er de chaque mois"
              value={remindersOn}
              onValueChange={value => {
                void toggleReminders(value);
              }}
              trackColor={{ false: colors.border, true: colors.primary }}
              thumbColor={colors.text}
            />
          </View>
        ) : null}
        <Text style={text.subtle}>
          Le rappel reste neutre (« Un rappel vous attend ») : la liste ne
          s’affiche qu’une fois le coffre ouvert. Il partage le réglage des
          rappels de péremption.
        </Text>
      </Panel>

      <Panel title="Budget">
        <Field
          label="Budget par mois (€)"
          keyboardType="decimal-pad"
          placeholder="Sans budget"
          value={
            budgetText ??
            (plan.budget === undefined ? '' : formatNumber(plan.budget, 2))
          }
          onChangeText={setBudgetText}
          onBlur={() => {
            if (budgetText !== null) {
              void saveBudget(budgetText);
            }
          }}
          onSubmitEditing={() => {
            if (budgetText !== null) {
              void saveBudget(budgetText);
            }
          }}
          hint="Saisissez le prix de vos achats ci-dessous : ceux qui dépassent le budget du mois passent au mois suivant, le plan s’allonge si besoin. Les essentiels restent en tête. Aucun prix n’est estimé par Fenrir."
        />
      </Panel>

      {byMonth.map((entries, m) => {
        if (entries.length === 0) {
          return null;
        }
        const total = monthTotal(plan, m);
        const over = plan.budget !== undefined && total > plan.budget;
        return (
          <Panel
            key={m}
            title={`${m === current ? 'Ce mois-ci · ' : ''}${monthLabel(
              addMonths(plan.start, m),
            )}`}
            accent={m === current ? colors.primary : undefined}
            right={
              total > 0 ? (
                <Text style={[text.mono, over ? styles.over : null]}>
                  {formatEuros(total)}
                  {plan.budget !== undefined
                    ? ` / ${formatEuros(plan.budget)}`
                    : ''}
                </Text>
              ) : undefined
            }
          >
            {over ? (
              <Text style={[text.subtle, styles.over]}>
                Les essentiels dépassent le budget de ce mois.
              </Text>
            ) : null}
            {entries.map(e => (
              <PurchaseRow
                key={e.id}
                entry={e}
                past={m < current}
                onToggle={() => {
                  void toggle(e);
                }}
                onPrice={value => {
                  void savePrice(e, value);
                }}
                onAdd={
                  e.category === null
                    ? undefined
                    : () =>
                        navigation.openStockForm({
                          category: e.category!,
                          recordType: e.recordType,
                          prefill: e.prefill,
                        })
                }
              />
            ))}
          </Panel>
        );
      })}

      <Panel title="Mettre à jour">
        <Text style={text.muted}>
          Après des achats ou un changement du foyer : les manques sont
          recalculés d’après le stock actuel, les achats cochés, les prix et les
          ajouts du simulateur sont gardés.
        </Text>
        <Button
          variant="primary"
          label="Mettre à jour d’après le stock"
          onPress={update}
        />
      </Panel>

      <Panel title="Recommencer">
        <Text style={text.muted}>
          Un nouveau plan à partir de ce mois-ci : coches, prix et ajouts du
          simulateur sont effacés.
        </Text>
        {monthChooser}
        <Button label="Recommencer le plan" onPress={create} />
        <Button
          variant="danger"
          compact
          label="Supprimer le plan"
          onPress={() => {
            void savePurchasePlan(db, null)
              .then(() => syncReminders(db, reminders))
              .then(reload);
          }}
        />
      </Panel>
    </ScrollView>
  );
}

function PurchaseRow(props: {
  entry: PurchaseEntry;
  past: boolean;
  onToggle: () => void;
  onPrice: (value: string) => void;
  onAdd?: () => void;
}) {
  const e = props.entry;
  const Icon = e.done ? CheckCircle2 : Circle;
  const [price, setPrice] = useState<string | null>(null);
  const shown =
    price ?? (e.price === undefined ? '' : formatNumber(e.price, 2));
  const commit = () => {
    if (price !== null) {
      props.onPrice(price);
      setPrice(null);
    }
  };
  return (
    <View style={styles.row}>
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked: e.done }}
        accessibilityLabel={`${e.label}${e.detail ? `, ${e.detail}` : ''}`}
        onPress={props.onToggle}
        style={({ pressed }) => [styles.check, pressed && styles.pressed]}
      >
        <Icon
          color={e.done ? colors.success : colors.textMuted}
          size={22}
          strokeWidth={2}
        />
        <View style={styles.grow}>
          <Text style={[text.body, e.done && styles.doneText]}>
            {e.label}
            {e.vital ? <Text style={styles.vital}> · essentiel</Text> : null}
            {e.source === 'crisis' ? (
              <Text style={styles.crisis}> · simulation</Text>
            ) : null}
            {props.past && !e.done ? (
              <Text style={styles.late}> · en retard</Text>
            ) : null}
          </Text>
          {e.detail ? <Text style={text.subtle}>{e.detail}</Text> : null}
        </View>
      </Pressable>
      <View style={styles.actions}>
        <View style={styles.priceBox}>
          <TextInput
            accessibilityLabel={`Prix : ${e.label}${
              e.detail ? `, ${e.detail}` : ''
            }`}
            keyboardType="decimal-pad"
            placeholder="Prix"
            placeholderTextColor={colors.textSubtle}
            selectionColor={colors.primary}
            value={shown}
            onChangeText={setPrice}
            onBlur={commit}
            onSubmitEditing={commit}
            style={styles.price}
          />
          <Text style={text.muted}>€</Text>
        </View>
        {props.onAdd && !e.done ? (
          <Button
            compact
            variant="ghost"
            label="Ajouter au stock"
            accessibilityLabel={`Ajouter au stock : ${e.label}`}
            onPress={props.onAdd}
          />
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  page: {
    paddingHorizontal: sizes.screenPadding,
    paddingBottom: space.xl,
    gap: space.m,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.s },
  settingRow: { flexDirection: 'row', alignItems: 'center', gap: space.m },
  row: {
    gap: space.xs,
    paddingBottom: space.s,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  check: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.m,
    minHeight: 44,
    borderRadius: radius.s,
  },
  pressed: { opacity: 0.82 },
  grow: { flex: 1, minWidth: 0 },
  doneText: { color: colors.textMuted, textDecorationLine: 'line-through' },
  vital: { color: colors.primary, fontSize: 13, fontWeight: '700' },
  late: { color: colors.warning, fontSize: 13, fontWeight: '700' },
  crisis: { color: colors.cyan, fontSize: 13, fontWeight: '700' },
  over: { color: colors.warning },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: space.s,
    paddingLeft: 22 + space.m,
  },
  priceBox: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  price: {
    width: 96,
    minHeight: 40,
    paddingHorizontal: space.s,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.s,
    color: colors.text,
    backgroundColor: colors.bgElevated,
    textAlign: 'right',
  },
});
