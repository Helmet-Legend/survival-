/**
 * Accueil : synthèse de l'autonomie (jauge compacte, objectif, ressource
 * limitante), trois actions prioritaires tirées du coffre, ressources en
 * tuiles, accès rapides et péremptions les plus proches. Le reste de la
 * préparation est dans l'onglet Préparer ; l'urgence est dans l'en-tête.
 */
import {
  BatteryCharging,
  CalendarClock,
  ChevronRight,
  CircleAlert,
  CirclePlus,
  Hourglass,
  ListChecks,
  ScanBarcode,
  ShoppingCart,
  Target,
  Users,
} from 'lucide-react-native';
import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { addDays, localToday } from '../../lib/dates';
import {
  adultsOf,
  countIncompleteFood,
  getExpiryAlerts,
  getResilienceReport,
  loadTargetDays,
  type ExpiryAlert,
} from '../../resilience/resilienceCalculator';
import { computeEnergy, loadEnergyNeed } from '../../resilience/energy';
import { AlertBanner } from '../components/AlertBanner';
import { AutonomyGauge } from '../components/AutonomyGauge';
import { Notice } from '../components/controls';
import {
  autonomyStatus,
  formatDate,
  formatEuros,
  formatNumber,
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
import { useAlerts } from '../useAlerts';
import { useLoader } from '../useLoader';

export function HomeScreen() {
  const { db, repo, documents, bags } = useSession();
  const navigation = useNavigation();
  const { alerts: officialAlerts } = useAlerts();
  const { data, error } = useLoader(async () => {
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
  const { today, report, targetDays, energy } = data;
  const { household } = report;
  const status = autonomyStatus(report.days, targetDays);
  const limiting = report.limitingFactor === 'water' ? 'eau' : 'vivres';
  // Aucun vivre compté : le dire, plutôt qu'une date d'épuisement.
  const noFood =
    report.limitingFactor === 'food' && report.food.available === 0;
  const members = household.members;
  const todos = buildTodos(data, navigation);

  const pct = (days: number | null) =>
    days === null ? null : Math.min(100, Math.round((days / targetDays) * 100));
  const waterPct = pct(report.water.days);
  const foodPct = pct(report.food.days);
  const energyPct = pct(energy.days);
  const progress = Math.min(1, report.days / targetDays);

  return (
    <ScrollView contentContainerStyle={styles.page}>
      {/* Alerte en cours : en premier, rouge ou orange. */}
      <AlertBanner
        alerts={officialAlerts}
        onPress={() => navigation.open('alerts')}
      />

      {/* Autonomie : jauge, objectif, ressource limitante, puis les
          ressources en pourcentage de l'objectif. */}
      <View style={styles.summary}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Détail du calcul : ouvrir le plan d’action"
          onPress={() => navigation.open('plan')}
          style={({ pressed }) => [
            styles.summaryRow,
            pressed && styles.pressed,
          ]}
        >
          <AutonomyGauge
            compact
            days={report.days}
            targetDays={targetDays}
            color={status.tone === 'danger' ? colors.danger : colors.primary}
          />
          <View style={styles.summaryText}>
            <Text style={text.label}>Autonomie du foyer</Text>
            <View style={styles.goal}>
              <Target color={colors.warning} size={16} strokeWidth={2.2} />
              <Text style={styles.goalText}>Objectif {targetDays} jours</Text>
            </View>
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
            <View style={styles.bar}>
              <View
                style={[
                  styles.barFill,
                  {
                    width: `${Math.round(progress * 100)}%`,
                    backgroundColor:
                      progress >= 1 ? colors.success : colors.primary,
                  },
                ]}
              />
            </View>
          </View>
          <ChevronRight color={colors.textMuted} size={20} />
        </Pressable>
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
        <View style={styles.stats}>
          <Stat
            icon={Users}
            color={colors.cyan}
            value={String(members)}
            unit="pers."
            sub="foyer ›"
            accessibilityLabel={`Foyer : ${members} personne${
              members > 1 ? 's' : ''
            }. Hypothèses du calcul. Modifier dans Mon foyer`}
            onPress={() => navigation.open('household')}
          />
          <Stat
            icon={WaterIcon}
            color={colors.water}
            value={compact(report.water.available)}
            unit="litres"
            sub={waterPct === null ? '—' : `${waterPct} %`}
            accessibilityLabel={`Eau disponible : ${formatNumber(
              report.water.available,
            )} L, ${report.water.days} j d’autonomie`}
            onPress={() => navigation.goTo('stock', { category: 'water' })}
          />
          <Stat
            icon={FoodIcon}
            color={colors.food}
            value={compact(report.food.available)}
            unit="kcal"
            sub={foodPct === null ? '—' : `${foodPct} %`}
            accessibilityLabel={`Réserves alimentaires : ${formatNumber(
              report.food.available,
              0,
            )} kcal, ${report.food.days} j d’autonomie`}
            onPress={() => navigation.goTo('stock', { category: 'food' })}
          />
          <Stat
            icon={BatteryCharging}
            color={colors.energy}
            value={energy.days === null ? '—' : `${energy.days} j`}
            unit="énergie"
            sub={energyPct === null ? '—' : `${energyPct} %`}
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
        </View>
        <Text style={[text.subtle, styles.calc]}>
          % de l’objectif · {formatNumber(household.waterLitersPerPersonDay)} L
          et {formatNumber(household.kcalPerPersonDay, 0)} kcal par{' '}
          {members > adultsOf(household)
            ? 'adulte (enfants et bébés : valeurs de référence)'
            : 'personne'}{' '}
          et par jour, péremptions comprises.
        </Text>
      </View>

      {/* À faire en priorité : gravité en couleur, une action par ligne. */}
      <View style={styles.panel}>
        <View style={styles.panelHead}>
          <Text style={[text.label, styles.grow]}>À faire en priorité</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Voir tout : plan d’action, à racheter et péremptions"
            onPress={() => navigation.open('plan')}
            hitSlop={12}
          >
            <Text style={styles.link}>Voir tout</Text>
          </Pressable>
        </View>
        {todos.length === 0 ? (
          <Text style={text.muted}>
            Rien d’urgent : stock à jour et préparation sans action en attente.
          </Text>
        ) : (
          todos.slice(0, TODO_MAX).map(todo => {
            const Icon = todo.icon;
            return (
              <Pressable
                key={todo.key}
                accessibilityRole="button"
                accessibilityLabel={todo.accessibilityLabel}
                onPress={todo.onPress}
                style={({ pressed }) => [
                  styles.todo,
                  { borderLeftColor: todo.color },
                  pressed && styles.pressed,
                ]}
              >
                <View
                  style={[
                    styles.todoIcon,
                    { backgroundColor: tint(todo.color, '22') },
                  ]}
                >
                  <Icon color={todo.color} size={22} strokeWidth={2.2} />
                </View>
                <View style={styles.grow}>
                  <Text style={styles.todoTitle} numberOfLines={2}>
                    {todo.title}
                  </Text>
                  {todo.detail ? (
                    <Text style={text.subtle} numberOfLines={2}>
                      {todo.detail}
                    </Text>
                  ) : null}
                </View>
                <View
                  style={[
                    styles.todoButton,
                    {
                      borderColor: tint(todo.color, 'cc'),
                      backgroundColor: tint(todo.color, '26'),
                    },
                  ]}
                >
                  <Text style={[styles.todoButtonText, { color: todo.color }]}>
                    {todo.action}
                  </Text>
                </View>
              </Pressable>
            );
          })
        )}
      </View>

      {/* Accès rapides : quatre écrans, à un geste. */}
      <Text style={[text.label, styles.section]}>Accès rapides</Text>
      <View style={styles.quickGrid}>
        <QuickLink
          icon={ListChecks}
          label="Kit et matériel"
          accessibilityLabel="Ouvrir le kit et matériel"
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
      </View>
    </ScrollView>
  );
}

/** Actions affichées dans « À faire en priorité ». */
const TODO_MAX = 3;

interface Todo {
  key: string;
  icon: typeof WaterIcon;
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
      icon: CircleAlert,
      color: colors.danger,
      title: `${n} lot${s} périmé${s}`,
      detail: [...new Set(expired.map(a => a.itemName))].join(', '),
      action: 'Voir',
      accessibilityLabel: `${n} lot${s} périmé${s}. Ouvrir le stock`,
      onPress: () => navigation.goTo('stock', { category: 'watch' }),
    });
  }
  const soon = data.alerts.filter(
    a => a.bucket !== 'expired' && a.daysLeft <= 30,
  );
  if (soon.length > 0) {
    const n = soon.length;
    const s = n > 1 ? 's' : '';
    todos.push({
      key: 'soon',
      icon: CalendarClock,
      color: colors.primary,
      title: `${n} lot${s} à consommer sous 30 jours`,
      detail: [...new Set(soon.map(a => a.itemName))].join(', '),
      action: 'Voir',
      accessibilityLabel: `${n} lot${s} à consommer sous 30 jours. Ouvrir le stock`,
      onPress: () => navigation.goTo('stock', { category: 'watch' }),
    });
  }
  if (data.incompleteFood > 0) {
    const n = data.incompleteFood;
    const s = n > 1 ? 's' : '';
    todos.push({
      key: 'incomplete',
      icon: CircleAlert,
      color: colors.danger,
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
        icon: ShoppingCart,
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
      icon: CirclePlus,
      color: colors.success,
      title: next.todo ?? next.label,
      detail: `+${next.max - next.points} pts · indice de préparation ${
        data.readiness.score
      }/100`,
      action: 'Faire',
      accessibilityLabel: `À faire : ${next.todo ?? next.label}`,
      onPress: () => runReadinessAction(navigation, next.action),
    });
  }
  return todos;
}

