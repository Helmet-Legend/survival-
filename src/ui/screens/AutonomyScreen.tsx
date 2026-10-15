/** Autonomie du foyer (eau, vivres) et alertes de péremption. */
import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { addDays, localToday } from '../../lib/dates';
import {
  getExpiryAlerts,
  getResilienceReport,
  saveHousehold,
  type ResourceAutonomy,
} from '../../resilience/resilienceCalculator';
import { Button, Notice } from '../components/controls';
import {
  BUCKET_LABELS,
  formatDate,
  formatNumber,
  formatRelativeDays,
  UNIT_LABELS,
} from '../format';
import { useSession } from '../session';
import { colors, fonts, space, text } from '../theme';
import { useLoader } from '../useLoader';

const MAX_MEMBERS = 12;

export function AutonomyScreen() {
  const { db } = useSession();
  const { data, error, reload } = useLoader(async () => {
    const today = localToday();
    const [report, alerts] = await Promise.all([
      getResilienceReport(db, today),
      getExpiryAlerts(db, today),
    ]);
    return { today, report, alerts };
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
  const { today, report, alerts } = data;

  const changeMembers = async (delta: number) => {
    await saveHousehold(db, {
      ...report.household,
      members: report.household.members + delta,
    });
    await reload();
  };

  const scale = Math.max(report.water.naiveDays, report.food.naiveDays, 1);

  return (
    <ScrollView contentContainerStyle={styles.page}>
      <View>
        <Text style={text.label}>Autonomie du foyer</Text>
        <View style={styles.big}>
          <Text
            style={styles.bigNumber}
            accessibilityLabel={`${report.days} jours`}
          >
            {report.days}
          </Text>
          <Text style={styles.bigUnit}>jours</Text>
        </View>
        <Text style={text.dim}>
          Limitée par{' '}
          {report.limitingFactor === 'water' ? 'l’eau' : 'les vivres'}. Stock
          épuisé le {formatDate(addDays(today, report.days))}.
        </Text>
      </View>

      <View style={styles.household}>
        <Text style={text.label}>Foyer</Text>
        <View style={styles.stepper}>
          <Button
            label="−"
            accessibilityLabel="Retirer une personne"
            disabled={report.household.members <= 1}
            onPress={() => {
              void changeMembers(-1);
            }}
          />
          <Text style={[text.mono, styles.members]}>
            {report.household.members} pers.
          </Text>
          <Button
            label="+"
            accessibilityLabel="Ajouter une personne"
            disabled={report.household.members >= MAX_MEMBERS}
            onPress={() => {
              void changeMembers(1);
            }}
          />
        </View>
      </View>

      <Resource
        label="Eau"
        unit="L"
        resource={report.water}
        scale={scale}
        decimals={1}
      />
      <Resource
        label="Vivres"
        unit="kcal"
        resource={report.food}
        scale={scale}
        decimals={0}
      />
      <Text style={text.dim}>
        Barre orange : autonomie réelle. Barre grise : formule simple, sans
        tenir compte des péremptions.
      </Text>

      <View>
        <Text style={[text.title, styles.sectionTitle]}>Péremptions</Text>
        {alerts.length === 0 ? (
          <Text style={text.dim}>
            Aucune péremption dans les 90 prochains jours.
          </Text>
        ) : (
          alerts.map(alert => (
            <View key={alert.lotId} style={styles.alert}>
              <Text
                style={[styles.chip, { color: BUCKET_COLORS[alert.bucket] }]}
              >
                {BUCKET_LABELS[alert.bucket]}
              </Text>
              <View style={styles.alertBody}>
                <Text style={text.body}>
                  {alert.itemName}
                  {alert.isCritical ? (
                    <Text style={styles.critical}> ●</Text>
                  ) : null}
                </Text>
                <Text style={text.dim}>
                  {formatNumber(alert.quantity)} {UNIT_LABELS[alert.unit]} ·{' '}
                  {formatRelativeDays(alert.daysLeft)}
                </Text>
              </View>
            </View>
          ))
        )}
      </View>
    </ScrollView>
  );
}

const BUCKET_COLORS = {
  expired: colors.danger,
  within30: colors.amber,
  within60: colors.warn,
  within90: colors.dim,
} as const;

function Resource(props: {
  label: string;
  unit: string;
  resource: ResourceAutonomy;
  scale: number;
  decimals: number;
}) {
  const r = props.resource;
  const fmt = (n: number) => formatNumber(n, props.decimals);
  return (
    <View style={styles.resource}>
      <View style={styles.resourceHead}>
        <Text style={text.label}>{props.label}</Text>
        <Text style={styles.resourceDays}>{r.days} j</Text>
      </View>
      <View style={styles.gauge}>
        <View
          style={[
            styles.gaugeNaive,
            { width: `${(r.naiveDays / props.scale) * 100}%` },
          ]}
        />
        <View
          style={[
            styles.gaugeReal,
            { width: `${(r.days / props.scale) * 100}%` },
          ]}
        />
      </View>
      <View style={styles.facts}>
        <Fact label="Disponible" value={`${fmt(r.available)} ${props.unit}`} />
        <Fact
          label="Besoin du foyer"
          value={`${fmt(r.dailyNeed)} ${props.unit}/j`}
        />
        <Fact label="Formule simple" value={`${formatNumber(r.naiveDays)} j`} />
        <Fact
          label="Perdu (péremption)"
          value={`${fmt(r.wasted)} ${props.unit}`}
        />
      </View>
    </View>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.fact}>
      <Text style={text.dim}>{label}</Text>
      <Text style={text.mono}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { padding: space.l, gap: space.l },
  big: { flexDirection: 'row', alignItems: 'baseline', gap: space.s },
  bigNumber: {
    color: colors.amber,
    fontFamily: fonts.display,
    fontSize: 104,
    fontWeight: '700',
    lineHeight: 110,
    fontVariant: ['tabular-nums'],
  },
  bigUnit: { ...text.title, fontSize: 28 },
  household: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: space.s,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: colors.line,
  },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: space.s },
  members: { minWidth: 64, textAlign: 'center' },
  resource: { gap: space.s },
  resourceHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
  },
  resourceDays: { ...text.title, fontSize: 26, fontWeight: '700' },
  gauge: {
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.raise,
    overflow: 'hidden',
  },
  gaugeNaive: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    backgroundColor: colors.faint,
  },
  gaugeReal: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    backgroundColor: colors.amber,
  },
  facts: { flexDirection: 'row', flexWrap: 'wrap', rowGap: space.s },
  fact: { width: '50%', gap: 2 },
  sectionTitle: { marginBottom: space.s },
  alert: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.m,
    paddingVertical: space.s,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  chip: {
    minWidth: 70,
    textAlign: 'center',
    fontFamily: fonts.display,
    fontSize: 13,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 6,
    paddingVertical: 3,
    paddingHorizontal: 6,
  },
  alertBody: { flex: 1 },
  critical: { color: colors.danger, fontSize: 11 },
});
