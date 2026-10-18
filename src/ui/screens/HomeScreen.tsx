/**
 * Accueil : jauge d'autonomie du foyer, ressource limitante, eau et vivres
 * rapportés à l'objectif, péremptions les plus proches, accès au plan
 * d'action.
 */
import {
  BatteryCharging,
  CalendarClock,
  ChevronRight,
  ClipboardList,
  Flashlight,
  Hourglass,
  ListChecks,
  ShoppingCart,
  Siren,
  TriangleAlert,
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
} from '../../resilience/resilienceCalculator';
import { computeEnergy, loadEnergyNeed } from '../../resilience/energy';
import { AutonomyGauge } from '../components/AutonomyGauge';
import {
  Button,
  Gauge,
  MetricCard,
  Notice,
  Panel,
  StatusChip,
  Stepper,
} from '../components/controls';
import {
  autonomyStatus,
  BUCKET_LABELS,
  BUCKET_TONES,
  formatDate,
  formatNumber,
  formatRelativeDays,
  UNIT_LABELS,
} from '../format';
import { FoodIcon, WaterIcon } from '../icons';
import { useNavigation } from '../navigation';
import {
  currentMonthIndex,
  loadPurchasePlan,
  monthLabel,
  monthOf,
} from '../../plan/purchasePlan';
import { getReadiness } from '../../plan/readiness';
import { useSession } from '../session';
import { scoreColor } from './ReadinessScreen';
import { colors, radius, sizes, space, solidTint, text, tint } from '../theme';
import { useLoader } from '../useLoader';

/** Même borne que dans les Réglages. */
const MAX_MEMBERS = 12;
/** Péremptions affichées sur l'accueil ; la liste complète est au plan. */
const HOME_ALERTS = 3;