/** « 45 k » au-delà de 10 000 : tient dans une colonne étroite. */
function compact(n: number): string {
  return n >= 10000 ? `${formatNumber(n / 1000, 0)} k` : formatNumber(n, 0);
}

/** Une ressource dans la carte Autonomie : valeur et part de l'objectif. */
function Stat(props: {
  icon: typeof WaterIcon;
  color: string;
  value: string;
  unit: string;
  sub: string;
  accessibilityLabel: string;
  onPress: () => void;
}) {
  const Icon = props.icon;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={props.accessibilityLabel}
      onPress={props.onPress}
      style={({ pressed }) => [styles.stat, pressed && styles.pressed]}
    >
      <Icon color={props.color} size={20} strokeWidth={2} />
      <Text style={styles.statValue} numberOfLines={1} adjustsFontSizeToFit>
        {props.value}
      </Text>
      <Text style={styles.statUnit} numberOfLines={1}>
        {props.unit}
      </Text>
      <Text style={[styles.statSub, { color: props.color }]} numberOfLines={1}>
        {props.sub}
      </Text>
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
      <Icon color={colors.cyan} size={26} strokeWidth={2} />
      <Text style={styles.quickText} numberOfLines={2}>
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
  goal: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: space.xs,
    paddingHorizontal: space.s,
    paddingVertical: 3,
    borderRadius: radius.pill,
    backgroundColor: tint(colors.warning, '1f'),
  },
  goalText: {
    color: colors.warning,
    fontSize: 13,
    fontWeight: '800',
  },
  bar: {
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.border,
    overflow: 'hidden',
    marginTop: space.xs,
  },
  barFill: { height: 6, borderRadius: 3 },
  stats: {
    flexDirection: 'row',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    paddingTop: space.m,
  },
  stat: {
    flex: 1,
    alignItems: 'center',
    gap: 2,
    paddingHorizontal: 2,
  },
  statValue: {
    color: colors.text,
    fontFamily: fonts.mono,
    fontSize: 15,
    fontWeight: '700',
  },
  statUnit: { color: colors.textMuted, fontSize: 12 },
  statSub: { fontSize: 14, fontWeight: '700' },
  calc: { fontSize: 12 },
  panel: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.panel,
    padding: space.m,
    gap: space.s,
  },
  panelHead: { flexDirection: 'row', alignItems: 'center' },
  todo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.m,
    minHeight: sizes.touch + 12,
    paddingVertical: space.s,
    paddingLeft: space.s,
    paddingRight: space.xs,
    borderLeftWidth: 3,
    borderRadius: radius.s,
    backgroundColor: colors.surfaceRaised,
  },
  todoIcon: {
    width: 40,
    height: 40,
    borderRadius: radius.s,
    alignItems: 'center',
    justifyContent: 'center',
  },
  todoTitle: { color: colors.text, fontSize: 15, fontWeight: '700' },
  todoButton: {
    borderWidth: 1,
    borderRadius: radius.button,
    paddingHorizontal: space.m,
    paddingVertical: space.s,
  },
  todoButtonText: { fontSize: 14, fontWeight: '700' },
  // Titre posé sur la photo : ombre portée pour rester lisible.
  section: {
    marginTop: space.xs,
    textShadowColor: colors.bg,
    textShadowRadius: 6,
    textShadowOffset: { width: 0, height: 1 },
  },
  quickGrid: { flexDirection: 'row', gap: space.s },
  quick: {
    flex: 1,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.xs,
    minHeight: 80,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.card,
  },
  quickText: {
    color: colors.text,
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'center',
  },
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
