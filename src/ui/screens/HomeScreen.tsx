/**
 * Accueil : synthèse de l'autonomie (jauge compacte, objectif, ressource
 * limitante), trois actions prioritaires tirées du coffre, ressources en
 * tuiles, accès rapides et péremptions les plus proches. Le reste de la
 * préparation est dans l'onglet Préparer ; l'urgence est dans l'en-tête.
 */
import {
  BatteryCharging,
  BookOpen,
  CalendarClock,
  ChevronRight,
  Flashlight,
  Hourglass,
  ListChecks,
  Map as MapIcon,
  ScanBarcode,
  Users,
} from 'lucide-react-native';
import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { addDays, localToday } from '../../lib/dates';
import {
  countIncompleteFood,
  getExpiryAlerts,
  getResilienceReport,
  loadTargetDays,
  saveHousehold,
  type ExpiryAlert,
} from '../../resilience/resilienceCalculator';
import { computeEnergy, loadEnergyNeed } from '../../resilience/energy';
import { AutonomyGauge } from '../components/AutonomyGauge';
import { Notice, Panel, StatusChip, Stepper } from '../components/controls';
import {
  autonomyStatus,
  BUCKET_LABELS,
  BUCKET_TONES,
  formatDate,
  formatEuros,
  formatNumber,
  formatRelativeDays,
  UNIT_LABELS,
} from '../format';
import { FoodIcon, WaterIcon } from '../icons';
import { useNavigation, type Navigation } from '../navigation';
import {
  currentMonthIndex,
  loadPurchasePlan,
  monthLabel,
  monthOf,
  type PurchasePlan,
} from '../../plan/purchasePlan';
import { getReadiness, type ReadinessReport } from '../../plan/readiness';
import { useSession } from '../session';
import { runReadinessAction } from './ReadinessScreen';
import {
  colors,
  fonts,
  radius,
  sizes,
  space,
  solidTint,
  text,
  tint,
} from '../theme';
import { useLoader } from '../useLoader';

/** Même borne que dans les Réglages. */
const MAX_MEMBERS = 12;
/** Péremptions affichées sur l'accueil ; la liste complète est au plan. */
const HOME_ALERTS = 3;

