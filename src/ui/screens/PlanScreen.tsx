/**
 * Plan d'action : objectif d'autonomie, liste de réapprovisionnement,
 * péremptions et détail du calcul pour l'eau et les vivres.
 */
import { Calculator, CalendarClock, ShoppingCart } from 'lucide-react-native';
import React, { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { localToday } from '../../lib/dates';
import { computeEnergy, loadEnergyNeed } from '../../resilience/energy';
import { SCENARIOS } from '../../resilience/scenarios';
import {
  computeResilience,
  getExpiryAlerts,
  getResilienceReport,
  loadConsumableLots,
  loadTargetDays,
  saveTargetDays,
  type ResourceAutonomy,
} from '../../resilience/resilienceCalculator';
import { getRestockPlan } from '../../resilience/restock';
import {
  Button,
  Chip,
  Gauge,
  Notice,
  Panel,
  ScreenTitle,
  StatusChip,
  Stepper,
} from '../components/controls';
import {
  autonomyStatus,
  BUCKET_LABELS,
  BUCKET_TONES,
  formatNumber,
  formatRelativeDays,
  nextTarget,
  UNIT_LABELS,
} from '../format';
import { useNavigation } from '../navigation';
import { useSession } from '../session';
import { colors, fonts, radius, sizes, space, text } from '../theme';
import { useLoader } from '../useLoader';

export function PlanScreen() {
  const { db, repo } = useSession();
  const navigation = useNavigation();
  const [scenarioId, setScenarioId] = useState('normal');
  const { data, error, reload } = useLoader(async () => {
    const today = localToday();
    const [report, alerts, restock, targetDays, lots, items, whPerPerson] =
      await Promise.all([
        getResilienceReport(db, today),
        getExpiryAlerts(db, today),
        getRestockPlan(db, today),
        loadTargetDays(db),
        loadConsumableLots(db),
        repo.listItems({ bag: 'none' }),
        loadEnergyNeed(db),
      ]);
    return {
      today,
      report,
      alerts,
      restock,
      targetDays,
      lots,
      items,
      whPerPerson,
    };
  });

  const title = (
    <ScreenTitle
      title="Plan d’action"
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
  const {
    today,
    report,
    alerts,
    restock,
    targetDays,
    lots,
    items,
    whPerPerson,
  } = data;
  const scenario = SCENARIOS.find(s => s.id === scenarioId) ?? SCENARIOS[0];
  const simulated = computeResilience(
    lots,
    scenario.apply(report.household),
    today,
  );
  const energy = computeEnergy(
    items,
    simulated.household.members,
    whPerPerson * (scenario.energyFactor ?? 1),
  );
  const status = autonomyStatus(report.days, targetDays);

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
      {title}

      {/* Objectif */}
      <Panel
        title="Objectif d’autonomie"
        right={<StatusChip tone={status.tone} label={status.label} />}
      >
        <View style={styles.settingRow}>
          <Text style={[text.body, styles.grow]}>
            {report.days} j<Text style={text.muted}> aujourd’hui</Text>
          </Text>
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
      </Panel>

      <Button
        icon={Calculator}
        chevron
        label="Calculateurs eau et électricité"
        onPress={() => navigation.open('calculators')}
      />

      {/* Scénarios */}
      <Panel title="Scénarios de consommation">
        <View style={styles.chips}>
          {SCENARIOS.map(s => (
            <Chip
              key={s.id}
              label={s.label}
              selected={s.id === scenario.id}
              onPress={() => setScenarioId(s.id)}
            />
          ))}
        </View>
        <Text style={text.subtle}>{scenario.hint}</Text>
        <ScenarioRow
          label="Eau"
          color={colors.water}
          days={simulated.water.days}
          need={`${formatNumber(simulated.water.dailyNeed)} L / jour`}
          limiting={simulated.limitingFactor === 'water'}
        />
        <ScenarioRow
          label="Vivres"
          color={colors.food}
          days={simulated.food.days}
          need={`${formatNumber(simulated.food.dailyNeed, 0)} kcal / jour`}
          limiting={simulated.limitingFactor === 'food'}
        />
        <ScenarioRow
          label="Énergie"
          color={colors.energy}
          days={energy.days}
          need={`${formatNumber(energy.dailyNeed, 0)} Wh / jour`}
          limiting={false}
        />
        <Text style={text.muted}>
          Autonomie du foyer dans ce scénario : {simulated.days} j (
          {simulated.limitingFactor === 'water' ? 'eau' : 'vivres'} limitante
          {simulated.limitingFactor === 'water' ? '' : 's'}).
        </Text>
        {energy.days === null && energy.unknown.length === 0 ? (
          <Text style={text.subtle}>
            Énergie : aucune capacité renseignée. Indiquez-la en Wh (ou en mAh
            pour une batterie externe) dans les fiches Énergie.
          </Text>
        ) : null}
        {energy.unknown.length > 0 ? (
          <Text style={text.subtle}>
            Capacité inconnue, non comptée : {energy.unknown.join(', ')}.
            Indiquez-la en Wh (ou en mAh pour une batterie externe) dans la
            fiche.
          </Text>
        ) : null}
        {energy.fuels.length > 0 ? (
          <Text style={text.subtle}>
            Combustibles en stock, non convertis en jours (consommation propre à
            chaque appareil) :{' '}
            {energy.fuels
              .map(
                f =>
                  `${f.name} ${formatNumber(f.quantity)} ${
                    UNIT_LABELS[f.unit]
                  }`,
              )
              .join(', ')}
            .
          </Text>
        ) : null}
      </Panel>

      {/* Réapprovisionnement */}
      <Panel
        title={`À racheter pour ${targetDays} j`}
        right={
          restock.complete ? (
            <StatusChip tone="ok" label="Complet" />
          ) : (
            <ShoppingCart color={colors.primary} size={20} />
          )
        }
      >
        {restock.complete ? (
          <Text style={text.muted}>
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
            label="Nourriture"
            amount={`+${formatNumber(restock.food.missing, 0)} kcal`}
            detail={`≈ ${formatNumber(
              restock.food.missing / report.household.kcalPerPersonDay,
            )} jours-personne · couvert : ${restock.food.coveredDays} j`}
          />
        ) : null}
        {restock.items.map(item => (
          <RestockLine
            key={item.itemId}
            color={item.isCritical ? colors.danger : colors.textMuted}
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
            <Text style={text.muted}>{alerts.length}</Text>
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
                <Text style={text.muted}>
                  {formatNumber(alert.quantity)} {UNIT_LABELS[alert.unit]} ·{' '}
                  {formatRelativeDays(alert.daysLeft)}
                  {alert.bagName ? ` · ${alert.bagName}` : ''}
                </Text>
              </View>
            </View>
          ))
        )}
      </Panel>

      {/* Détail du calcul */}
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
          label="Nourriture"
          color={colors.food}
          resource={report.food}
          unit="kcal"
          decimals={0}
          scale={scale}
        />
      </View>
      <Text style={text.subtle}>
        Barre colorée : autonomie réelle. Barre bleue : formule simple, sans les
        péremptions.
      </Text>
    </ScrollView>
  );
}

