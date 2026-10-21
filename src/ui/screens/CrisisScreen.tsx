/**
 * Simulateur de crise : un scénario déroulé jour par jour sur le stock réel,
 * avec les hypothèses affichées, un bilan des manques et les fiches utiles.
 * Le stock n'est jamais modifié.
 */
import { AlertTriangle, BookOpen, CheckCircle2 } from 'lucide-react-native';
import React, { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import type { ItemCategory } from '../../inventory';
import { localToday } from '../../lib/dates';
import {
  CRISES,
  crisisById,
  simulateCrisis,
  type CrisisDay,
  type CrisisId,
  type CrisisLink,
  type CrisisResult,
  type ResourceDay,
  type ResourceOutcome,
} from '../../plan/crisis';
import {
  addCrisisShortfalls,
  type CrisisShortfall,
} from '../../plan/purchasePlan';
import { computeEnergy, loadEnergyNeed } from '../../resilience/energy';
import { syncReminders } from '../../resilience/reminders';
import {
  adultsOf,
  loadConsumableLots,
  loadHousehold,
} from '../../resilience/resilienceCalculator';
import {
  Button,
  Chip,
  Notice,
  Panel,
  ScreenTitle,
} from '../components/controls';
import { formatDate, formatNumber } from '../format';
import { useNavigation } from '../navigation';
import { useSession } from '../session';
import { colors, fonts, space, sizes, text } from '../theme';
import { useLoader } from '../useLoader';
import { GuideReader } from './GuidesScreen';

const plural = (n: number, word: string) => `${n} ${word}${n > 1 ? 's' : ''}`;

const formatWater = (liters: number) => `${formatNumber(liters)} L`;
const formatKcal = (kcal: number) => `${formatNumber(kcal, 0)} kcal`;
const formatWh = (wh: number) => `${formatNumber(wh, 0)} Wh`;

export function CrisisScreen() {
  const { db, repo, bags, documents, reminders } = useSession();
  const navigation = useNavigation();
  const [crisisId, setCrisisId] = useState<CrisisId>('blackout');
  const scenario = crisisById(crisisId);
  const [days, setDays] = useState(scenario.defaultDays);
  const [bagId, setBagId] = useState<string | null>(null);
  const [guideSlug, setGuideSlug] = useState<string | null>(null);
  const [planned, setPlanned] = useState<{
    tone: 'ok' | 'error';
    message: string;
  } | null>(null);

  const addToPlan = async (result: CrisisResult) => {
    const crisis = `${scenario.label.toLowerCase()} de ${plural(days, 'jour')}`;
    const shortfalls: CrisisShortfall[] = [];
    if (result.water.missing > 0) {
      shortfalls.push({ kind: 'water', amount: result.water.missing, crisis });
    }
    if (result.food.missing > 0) {
      shortfalls.push({ kind: 'food', amount: result.food.missing, crisis });
    }
    if (result.energy && result.energy.missing > 0) {
      shortfalls.push({
        kind: 'energy',
        amount: result.energy.missing,
        crisis,
      });
    }
    try {
      const [items, bagList, docs] = await Promise.all([
        repo.listItems({ bag: 'none' }),
        bags.list(),
        documents.list(),
      ]);
      const { alreadyPlanned } = await addCrisisShortfalls(
        db,
        {
          items,
          bags: bagList,
          documentCount: docs.length,
          asOf: localToday(),
        },
        shortfalls,
      );
      await syncReminders(db, reminders);
      const added = shortfalls.length - alreadyPlanned.length;
      setPlanned({
        tone: 'ok',
        message:
          added === 0
            ? 'Ces manques sont déjà couverts par les achats prévus.'
            : `Ajouté au plan d’achats et réparti sur les mois à venir${
                alreadyPlanned.length > 0 ? ' (le reste était déjà prévu)' : ''
              }.`,
      });
    } catch (e) {
      setPlanned({
        tone: 'error',
        message: e instanceof Error ? e.message : String(e),
      });
    }
  };

  const { data: bagList } = useLoader(() => bags.list());
  const chosenBag = scenario.usesBag
    ? bagList?.find(b => b.id === bagId) ?? bagList?.[0] ?? null
    : null;
  const bagKey = chosenBag?.id;

  const { data, error } = useLoader(async () => {
    if (scenario.usesBag && bagKey === undefined) {
      return null;
    }
    const [household, lots, items, whPerPersonDay] = await Promise.all([
      loadHousehold(db),
      loadConsumableLots(db, bagKey),
      repo.listItems({ bag: bagKey ?? 'none' }),
      loadEnergyNeed(db),
    ]);
    // Le calcul d'énergie ne compte que le stock général : le contenu du
    // sac choisi y est ramené pour l'évacuation.
    const energy = computeEnergy(
      items.map(i => ({ ...i, bagId: null })),
      1,
      whPerPersonDay,
    );
    const today = localToday();
    const incompleteFood = new Set(
      lots
        .filter(
          l =>
            l.category === 'food' &&
            l.caloriesPerUnit === null &&
            (l.expirationDate === null || l.expirationDate >= today),
        )
        .map(l => l.itemId),
    ).size;
    return {
      result: simulateCrisis({
        scenario,
        days,
        household,
        lots,
        usableWh: energy.days === null ? null : energy.usableWh,
        whPerPersonDay,
        lights: energy.lights,
        asOf: today,
      }),
      household,
      whPerPersonDay,
      unknownEnergy: energy.unknown,
      incompleteFood,
    };
  }, [crisisId, days, bagKey, bagList]);

  if (guideSlug !== null) {
    return (
      <GuideReader
        slug={guideSlug}
        onBack={() => setGuideSlug(null)}
        backLabel="Retour à la simulation"
      />
    );
  }

  const openLink = (link: CrisisLink) => {
    if (link.kind === 'guide') {
      setGuideSlug(link.slug);
    } else {
      navigation.open(link.kind);
    }
  };
  const add = (category: ItemCategory, prefill?: Record<string, string>) =>
    navigation.openStockForm({
      category,
      ...(prefill ? { prefill } : {}),
      ...(chosenBag ? { bagId: chosenBag.id } : {}),
    });

  const choose = (id: CrisisId) => {
    setPlanned(null);
    setCrisisId(id);
    setDays(crisisById(id).defaultDays);
  };

  return (
    <ScrollView contentContainerStyle={styles.page}>
      <ScreenTitle
        title="Simulateur de crise"
        onBack={navigation.close}
        backLabel={navigation.backLabel}
      />
      <Panel title="Scénario">
        <View style={styles.chips}>
          {CRISES.map(c => (
            <Chip
              key={c.id}
              label={c.label}
              selected={c.id === crisisId}
              onPress={() => choose(c.id)}
            />
          ))}
        </View>
        <Text style={text.subtle}>{scenario.hint}</Text>
        <Text style={text.label}>Durée</Text>
        <View style={styles.chips}>
          {scenario.durations.map(n => (
            <Chip
              key={n}
              label={plural(n, 'jour')}
              selected={n === days}
              onPress={() => {
                setPlanned(null);
                setDays(n);
              }}
            />
          ))}
        </View>
        {scenario.usesBag && bagList && bagList.length > 0 ? (
          <>
            <Text style={text.label}>Sac</Text>
            <View style={styles.chips}>
              {bagList.map(b => (
                <Chip
                  key={b.id}
                  label={b.name}
                  selected={b.id === chosenBag?.id}
                  onPress={() => setBagId(b.id)}
                />
              ))}
            </View>
          </>
        ) : null}
      </Panel>

      {scenario.usesBag && bagList && bagList.length === 0 ? (
        <Panel>
          <Text style={text.body}>
            Aucun sac d’évacuation : créez-en un pour simuler un départ.
          </Text>
          <Button
            chevron
            label="Ouvrir les sacs"
            onPress={() => navigation.goTo('stock', { category: 'bags' })}
          />
        </Panel>
      ) : null}

      {error ? <Notice tone="error" message={error} /> : null}

      {data ? (
        <>
          <Panel title="Hypothèses">
            <Text style={text.muted}>
              {scenario.usesBag
                ? '1 personne'
                : plural(data.household.members, 'personne')}{' '}
              · {formatNumber(data.household.waterLitersPerPersonDay)} L d’eau
              et {formatNumber(data.household.kcalPerPersonDay, 0)} kcal par{' '}
              {!scenario.usesBag &&
              data.household.members > adultsOf(data.household)
                ? 'adulte'
                : 'personne'}{' '}
              et par jour
              {scenario.noPower
                ? ` · ${formatNumber(
                    data.whPerPersonDay,
                    0,
                  )} Wh par personne et par jour`
                : ''}{' '}
              (réglages du foyer).
            </Text>
            <Text style={text.muted}>
              · Aucun ravitaillement pendant la crise ; l’eau du robinet n’est
              pas comptée.
            </Text>
            {scenario.hypotheses.map(h => (
              <Text key={h} style={text.muted}>
                · {h}
              </Text>
            ))}
            <Text style={text.subtle}>
              Simulation seulement : votre stock n’est pas modifié.
            </Text>
          </Panel>

          <Panel title="Bilan">
            <OutcomeRow
              label="Eau"
              color={colors.water}
              total={days}
              outcome={data.result.water}
              format={formatWater}
              onAdd={() => add('water')}
              addLabel="Ajouter de l’eau"
            />
            <OutcomeRow
              label="Vivres"
              color={colors.food}
              total={days}
              outcome={data.result.food}
              format={formatKcal}
              onAdd={() => add('food')}
              addLabel="Ajouter des vivres"
            />
            {data.result.energy ? (
              <OutcomeRow
                label="Énergie"
                color={colors.energy}
                total={days}
                outcome={data.result.energy}
                format={formatWh}
                onAdd={() =>
                  add('power', {
                    name: 'Batterie externe',
                    subtype: 'powerbank',
                  })
                }
                addLabel="Ajouter une batterie"
              />
            ) : scenario.noPower ? (
              <Text style={text.muted}>
                Énergie : aucune batterie de capacité connue (Wh, ou mAh pour
                une batterie externe) ; elle n’est pas simulée.
              </Text>
            ) : null}
            {data.result.lights &&
            data.result.lights.count < data.result.lights.members ? (
              <View style={styles.missing}>
                <Text style={text.body}>
                  Éclairage : {plural(data.result.lights.count, 'lampe')} pour{' '}
                  {plural(data.result.lights.members, 'personne')}.
                </Text>
                <Button
                  compact
                  label="Ajouter une lampe"
                  onPress={() =>
                    add('energy', {
                      name: 'Lampe frontale',
                      subtype: 'lighting',
                    })
                  }
                />
              </View>
            ) : null}
            {data.incompleteFood > 0 ? (
              <Text style={text.subtle}>
                {plural(data.incompleteFood, 'vivre')} sans calories renseignées
                : non comptés.
              </Text>
            ) : null}
            {data.unknownEnergy.length > 0 ? (
              <Text style={text.subtle}>
                Capacité inconnue, non comptée : {data.unknownEnergy.join(', ')}
                .
              </Text>
            ) : null}
            {!scenario.usesBag &&
            [data.result.water, data.result.food, data.result.energy].some(
              o => o !== null && o.missing > 0,
            ) ? (
              <Button
                variant="primary"
                label="Ajouter les manques au plan d’achats"
                onPress={() => {
                  void addToPlan(data.result);
                }}
              />
            ) : null}
            {planned ? (
              <>
                <Notice {...planned} />
                <Button
                  chevron
                  label="Ouvrir le plan d’achats"
                  onPress={() => navigation.open('purchases')}
                />
              </>
            ) : null}
          </Panel>

          <Text style={[text.label, styles.section]}>Jour par jour</Text>
          {data.result.days.map(d => (
            <DayCard key={d.day} day={d} onLink={openLink} />
          ))}
        </>
      ) : null}
    </ScrollView>
  );
}

function OutcomeRow(props: {
  label: string;
  color: string;
  total: number;
  outcome: ResourceOutcome;
  format: (value: number) => string;
  onAdd: () => void;
  addLabel: string;
}) {
  const { outcome: o } = props;
  const ok = o.firstShortDay === null;
  return (
    <View style={styles.missing}>
      <View style={styles.row}>
        {ok ? (
          <CheckCircle2 color={colors.success} size={20} strokeWidth={2} />
        ) : (
          <AlertTriangle color={colors.danger} size={20} strokeWidth={2} />
        )}
        <Text style={[text.body, styles.grow]}>
          <Text style={{ color: props.color }}>{props.label}</Text> :{' '}
          {ok
            ? `tient les ${plural(props.total, 'jour')}`
            : `manque dès le jour ${o.firstShortDay} · ${props.format(
                o.missing,
              )} à prévoir`}
        </Text>
      </View>
      <Text style={text.subtle}>
        Besoin : {props.format(o.dailyNeed)} par jour.
      </Text>
      {ok ? null : (
        <Button compact label={props.addLabel} onPress={props.onAdd} />
      )}
    </View>
  );
}

function ResourceLine(props: {
  label: string;
  day: ResourceDay;
  format: (value: number) => string;
}) {
  const { day } = props;
  return (
    <Text style={[text.mono, day.short > 0 ? styles.short : null]}>
      {props.label} {props.format(day.start)} → {props.format(day.end)}
      {day.short > 0 ? ` · manque ${props.format(day.short)}` : ''}
    </Text>
  );
}

function DayCard(props: {
  day: CrisisDay;
  onLink: (link: CrisisLink) => void;
}) {
  const { day } = props;
  const alerts: string[] = [];
  if (day.water.short > 0 && day.water.end === 0) {
    alerts.push('Plus d’eau');
  }
  if (day.food.short > 0 && day.food.end === 0) {
    alerts.push('Plus de vivres comptés');
  }
  if (day.energy && day.energy.short > 0) {
    alerts.push('Énergie stockée épuisée');
  }
  return (
    <Panel
      title={`Jour ${day.day} · ${formatDate(day.date)}`}
      accent={alerts.length > 0 ? colors.danger : undefined}
    >
      <ResourceLine label="Eau   " day={day.water} format={formatWater} />
      <ResourceLine label="Vivres" day={day.food} format={formatKcal} />
      {day.energy ? (
        <ResourceLine label="Énergie" day={day.energy} format={formatWh} />
      ) : null}
      {alerts.map(a => (
        <Text key={a} style={[text.body, styles.alert]}>
          {a}
        </Text>
      ))}
      {day.lost.length > 0 ? (
        <Text style={text.subtle}>Perdu : {day.lost.join(', ')}.</Text>
      ) : null}
      {day.events.map(e => (
        <View key={e.text} style={styles.event}>
          <Text style={text.body}>{e.text}</Text>
          {e.link ? (
            <Button
              compact
              variant="ghost"
              icon={e.link.kind === 'guide' ? BookOpen : undefined}
              label={e.link.label}
              onPress={() => e.link && props.onLink(e.link)}
            />
          ) : null}
        </View>
      ))}
    </Panel>
  );
}

const styles = StyleSheet.create({
  page: {
    paddingHorizontal: sizes.screenPadding,
    paddingBottom: space.xl,
    gap: space.m,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.s },
  section: { marginTop: space.s },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.s },
  grow: { flex: 1, minWidth: 0 },
  missing: { gap: space.xs },
  short: { color: colors.danger },
  alert: { color: colors.danger, fontFamily: fonts.display, fontWeight: '700' },
  event: {
    gap: space.xs,
    borderLeftWidth: 2,
    borderLeftColor: colors.border,
    paddingLeft: space.m,
  },
});
