/**
 * Plan d'achats échelonné : ce qui manque à la préparation, réparti mois par
 * mois, l'essentiel d'abord. Chaque achat se coche ; un rappel neutre peut
 * être programmé le 1er de chaque mois.
 */
import { CheckCircle2, Circle, ShoppingCart } from 'lucide-react-native';
import React, { useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
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
  savePurchasePlan,
  setPurchaseDone,
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
  Notice,
  Panel,
  ScreenTitle,
} from '../components/controls';
import { useNavigation } from '../navigation';
import { useSession } from '../session';
import { colors, radius, sizes, space, text } from '../theme';
import { useLoader } from '../useLoader';

export function PurchasePlanScreen() {
  const { db, repo, bags, documents, reminders } = useSession();
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

  const create = async () => {
    try {
      const [items, bagList, docs] = await Promise.all([
        repo.listItems({ bag: 'none' }),
        bags.list(),
        documents.list(),
      ]);
      const plan = await createPurchasePlan(db, {
        items,
        bags: bagList,
        documentCount: docs.length,
        asOf: localToday(),
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
      backLabel="Retour à l’accueil"
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
            jusqu’à votre objectif d’autonomie, équipement du kit 72 h, articles
            sous leur stock minimal, sac d’évacuation.
          </Text>
          <Text style={text.muted}>
            L’essentiel (eau et vivres pour 3 jours, lampe, radio, trousse)
            tombe le premier mois ; le reste est réparti sur les mois suivants.
            Aucun prix n’est estimé.
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

      {byMonth.map((entries, m) =>
        entries.length === 0 ? null : (
          <Panel
            key={m}
            title={`${m === current ? 'Ce mois-ci · ' : ''}${monthLabel(
              addMonths(plan.start, m),
            )}`}
            accent={m === current ? colors.primary : undefined}
          >
            {entries.map(e => (
              <PurchaseRow
                key={e.id}
                entry={e}
                past={m < current}
                onToggle={() => {
                  void toggle(e);
                }}
                onAdd={
                  e.category === null
                    ? undefined
                    : () =>
                        navigation.openStockForm({
                          category: e.category!,
                          prefill: e.prefill,
                        })
                }
              />
            ))}
          </Panel>
        ),
      )}

      <Panel title="Recalculer">
        <Text style={text.muted}>
          Après des achats ou un changement du foyer, recalculez le plan à
          partir du stock actuel. Les coches sont remises à zéro.
        </Text>
        {monthChooser}
        <Button label="Recalculer le plan" onPress={create} />
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
  onAdd?: () => void;
}) {
  const e = props.entry;
  const Icon = e.done ? CheckCircle2 : Circle;
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
            {props.past && !e.done ? (
              <Text style={styles.late}> · en retard</Text>
            ) : null}
          </Text>
          {e.detail ? <Text style={text.subtle}>{e.detail}</Text> : null}
        </View>
      </Pressable>
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
});