export function HomeScreen() {
  const { db, repo } = useSession();
  const navigation = useNavigation();
  const { data, error, reload } = useLoader(async () => {
    const today = localToday();
    const [report, alerts, targetDays, incompleteFood, items, whPerPerson] =
      await Promise.all([
        getResilienceReport(db, today),
        getExpiryAlerts(db, today),
        loadTargetDays(db),
        countIncompleteFood(db, today),
        repo.listItems({ bag: 'none' }),
        loadEnergyNeed(db),
      ]);
    const energy = computeEnergy(items, report.household.members, whPerPerson);
    return { today, report, alerts, targetDays, incompleteFood, energy };
  });

  if (error) {
    return (
      <View style={styles.page}>
        <Notice tone="error" message={error} />
      </View>
    );
  }
  if (data === null) {
    return null;
  }
  const { today, report, alerts, targetDays, incompleteFood, energy } = data;
  const { household } = report;
  const status = autonomyStatus(report.days, targetDays);
  const limiting = report.limitingFactor === 'water' ? 'eau' : 'vivres';
  // Aucun vivre compté : le dire, plutôt qu'une date d'épuisement.
  const noFood =
    report.limitingFactor === 'food' && report.food.available === 0;
  const members = report.household.members;
  const expired = alerts.filter(a => a.bucket === 'expired');
  const changeMembers = async (delta: number) => {
    await saveHousehold(db, { ...report.household, members: members + delta });
    await reload();
  };

  return (
    <ScrollView contentContainerStyle={styles.page}>
      {expired.length > 0 ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${expired.length} lot${
            expired.length > 1 ? 's' : ''
          } périmé${expired.length > 1 ? 's' : ''}. Ouvrir le stock`}
          onPress={() => navigation.goTo('stock')}
          style={({ pressed }) => [styles.expired, pressed && styles.pressed]}
        >
          <TriangleAlert color={colors.danger} size={20} />
          <View style={styles.grow}>
            <Text style={styles.expiredTitle}>
              {expired.length} lot{expired.length > 1 ? 's' : ''} périmé
              {expired.length > 1 ? 's' : ''}
            </Text>
            <Text style={text.subtle} numberOfLines={1}>
              {[...new Set(expired.map(a => a.itemName))].join(', ')}
            </Text>
          </View>
          <ChevronRight color={colors.text} size={20} />
        </Pressable>
      ) : null}
      <View style={styles.hero}>
        <AutonomyGauge
          days={report.days}
          targetDays={targetDays}
          color={status.tone === 'danger' ? colors.danger : colors.primary}
        />
        <View style={styles.heroFoot}>
          <StatusChip tone={status.tone} label={status.label} />
          <View style={styles.target}>
            <Text style={styles.targetText}>objectif {targetDays} j</Text>
          </View>
        </View>
      </View>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Hypothèses du calcul. Modifier dans les réglages"
        onPress={() => navigation.open('settings')}
        style={({ pressed }) => [styles.assumptions, pressed && styles.pressed]}
      >
        <Text style={styles.assumptionsText}>
          Calcul : {formatNumber(household.waterLitersPerPersonDay)} L d’eau et{' '}
          {formatNumber(household.kcalPerPersonDay, 0)} kcal par personne et par
          jour, péremptions comprises. Modifier ›
        </Text>
      </Pressable>

      <Button
        variant="danger"
        icon={Siren}
        label="URGENCE · appels, position, SMS"
        accessibilityLabel="Ouvrir l’écran Urgence"
        onPress={() => navigation.open('emergency')}
      />

      <View style={styles.household}>
        <Users color={colors.cyan} size={22} strokeWidth={2} />
        <View style={styles.grow}>
          <Text style={styles.householdTitle}>Foyer</Text>
          <Text style={text.subtle}>À faire tenir</Text>
        </View>
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
        accessibilityLabel={
          noFood
            ? 'Aucun vivre compté. Ajouter des vivres'
            : `Ressource limitante : ${limiting}. Ouvrir le plan d’action`
        }
        onPress={() =>
          noFood
            ? navigation.goTo('stock', { category: 'food' })
            : navigation.open('plan')
        }
        style={({ pressed }) => [styles.limiting, pressed && styles.pressed]}
      >
        {report.limitingFactor === 'water' ? (
          <WaterIcon color={colors.cyan} size={20} strokeWidth={2} />
        ) : (
          <FoodIcon color={colors.food} size={20} strokeWidth={2} />
        )}
        <View style={styles.grow}>
          <Text style={styles.limitingText}>
            {noFood
              ? 'Aucun vivre compté'
              : `Ressource limitante : ${limiting}`}
          </Text>
          <Text style={text.subtle}>
            {noFood
              ? `Ajoutez vos vivres dans Stocks › Nourriture. L’eau seule couvre ${report.water.days} j.`
              : `Stock épuisé le ${formatDate(addDays(today, report.days))}`}
          </Text>
        </View>
        <ChevronRight color={colors.text} size={20} />
      </Pressable>

      <View style={styles.grid}>
        <MetricCard
          icon={WaterIcon}
          color={colors.water}
          label="Eau disponible"
          value={formatNumber(report.water.available)}
          unit="L"
          caption={`${report.water.days} j d’autonomie`}
          progress={report.water.days / targetDays}
          detail={`${formatNumber(report.water.dailyNeed)} L / jour`}
          onPress={() => navigation.goTo('stock', { category: 'water' })}
        />
        <MetricCard
          icon={FoodIcon}
          color={colors.food}
          label="Réserves alimentaires"
          value={formatNumber(report.food.available, 0)}
          unit="kcal"
          caption={`${report.food.days} j d’autonomie`}
          progress={report.food.days / targetDays}
          detail={`${formatNumber(report.food.dailyNeed, 0)} kcal / jour`}
          onPress={() => navigation.goTo('stock', { category: 'food' })}
        />
      </View>
      <View style={styles.grid}>
        <MetricCard
          icon={BatteryCharging}
          color={colors.energy}
          label="Énergie stockée"
          value={formatNumber(energy.usableWh, 0)}
          unit="Wh utiles"
          caption={
            energy.days === null
              ? 'Capacités non renseignées'
              : `${energy.days} j de recharge`
          }
          detail={`${formatNumber(energy.dailyNeed, 0)} Wh / jour`}
          onPress={() => navigation.goTo('stock', { category: 'power' })}
        />
        <MetricCard
          icon={Flashlight}
          color={colors.equipment}
          label="Éclairage"
          value={String(energy.lights)}
          unit={energy.lights > 1 ? 'lampes' : 'lampe'}
          caption={`pour ${household.members} personne${
            household.members > 1 ? 's' : ''
          }`}
          progress={Math.min(1, energy.lights / household.members)}
          onPress={() => navigation.goTo('stock', { category: 'energy' })}
        />
      </View>
      {incompleteFood > 0 ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Données incomplètes : ${incompleteFood} aliment${
            incompleteFood > 1 ? 's' : ''
          } sans calories. Ouvrir la nourriture`}
          onPress={() => navigation.goTo('stock', { category: 'food' })}
          style={({ pressed }) => [
            styles.incomplete,
            pressed && styles.pressed,
          ]}
        >
          <FoodIcon color={colors.food} size={18} strokeWidth={2} />
          <View style={styles.grow}>
            <Text style={styles.limitingText}>Données incomplètes</Text>
            <Text style={text.subtle}>
              {incompleteFood} aliment{incompleteFood > 1 ? 's' : ''} sans
              valeur énergétique : non compté{incompleteFood > 1 ? 's' : ''}{' '}
              dans l’autonomie.
            </Text>
          </View>
          <ChevronRight color={colors.text} size={20} />
        </Pressable>
      ) : null}
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

      <ReadinessCard />
      <MonthPurchases />
      <Button
        icon={ListChecks}
        chevron
        label="PRÉPARATION · kit 72 h, maison et sacs"
        accessibilityLabel="Ouvrir la préparation par paliers"
        onPress={() => navigation.open('preparation')}
      />
      <Button
        icon={Hourglass}
        chevron
        label="SIMULATION · tester une crise sur votre stock"
        accessibilityLabel="Ouvrir le simulateur de crise"
        onPress={() => navigation.open('crisis')}
      />

      <Button
        variant="primary"
        icon={ClipboardList}
        chevron
        label="ACCÉDER AUX PLANS D’ACTION"
        accessibilityLabel="Accéder aux plans d’action"
        onPress={() => navigation.open('plan')}
      />
    </ScrollView>
  );
}