function ScenarioRow(props: {
  label: string;
  color: string;
  days: number | null;
  need: string;
  limiting: boolean;
}) {
  return (
    <View style={styles.scenarioRow}>
      <View style={[styles.dot, { backgroundColor: props.color }]} />
      <View style={styles.grow}>
        <Text style={text.body}>
          {props.label}
          {props.limiting ? (
            <Text style={styles.limitingMark}> · limitant</Text>
          ) : null}
        </Text>
        <Text style={text.subtle}>{props.need}</Text>
      </View>
      <Text style={styles.scenarioDays}>
        {props.days === null ? '—' : `${props.days} j`}
      </Text>
    </View>
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
        <Text style={text.subtle}>Stock</Text>
        <Text style={text.mono}>
          {fmt(r.available)} {props.unit}
        </Text>
        <Text style={text.subtle}>Besoin / jour</Text>
        <Text style={text.mono}>
          {fmt(r.dailyNeed)} {props.unit}
        </Text>
      </View>
      <Text style={text.subtle}>
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
        <Text style={text.subtle}>{props.detail}</Text>
      </View>
      <Text style={[text.mono, styles.restockAmount]}>{props.amount}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.s },
  scenarioRow: { flexDirection: 'row', alignItems: 'center', gap: space.m },
  dot: { width: 10, height: 10, borderRadius: 5 },
  scenarioDays: { ...text.value, fontSize: 20, color: colors.text },
  limitingMark: { color: colors.warning, fontSize: 13, fontWeight: '700' },
  page: {
    paddingHorizontal: sizes.screenPadding,
    paddingBottom: space.xl,
    gap: space.m,
  },
  tiles: { flexDirection: 'row', gap: space.m },
  tile: {
    flex: 1,
    minWidth: 0,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderTopWidth: 3,
    borderRadius: radius.card,
    padding: space.m,
    gap: space.s,
  },
  tileDays: {
    color: colors.text,
    fontFamily: fonts.display,
    fontSize: 36,
    fontWeight: '800',
    lineHeight: 40,
  },
  tileUnit: { fontSize: 18, color: colors.textMuted },
  tileFacts: { gap: 2 },
  restock: { flexDirection: 'row', alignItems: 'center', gap: space.m },
  restockDot: { width: 10, height: 10, borderRadius: 5 },
  restockAmount: { fontSize: 16, fontWeight: '700', color: colors.primary },
  alert: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.m,
    paddingTop: space.s,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  grow: { flex: 1, minWidth: 0 },
  critical: { color: colors.danger, fontSize: 13 },
  settingRow: { flexDirection: 'row', alignItems: 'center', gap: space.m },
});