export function HomeScreen() {
  const { db, repo, documents, bags } = useSession();
  const navigation = useNavigation();
  const { data, error, reload } = useLoader(async () => {
    const today = localToday();
    const [
      report,
      alerts,
      targetDays,
      incompleteFood,
      items,
      whPerPerson,
      docs,
      bagList,
      plan,
    ] = await Promise.all([
      getResilienceReport(db, today),
      getExpiryAlerts(db, today),
      loadTargetDays(db),
      countIncompleteFood(db, today),
      repo.listItems({ bag: 'none' }),
      loadEnergyNeed(db),
      documents.list(),
      bags.list(),
      loadPurchasePlan(db),
    ]);
    const energy = computeEnergy(items, report.household.members, whPerPerson);
    const readiness = await getReadiness(db, {
      items,
      documentCount: docs.length,
      bags: bagList,
      asOf: today,
    });
    return {
      today,
      report,
      alerts,
      targetDays,
      incompleteFood,
      energy,
      readiness,
      plan,
    };
  });

  if (error) {
    return (
      <View style={styles.page}>
        <Notice tone="error" message={error} />
      </View>
    );
  }
  if (data === null) {
    return (
      <View style={styles.page}>
        <Text style={[text.subtle, styles.loading]}>
          Calcul de l’autonomie…
        </Text>
      </View>
    );
  }
  const { today, report, alerts, targetDays, energy } = data;
  const { household } = report;
  const status = autonomyStatus(report.days, targetDays);
  const limiting = report.limitingFactor === 'water' ? 'eau' : 'vivres';
  // Aucun vivre compté : le dire, plutôt qu'une date d'épuisement.
  const noFood =
    report.limitingFactor === 'food' && report.food.available === 0;
  const members = household.members;
  const changeMembers = async (delta: number) => {
    await saveHousehold(db, { ...household, members: members + delta });
    await reload();
  };
  const todos = buildTodos(data, navigation);

  return (
    <ScrollView contentContainerStyle={styles.page}>
      {/* Synthèse : jauge compacte, objectif, ressource limitante. */}
      <View style={styles.summary}>
        <View style={styles.summaryRow}>
          <AutonomyGauge
            compact
            days={report.days}
            targetDays={targetDays}
            color={status.tone === 'danger' ? colors.danger : colors.primary}
          />
          <View style={styles.summaryText}>
            <Text style={text.label}>Autonomie du foyer</Text>
            <View style={styles.chips}>
              <StatusChip tone={status.tone} label={status.label} />
            </View>
            <Text style={styles.targetText}>objectif {targetDays} j</Text>
            {noFood ? null : (
              <>
                <Text style={styles.limitingText}>
                  Ressource limitante : {limiting}
                </Text>
                <Text style={text.subtle}>
                  Stock épuisé le {formatDate(addDays(today, report.days))}
                </Text>
              </>
            )}
          </View>
        </View>
        {noFood ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Aucun vivre compté. Ajouter des vivres"
            onPress={() => navigation.goTo('stock', { category: 'food' })}
            style={({ pressed }) => [styles.noFood, pressed && styles.pressed]}
          >
            <FoodIcon color={colors.food} size={20} strokeWidth={2} />
            <View style={styles.grow}>
              <Text style={styles.limitingText}>Aucun vivre compté</Text>
              <Text style={text.subtle}>
                Ajoutez vos vivres dans Stocks › Nourriture. L’eau seule couvre{' '}
                {report.water.days} j.
              </Text>
            </View>
            <ChevronRight color={colors.text} size={20} />
          </Pressable>
        ) : null}
        <View style={styles.household}>
          <Users color={colors.cyan} size={20} strokeWidth={2} />
          <Text style={[styles.householdTitle, styles.grow]}>Foyer</Text>
          <Stepper
            value={`${members} pers.`}
            onDecrease={() => {
              void changeMembers(-1);
            }}
            onIncrease={() => {
              void changeMembers(1);
            }}
            canDecrease={members > 1}
            canIncrease={members < MAX_MEMBERS}
            decreaseLabel="Retirer une personne"
            increaseLabel="Ajouter une personne"
          />
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Hypothèses du calcul. Modifier dans les réglages"
          onPress={() => navigation.open('settings')}
          style={({ pressed }) => pressed && styles.pressed}
        >
          <Text style={text.subtle}>
            Calcul : {formatNumber(household.waterLitersPerPersonDay)} L d’eau
            et {formatNumber(household.kcalPerPersonDay, 0)} kcal par personne
            et par jour, péremptions comprises. Modifier ›
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Détail du calcul : ouvrir le plan d’action"
          onPress={() => navigation.open('plan')}
          hitSlop={8}
          style={({ pressed }) => [styles.detail, pressed && styles.pressed]}
        >
          <Text style={styles.link}>Détail du calcul et à racheter ›</Text>
        </Pressable>
      </View>

      {/* À faire en priorité : trois actions au plus, tirées du stock réel. */}
      <Panel
        title="À faire en priorité"
        right={
          todos.length > TODO_MAX ? (
            <Text style={text.subtle}>
              {TODO_MAX} sur {todos.length}
            </Text>
          ) : undefined
        }
      >
        {todos.length === 0 ? (
          <Text style={text.muted}>
            Rien d’urgent : stock à jour et préparation sans action en attente.
          </Text>
        ) : (
          todos.slice(0, TODO_MAX).map(todo => (
            <Pressable
              key={todo.key}
              accessibilityRole="button"
              accessibilityLabel={todo.accessibilityLabel}
              onPress={todo.onPress}
              style={({ pressed }) => [styles.todo, pressed && styles.pressed]}
            >
              <View
                style={[
                  styles.todoTag,
                  { borderColor: tint(todo.color, '88') },
                ]}
              >
                <Text style={[styles.todoTagText, { color: todo.color }]}>
                  {todo.tag}
                </Text>
              </View>
              <View style={styles.grow}>
                <Text style={styles.todoTitle}>{todo.title}</Text>
                {todo.detail ? (
                  <Text style={text.subtle} numberOfLines={2}>
                    {todo.detail}
                  </Text>
                ) : null}
              </View>
              <Text style={styles.link}>{todo.action}</Text>
            </Pressable>
          ))
        )}
      </Panel>

      {/* Ressources essentielles, en tuiles compactes. */}
      <View style={styles.tiles}>
        <ResourceTile
          icon={WaterIcon}
          color={colors.water}
          value={`${report.water.days} j`}
          name="Eau"
          accessibilityLabel={`Eau disponible : ${formatNumber(
            report.water.available,
          )} L, ${report.water.days} j d’autonomie`}
          onPress={() => navigation.goTo('stock', { category: 'water' })}
        />
        <ResourceTile
          icon={FoodIcon}
          color={colors.food}
          value={`${report.food.days} j`}
          name="Vivres"
          accessibilityLabel={`Réserves alimentaires : ${formatNumber(
            report.food.available,
            0,
          )} kcal, ${report.food.days} j d’autonomie`}
          onPress={() => navigation.goTo('stock', { category: 'food' })}
        />
        <ResourceTile
          icon={BatteryCharging}
          color={colors.energy}
          value={energy.days === null ? '—' : `${energy.days} j`}
          name="Énergie"
          accessibilityLabel={`Énergie stockée : ${formatNumber(
            energy.usableWh,
            0,
          )} Wh utiles, ${
            energy.days === null
              ? 'Capacités non renseignées'
              : `${energy.days} j de recharge`
          }`}
          onPress={() => navigation.goTo('stock', { category: 'power' })}
        />
        <ResourceTile
          icon={Flashlight}
          color={colors.equipment}
          value={`${energy.lights}/${members}`}
          name="Lampes"
          accessibilityLabel={`Éclairage : ${energy.lights} ${
            energy.lights > 1 ? 'lampes' : 'lampe'
          }, pour ${members} personne${members > 1 ? 's' : ''}`}
          onPress={() => navigation.goTo('stock', { category: 'energy' })}
        />
      </View>

      {/* Accès rapides : les écrans les plus utilisés, à un geste. */}
      <Text style={[text.label, styles.section]}>Accès rapides</Text>
      <View style={styles.quickGrid}>
        <QuickLink
          icon={ListChecks}
          label="Kit 72 h"
          accessibilityLabel="Ouvrir la préparation par paliers"
          onPress={() => navigation.open('preparation')}
        />
        <QuickLink
          icon={Users}
          label="Plan familial"
          accessibilityLabel="Ouvrir le plan familial"
          onPress={() => navigation.open('familyPlan')}
        />
        <QuickLink
          icon={Hourglass}
          label="Simulateur"
          accessibilityLabel="Ouvrir le simulateur de crise"
          onPress={() => navigation.open('crisis')}
        />
        <QuickLink
          icon={ScanBarcode}
          label="Scanner"
          accessibilityLabel="Scanner des codes-barres"
          onPress={() => navigation.open('scan')}
        />
        <QuickLink
          icon={MapIcon}
          label="Carte"
          accessibilityLabel="Ouvrir la carte"
          onPress={() => navigation.goTo('map')}
        />
        <QuickLink
          icon={BookOpen}
          label="Fiches"
          accessibilityLabel="Ouvrir les fiches pratiques"
          onPress={() => navigation.goTo('guides')}
        />
      </View>

      <Panel
        title="Péremptions à surveiller"
        right={
          alerts.length > HOME_ALERTS ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Voir les ${alerts.length} péremptions`}
              onPress={() => navigation.open('plan')}
              hitSlop={12}
            >
              <Text style={styles.link}>Tout voir ({alerts.length}) ›</Text>
            </Pressable>
          ) : (
            <CalendarClock color={colors.purple} size={20} />
          )
        }
      >
        {alerts.length === 0 ? (
          <Text style={text.muted}>
            Aucune péremption dans les 90 prochains jours.
          </Text>
        ) : (
          alerts.slice(0, HOME_ALERTS).map(alert => (
            <View key={alert.lotId} style={styles.alert}>
              <View style={styles.grow}>
                <Text style={text.body} numberOfLines={1}>
                  {alert.itemName}
                </Text>
                <Text style={text.subtle}>
                  {formatNumber(alert.quantity)} {UNIT_LABELS[alert.unit]} ·{' '}
                  {formatRelativeDays(alert.daysLeft)}
                  {alert.bagName ? ` · ${alert.bagName}` : ''}
                </Text>
              </View>
              <StatusChip
                tone={BUCKET_TONES[alert.bucket]}
                label={BUCKET_LABELS[alert.bucket]}
              />
            </View>
          ))
        )}
      </Panel>
    </ScrollView>
  );
}

/** Actions affichées dans « À faire en priorité ». */
const TODO_MAX = 3;

interface Todo {
  key: string;
  tag: string;
  color: string;
  title: string;
  detail: string | null;
  action: string;
  accessibilityLabel: string;
  onPress: () => void;
}

type HomeData = {
  alerts: ExpiryAlert[];
  incompleteFood: number;
  readiness: ReadinessReport;
  plan: PurchasePlan | null;
  today: string;
};

/**
 * Les actions les plus utiles maintenant, la plus urgente d'abord : lots
 * périmés, vivres sans calories, achats du mois, prochaine action de
 * l'indice de préparation. Rien n'est inventé : tout vient du coffre.
 */
function buildTodos(data: HomeData, navigation: Navigation): Todo[] {
  const todos: Todo[] = [];
  const expired = data.alerts.filter(a => a.bucket === 'expired');
  if (expired.length > 0) {
    const n = expired.length;
    const s = n > 1 ? 's' : '';
    todos.push({
      key: 'expired',
      tag: 'Périmé',
      color: colors.danger,
      title: `${n} lot${s} périmé${s}`,
      detail: [...new Set(expired.map(a => a.itemName))].join(', '),
      action: 'Voir',
      accessibilityLabel: `${n} lot${s} périmé${s}. Ouvrir le stock`,
      onPress: () => navigation.goTo('stock'),
    });
  }
  if (data.incompleteFood > 0) {
    const n = data.incompleteFood;
    const s = n > 1 ? 's' : '';
    todos.push({
      key: 'incomplete',
      tag: 'À compléter',
      color: colors.food,
      title: 'Données incomplètes',
      detail: `${n} aliment${s} sans valeur énergétique : non compté${s} dans l’autonomie.`,
      action: 'Compléter',
      accessibilityLabel: `Données incomplètes : ${n} aliment${s} sans calories. Ouvrir la nourriture`,
      onPress: () => navigation.goTo('stock', { category: 'food' }),
    });
  }
  if (data.plan !== null) {
    const month = currentMonthIndex(data.plan, data.today);
    const pending = data.plan.entries.filter(e => !e.done && e.month <= month);
    if (pending.length > 0) {
      const cost = pending.reduce((sum, e) => sum + (e.price ?? 0), 0);
      todos.push({
        key: 'purchases',
        tag: 'Achats',
        color: colors.primary,
        title: `${monthLabel(monthOf(data.today))} : ${pending.length} à faire`,
        detail: cost > 0 ? formatEuros(cost) : null,
        action: 'Voir',
        accessibilityLabel: `Achats du mois : ${pending.length} à faire${
          cost > 0 ? `, ${formatEuros(cost)}` : ''
        }. Ouvrir le plan d’achats`,
        onPress: () => navigation.open('purchases'),
      });
    }
  }
  const next = data.readiness.next[0];
  if (next) {
    todos.push({
      key: `readiness-${next.id}`,
      tag: `+${next.max - next.points} pts`,
      color: colors.cyan,
      title: next.todo ?? next.label,
      detail: `Indice de préparation ${data.readiness.score}/100`,
      action: 'Faire',
      accessibilityLabel: `À faire : ${next.todo ?? next.label}`,
      onPress: () => runReadinessAction(navigation, next.action),
    });
  }
  return todos;
}

function ResourceTile(props: {
  icon: typeof WaterIcon;
  color: string;
  value: string;
  name: string;
  accessibilityLabel: string;
  onPress: () => void;
}) {
  const Icon = props.icon;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={props.accessibilityLabel}
      onPress={props.onPress}
      style={({ pressed }) => [styles.tile, pressed && styles.pressed]}
    >
      <Icon color={props.color} size={20} strokeWidth={2} />
      <Text style={styles.tileValue} numberOfLines={1} adjustsFontSizeToFit>
        {props.value}
      </Text>
      <Text style={text.subtle}>{props.name}</Text>
    </Pressable>
  );
}

function QuickLink(props: {
  icon: typeof WaterIcon;
  label: string;
  accessibilityLabel: string;
  onPress: () => void;
}) {
  const Icon = props.icon;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={props.accessibilityLabel}
      onPress={props.onPress}
      style={({ pressed }) => [styles.quick, pressed && styles.pressed]}
    >
      <Icon color={colors.cyan} size={24} strokeWidth={2} />
      <Text style={styles.quickText} numberOfLines={1}>
        {props.label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  page: {
    paddingHorizontal: sizes.screenPadding,
    paddingBottom: space.xl,
    gap: space.m,
  },
  loading: { textAlign: 'center', marginTop: space.xl },
  // Surfaces opaques : la photo du fond reste décorative.
  summary: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.panel,
    padding: space.l,
    gap: space.m,
  },
  summaryRow: { flexDirection: 'row', alignItems: 'center', gap: space.l },
  summaryText: { flex: 1, minWidth: 0, gap: space.xs },
  chips: { flexDirection: 'row' },
  targetText: { color: colors.text, fontSize: 14 },
  limitingText: { color: colors.cyanSoft, fontSize: 15, fontWeight: '600' },
  noFood: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.m,
    minHeight: sizes.touch,
    paddingVertical: space.s,
    paddingHorizontal: space.m,
    borderRadius: radius.button,
    borderWidth: 1,
    borderColor: tint(colors.food, '66'),
    backgroundColor: solidTint(colors.food, 0.07),
  },
  household: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.m,
    paddingTop: space.s,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  householdTitle: { color: colors.text, fontSize: 16, fontWeight: '700' },
  detail: { alignSelf: 'flex-start', minHeight: 32, justifyContent: 'center' },
  todo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.m,
    minHeight: sizes.touch + 8,
    paddingVertical: space.s,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  todoTag: {
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: space.s,
    paddingVertical: 2,
  },
  todoTagText: { fontSize: 12, fontWeight: '700' },
  todoTitle: { color: colors.text, fontSize: 15, fontWeight: '600' },
  tiles: { flexDirection: 'row', gap: space.s },
  tile: {
    flex: 1,
    alignItems: 'center',
    gap: 2,
    paddingVertical: space.m,
    paddingHorizontal: space.xs,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.card,
  },
  tileValue: {
    color: colors.text,
    fontFamily: fonts.mono,
    fontSize: 16,
    fontWeight: '700',
  },
  // Titre posé sur la photo : ombre portée pour rester lisible.
  section: {
    marginTop: space.xs,
    textShadowColor: colors.bg,
    textShadowRadius: 6,
    textShadowOffset: { width: 0, height: 1 },
  },
  quickGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.s },
  quick: {
    flexBasis: '31%',
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.xs,
    minHeight: 80,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.card,
  },
  quickText: { color: colors.text, fontSize: 13, fontWeight: '600' },
  pressed: { opacity: 0.82 },
  grow: { flex: 1, minWidth: 0 },
  alert: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.m,
    paddingVertical: space.s,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  link: { color: colors.cyan, fontSize: 14, fontWeight: '600' },
});
