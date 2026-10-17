/**
 * Accueil : jauge d'autonomie du foyer, ressource limitante, eau et vivres
 * rapportés à l'objectif, péremptions les plus proches, accès au plan
 * d'action.
 */
import {
  CalendarClock,
  ChevronRight,
  ClipboardList,
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
import { AutonomyGauge } from '../components/AutonomyGauge';
import {
  Backdrop,
  Button,
  MetricCard,
  Notice,
  Panel,
  StatusChip,
  Stepper,
} from '../components/controls';
import { TOPOGRAPHIC_SVG } from '../assets/backgrounds';
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
import { useSession } from '../session';
import { colors, radius, sizes, space, text, tint } from '../theme';
import { useLoader } from '../useLoader';

/** Même borne que dans les Réglages. */
const MAX_MEMBERS = 12;
/** Péremptions affichées sur l'accueil ; la liste complète est au plan. */
const HOME_ALERTS = 3;

export function HomeScreen() {
  const { db } = useSession();
  const navigation = useNavigation();
  const { data, error, reload } = useLoader(async () => {
    const today = localToday();
    const [report, alerts, targetDays, incompleteFood] = await Promise.all([
      getResilienceReport(db, today),
      getExpiryAlerts(db, today),
      loadTargetDays(db),
      countIncompleteFood(db, today),
    ]);
    return { today, report, alerts, targetDays, incompleteFood };
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
  const { today, report, alerts, targetDays, incompleteFood } = data;
  const status = autonomyStatus(report.days, targetDays);
  const limiting = report.limitingFactor === 'water' ? 'eau' : 'vivres';
  // Aucun vivre compté : le dire, plutôt qu'une date d'épuisement.
  const noFood =
    report.limitingFactor === 'food' && report.food.available === 0;
  const members = report.household.members;
  const changeMembers = async (delta: number) => {
    await saveHousehold(db, { ...report.household, members: members + delta });
    await reload();
  };

  return (
    <ScrollView contentContainerStyle={styles.page}>
      <View style={styles.hero}>
        <Backdrop svg={TOPOGRAPHIC_SVG} opacity={0.55} />
        <AutonomyGauge
          days={report.days}
          targetDays={targetDays}
          color={status.tone === 'danger' ? colors.danger : colors.primary}
        />
        <View style={styles.heroFoot}>
          <StatusChip tone={status.tone} label={status.label} />
          <Text style={text.muted}>objectif {targetDays} j</Text>
        </View>
      </View>

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

const styles = StyleSheet.create({
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
    backgroundColor: tint(colors.primary, '12'),
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
    backgroundColor: tint(colors.food, '12'),
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
