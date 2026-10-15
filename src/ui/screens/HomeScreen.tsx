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
  Wheat,
} from 'lucide-react-native';
import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { addDays, localToday } from '../../lib/dates';
import {
  getExpiryAlerts,
  getResilienceReport,
  loadTargetDays,
} from '../../resilience/resilienceCalculator';
import { AutonomyGauge } from '../components/AutonomyGauge';
import {
  Backdrop,
  Button,
  MetricCard,
  Notice,
  StatusChip,
} from '../components/controls';
import { TOPOGRAPHIC_SVG } from '../assets/backgrounds';
import { autonomyStatus, formatDate, formatNumber } from '../format';
import { useNavigation } from '../navigation';
import { useSession } from '../session';
import { colors, radius, sizes, space, text, tint } from '../theme';
import { useLoader } from '../useLoader';

export function HomeScreen() {
  const { db } = useSession();
  const navigation = useNavigation();
  const { data, error } = useLoader(async () => {
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

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Ressource limitante : ${limiting}. Ouvrir le plan d’action`}
        onPress={() => navigation.open('plan')}
        style={({ pressed }) => [styles.limiting, pressed && styles.pressed]}
      >
        {report.limitingFactor === 'water' ? (
          <Droplet color={colors.cyan} size={20} strokeWidth={2} />
        ) : (
          <Wheat color={colors.food} size={20} strokeWidth={2} />
        )}
        <View style={styles.grow}>
          <Text style={styles.limitingText}>
            Ressource limitante : {limiting}
          </Text>
          <Text style={text.subtle}>
            Stock épuisé le {formatDate(addDays(today, report.days))}
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
