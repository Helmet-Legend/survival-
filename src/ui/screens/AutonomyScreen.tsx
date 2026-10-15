/**
 * Tableau de bord : autonomie face à l'objectif, eau et vivres, liste de
 * réapprovisionnement, péremptions et réglages du foyer.
 */
import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { addDays, localToday } from '../../lib/dates';
import {
  getExpiryAlerts,
  getResilienceReport,
  loadTargetDays,
  saveHousehold,
  saveTargetDays,
  type ResourceAutonomy,
} from '../../resilience/resilienceCalculator';
import { getRestockPlan } from '../../resilience/restock';
import {
  Gauge,
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
  nextTarget,
  UNIT_LABELS,
} from '../format';
import { useSession } from '../session';
import { colors, fonts, space, text, toneColor } from '../theme';
import { useLoader } from '../useLoader';

const MAX_MEMBERS = 12;

export function AutonomyScreen() {
  const { db } = useSession();
  const { data, error, reload } = useLoader(async () => {
    const today = localToday();
    const [report, alerts, restock, targetDays] = await Promise.all([
      getResilienceReport(db, today),
      getExpiryAlerts(db, today),
      getRestockPlan(db, today),
      loadTargetDays(db),
    ]);
    return { today, report, alerts, restock, targetDays };
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
  const { today, report, alerts, restock, targetDays } = data;
  const status = autonomyStatus(report.days, targetDays);
  const statusColor = toneColor[status.tone];

  const changeMembers = async (delta: number) => {
    await saveHousehold(db, {
      ...report.household,
      members: report.household.members + delta,
    });
    await reload();
  };
  const changeTarget = async (direction: 1 | -1) => {
    await saveTargetDays(db, nextTarget(targetDays, direction));
    await reload();
  };

  // Marge de 15 % au-delà de l'objectif : son repère reste visible sur la jauge.
  const scale = Math.max(
    targetDays * 1.15,
    report.water.naiveDays,
    report.food.naiveDays,
    1,
  );

  return (
    <ScrollView contentContainerStyle={styles.page}>
      {/* Autonomie globale face à l'objectif */}
      <Panel
        title="Autonomie du foyer"
        right={<StatusChip tone={status.tone} label={status.label} />}
      >
        <View style={styles.big}>
          <Text
            style={[styles.bigNumber, { color: statusColor }]}
            accessibilityLabel={`${report.days} jours`}
          >
            {report.days}
          </Text>
          <View>
            <Text style={styles.bigUnit}>jours</Text>
            <Text style={text.dim}>objectif {targetDays} j</Text>
          </View>
        </View>
        <Gauge
          value={report.days / scale}
          marker={targetDays / scale}
          color={statusColor}
          height={10}
        />
        <Text style={text.dim}>
          Limitée par{' '}
          {report.limitingFactor === 'water' ? 'l’eau' : 'les vivres'} · stock
          épuisé le {formatDate(addDays(today, report.days))}
        </Text>
      </Panel>

      {/* Eau et vivres */}
      <View style={styles.tiles}>
        <ResourceTile
          label="Eau"
          color={colors.water}
          resource={report.water}
          unit="L"
          decimals={1}
          scale={scale}
        />
        <ResourceTile
          label="Vivres"
          color={colors.food}
          resource={report.food}
          unit="kcal"
          decimals={0}
          scale={scale}
        />
      </View>
      <Text style={styles.legend}>
        Barre claire : autonomie réelle. Barre grise : formule simple, sans les
        péremptions.
      </Text>

      {/* Réapprovisionnement */}
      <Panel
        title={`À racheter pour ${targetDays} j`}
        right={
          restock.complete ? <StatusChip tone="ok" label="Complet" /> : null
        }
      >
        {restock.complete ? (
          <Text style={text.dim}>
            Le stock couvre l’objectif de {targetDays} jours pour{' '}
            {report.household.members} personne
            {report.household.members > 1 ? 's' : ''}.
          </Text>
        ) : null}
        {restock.water.missing > 0 ? (
          <RestockLine
            color={colors.water}
            label="Eau"
            amount={`+${formatNumber(restock.water.missing)} L`}
            detail={`couvert : ${restock.water.coveredDays} j sur ${targetDays}`}
          />
        ) : null}
        {restock.food.missing > 0 ? (
          <RestockLine
            color={colors.food}
            label="Vivres"
            amount={`+${formatNumber(restock.food.missing, 0)} kcal`}
            detail={`≈ ${formatNumber(
              restock.food.missing / report.household.kcalPerPersonDay,
            )} jours-personne · couvert : ${restock.food.coveredDays} j`}
          />
        ) : null}
        {restock.items.map(item => (
          <RestockLine
            key={item.itemId}
            color={item.isCritical ? colors.danger : colors.dim}
            label={item.name}
            amount={`+${formatNumber(item.missing)} ${UNIT_LABELS[item.unit]}`}
            detail={`minimum ${formatNumber(
              item.minStock,
            )}, en stock ${formatNumber(item.usable)}`}
          />
        ))}
      </Panel>

      {/* Péremptions */}
      <Panel
        title="Péremptions"
        right={
          alerts.length > 0 ? (
            <Text style={text.dim}>{alerts.length}</Text>
          ) : null
        }
      >
        {alerts.length === 0 ? (
          <Text style={text.dim}>
            Aucune péremption dans les 90 prochains jours.
          </Text>
        ) : (
          alerts.map(alert => (
            <View key={alert.lotId} style={styles.alert}>
              <StatusChip
                tone={BUCKET_TONES[alert.bucket]}
                label={BUCKET_LABELS[alert.bucket]}
              />
              <View style={styles.grow}>
                <Text style={text.body}>
                  {alert.itemName}
                  {alert.isCritical ? (
                    <Text style={styles.critical}> ● critique</Text>
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
      </Panel>

      {/* Réglages du foyer */}
      <Panel title="Foyer">
        <View style={styles.settingRow}>
          <Text style={text.body}>Personnes</Text>
          <Stepper
            value={`${report.household.members} pers.`}
            onDecrease={() => {
              void changeMembers(-1);
            }}
            onIncrease={() => {
              void changeMembers(1);
            }}
            canDecrease={report.household.members > 1}
            canIncrease={report.household.members < MAX_MEMBERS}
            decreaseLabel="Retirer une personne"
            increaseLabel="Ajouter une personne"
          />
        </View>
        <View style={styles.settingRow}>
          <Text style={text.body}>Objectif</Text>
          <Stepper
            value={`${targetDays} j`}
            onDecrease={() => {
              void changeTarget(-1);
            }}
            onIncrease={() => {
              void changeTarget(1);
            }}
            canDecrease={nextTarget(targetDays, -1) !== targetDays}
            canIncrease={nextTarget(targetDays, 1) !== targetDays}
            decreaseLabel="Réduire l’objectif"
            increaseLabel="Augmenter l’objectif"
          />
        </View>
        <Text style={text.dim}>
          Besoins par personne :{' '}
          {formatNumber(report.household.waterLitersPerPersonDay)} L d’eau et{' '}
          {formatNumber(report.household.kcalPerPersonDay, 0)} kcal par jour.
        </Text>
      </Panel>
    </ScrollView>
  );
}

function ResourceTile(props: {
  label: string;
  color: string;
  resource: ResourceAutonomy;
  unit: string;
  decimals: number;
  scale: number;
}) {
  const r = props.resource;
  const fmt = (n: number) => formatNumber(n, props.decimals);
  return (
    <View style={[styles.tile, { borderTopColor: props.color }]}>
      <Text style={[text.label, { color: props.color }]}>{props.label}</Text>
      <Text style={styles.tileDays}>
        {r.days}
        <Text style={styles.tileUnit}> j</Text>
      </Text>
      <Gauge
        value={r.days / props.scale}
        secondary={r.naiveDays / props.scale}
        color={props.color}
      />
      <View style={styles.tileFacts}>
        <Text style={text.dim}>Stock</Text>
        <Text style={text.mono}>
          {fmt(r.available)} {props.unit}
        </Text>
        <Text style={text.dim}>Besoin / jour</Text>
        <Text style={text.mono}>
          {fmt(r.dailyNeed)} {props.unit}
        </Text>
      </View>
      <Text style={styles.tileNote}>
        {formatNumber(r.naiveDays)} j sans les péremptions
        {r.wasted > 0 ? ` · ${fmt(r.wasted)} ${props.unit} perdus` : ''}
      </Text>
    </View>
  );
}

function RestockLine(props: {
  color: string;
  label: string;
  amount: string;
  detail: string;
}) {
  return (
    <View style={styles.restock}>
      <View style={[styles.restockDot, { backgroundColor: props.color }]} />
      <View style={styles.grow}>
        <Text style={text.body}>{props.label}</Text>
        <Text style={text.dim}>{props.detail}</Text>
      </View>
      <Text style={[text.mono, styles.restockAmount]}>{props.amount}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { padding: space.l, gap: space.m, paddingBottom: space.xl },
  big: { flexDirection: 'row', alignItems: 'flex-end', gap: space.m },
  bigNumber: {
    fontFamily: fonts.display,
    fontSize: 96,
    fontWeight: '700',
    lineHeight: 100,
    fontVariant: ['tabular-nums'],
  },
  bigUnit: { ...text.title, fontSize: 28 },
  tiles: { flexDirection: 'row', gap: space.m },
  tile: {
    flex: 1,
    minWidth: 0,
    backgroundColor: colors.panel,
    borderColor: colors.line,
    borderWidth: 1,
    borderTopWidth: 3,
    borderRadius: 14,
    padding: space.m,
    gap: space.s,
  },
  tileDays: {
    color: colors.text,
    fontFamily: fonts.display,
    fontSize: 40,
    fontWeight: '700',
    lineHeight: 44,
  },
  tileUnit: { fontSize: 20, color: colors.dim },
  tileFacts: { gap: 2 },
  tileNote: { color: colors.faint, fontSize: 13, lineHeight: 17 },
  legend: { color: colors.faint, fontSize: 13, paddingHorizontal: space.xs },
  restock: { flexDirection: 'row', alignItems: 'center', gap: space.m },
  restockDot: { width: 10, height: 10, borderRadius: 5 },
  restockAmount: { fontSize: 16, fontWeight: '700' },
  alert: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.m,
    paddingTop: space.s,
    borderTopWidth: 1,
    borderTopColor: colors.line,
  },
  grow: { flex: 1, minWidth: 0 },
  critical: { color: colors.danger, fontSize: 13 },
  settingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: space.m,
  },
});