/** Achats prévus ce mois-ci par le plan d'achats, s'il existe. */
function MonthPurchases() {
  const { db } = useSession();
  const navigation = useNavigation();
  const { data } = useLoader(() => loadPurchasePlan(db));
  if (!data) {
    return null;
  }
  const today = localToday();
  const month = currentMonthIndex(data, today);
  // Achats du mois, et ceux des mois passés pas encore faits.
  const pending = data.entries.filter(e => !e.done && e.month <= month);
  if (pending.length === 0) {
    return null;
  }
  return (
    <Button
      icon={ShoppingCart}
      chevron
      label={`ACHATS · ${monthLabel(monthOf(today))} · ${
        pending.length
      } à faire`}
      accessibilityLabel={`Achats du mois : ${pending.length} à faire. Ouvrir le plan d’achats`}
      onPress={() => navigation.open('purchases')}
    />
  );
}

/** Indice de préparation, résumé ; le détail s'ouvre en plein écran. */
function ReadinessCard() {
  const { db, repo, documents, bags } = useSession();
  const navigation = useNavigation();
  const { data } = useLoader(async () => {
    const [items, docs, bagList] = await Promise.all([
      repo.listItems({ bag: 'none' }),
      documents.list(),
      bags.list(),
    ]);
    return getReadiness(db, {
      items,
      documentCount: docs.length,
      bags: bagList,
      asOf: localToday(),
    });
  });
  if (data === null) {
    return null;
  }
  const color = scoreColor(data.score);
  const next = data.next[0];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Indice de préparation : ${data.score} sur 100, ${data.level}. Voir le détail`}
      onPress={() => navigation.open('readiness')}
      style={({ pressed }) => [
        styles.readiness,
        pressed && styles.readinessPressed,
      ]}
    >
      <View style={styles.readinessHead}>
        <Text style={[text.label, styles.readinessGrow]}>
          Indice de préparation
        </Text>
        <Text style={[text.mono, styles.readinessScore, { color }]}>
          {data.score}/100
        </Text>
      </View>
      <Gauge value={data.score / 100} color={color} />
      <Text style={text.subtle}>
        {data.level}
        {next ? ` · Prochaine action : ${next.todo}` : ''}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  readiness: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.card,
    padding: space.m,
    gap: space.s,
  },
  readinessPressed: { opacity: 0.82 },
  readinessHead: { flexDirection: 'row', alignItems: 'center', gap: space.m },
  readinessGrow: { flex: 1 },
  readinessScore: { fontSize: 18, fontWeight: '800' },
  assumptions: {
    marginTop: -space.s,
    paddingHorizontal: space.m,
    paddingVertical: space.s,
    borderRadius: radius.button,
    backgroundColor: solidTint(colors.surface, 0.9),
  },
  assumptionsText: { ...text.subtle, color: colors.textMuted },
  page: {
    paddingHorizontal: sizes.screenPadding,
    paddingBottom: space.xl,
    gap: space.m,
  },
  hero: {
    borderRadius: radius.panel,
    overflow: 'hidden',
    paddingVertical: space.l,
    gap: space.m,
  },
  expired: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.m,
    minHeight: sizes.touch,
    paddingVertical: space.s,
    paddingHorizontal: space.l,
    borderRadius: radius.button,
    borderWidth: 1,
    borderColor: colors.danger,
    backgroundColor: solidTint(colors.danger, 0.16),
  },
  expiredTitle: { color: colors.text, fontSize: 15, fontWeight: '700' },
  // Pastille sombre : lisible sur la photo du fond.
  target: {
    paddingVertical: space.xs,
    paddingHorizontal: space.m,
    borderRadius: radius.pill,
    backgroundColor: tint(colors.bg, 'cc'),
  },
  targetText: { color: colors.text, fontSize: 14 },
  heroFoot: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: space.m,
  },
  household: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.m,
    paddingVertical: space.s,
    paddingHorizontal: space.l,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  householdTitle: { color: colors.text, fontSize: 16, fontWeight: '700' },
  limiting: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.m,
    minHeight: sizes.touch,
    paddingVertical: space.s,
    paddingHorizontal: space.l,
    borderRadius: radius.button,
    borderWidth: 1,
    borderColor: colors.primary,
    // Teinte opaque : la photo du fond ne passe pas au travers.
    backgroundColor: solidTint(colors.primary, 0.07),
  },
  incomplete: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.m,
    minHeight: sizes.touch,
    paddingVertical: space.s,
    paddingHorizontal: space.l,
    borderRadius: radius.button,
    borderWidth: 1,
    borderColor: tint(colors.food, '66'),
    backgroundColor: solidTint(colors.food, 0.07),
  },
  limitingText: { color: colors.cyanSoft, fontSize: 15, fontWeight: '600' },
  pressed: { opacity: 0.82 },
  grow: { flex: 1, minWidth: 0 },
  grid: { flexDirection: 'row', gap: space.m },
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
