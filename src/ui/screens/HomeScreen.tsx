/**
 * Accueil : jauge d'autonomie du foyer, ressource limitante, eau, vivres,
 * cartographie et péremptions, accès au plan d'action.
 */
import {
  CalendarClock,
  ChevronRight,
  ClipboardList,
  Droplet,
  MapPinned,
  Users,
  Wheat,
} from 'lucide-react-native';
import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { addDays, localToday } from '../../lib/dates';
import {
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
  StatusChip,
  Stepper,
} from '../components/controls';
import { TOPOGRAPHIC_SVG } from '../assets/backgrounds';
import { autonomyStatus, formatDate, formatNumber } from '../format';
import { useNavigation } from '../navigation';
import { useSession } from '../session';
import { colors, radius, sizes, space, text, tint } from '../theme';
import { useLoader } from '../useLoader';

/** Même borne que dans les Réglages. */
const MAX_MEMBERS = 12;

export function HomeScreen() {
  const { db } = useSession();
  const navigation = useNavigation();
  const { data, error, reload } = useLoader(async () => {
    const today = localToday();
    const [report, alerts, targetDays] = await Promise.all([
      getResilienceReport(db, today),
      getExpiryAlerts(db, today),
      loadTargetDays(db),
    ]);
    return { today, report, alerts, targetDays };
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
  const { today, report, alerts, targetDays } = data;
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
  const urgent = alerts.filter(
    a => a.bucket === 'expired' || a.bucket === 'within30',
  ).length;

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
          <Text style={text.subtle}>Personnes à faire tenir</Text>
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
          noFood ? navigation.goTo('stock') : navigation.open('plan')
        }
        style={({ pressed }) => [styles.limiting, pressed && styles.pressed]}
      >
        {report.limitingFactor === 'water' ? (
          <Droplet color={colors.cyan} size={20} strokeWidth={2} />
        ) : (
          <Wheat color={colors.food} size={20} strokeWidth={2} />
        )}
        <View style={styles.grow}>
          <Text style={styles.limitingText}>
            {noFood
              ? 'Aucun vivre compté'
              : `Ressource limitante : ${limiting}`}
          </Text>
          <Text style={text.subtle}>
            {noFood
              ? `Ajoutez vos vivres dans Stocks › Vivres. L’eau seule couvre ${report.water.days} j.`
              : `Stock épuisé le ${formatDate(addDays(today, report.days))}`}
          </Text>
        </View>
        <ChevronRight color={colors.text} size={20} />
      </Pressable>

      <View style={styles.grid}>
        <MetricCard
          icon={Droplet}
          color={colors.water}
          label="Eau disponible"
          value={formatNumber(report.water.available)}
          unit="L"
          caption={`${report.water.days} j d’autonomie`}
          onPress={() => navigation.goTo('stock')}
        />
        <MetricCard
          icon={Wheat}
          color={colors.food}
          label="Réserves alimentaires"
          value={formatNumber(report.food.available, 0)}
          unit="kcal"
          caption={`${report.food.days} j d’autonomie`}
          onPress={() => navigation.goTo('stock')}
        />
      </View>
      <View style={styles.grid}>
        <MetricCard
          icon={MapPinned}
          color={colors.success}
          label="Cartographie"
          value="Hors ligne"
          caption="Coordonnées & azimuts"
          onPress={() => navigation.goTo('map')}
        />
        <MetricCard
          icon={CalendarClock}
          color={colors.purple}
          label="Péremptions"
          value={alerts.length === 0 ? 'Aucune' : String(alerts.length)}
          caption={
            alerts.length === 0
              ? 'dans les 90 jours'
              : urgent > 0
              ? `dont ${urgent} sous 30 j`
              : 'lots à surveiller'
          }
          onPress={() => navigation.open('plan')}
        />
      </View>

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
  limitingText: { color: colors.cyanSoft, fontSize: 15, fontWeight: '600' },
  pressed: { opacity: 0.82 },
  grow: { flex: 1, minWidth: 0 },
  grid: { flexDirection: 'row', gap: space.m },
});
