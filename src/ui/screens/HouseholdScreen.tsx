/**
 * Mon foyer : toutes les hypothèses du calcul au même endroit (composition,
 * objectif, eau, calories, énergie par personne et par jour). L'accueil, le
 * simulateur, les check-lists et le plan d'achats s'en servent.
 */
import { Users } from 'lucide-react-native';
import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import {
  BABY_NEEDS,
  CHILD_NEEDS,
  NEEDS_SOURCE,
} from '../../resilience/householdProfiles';
import {
  adultsOf,
  dailyKcalNeed,
  dailyWaterNeed,
  loadHousehold,
  loadTargetDays,
  saveHousehold,
  saveTargetDays,
} from '../../resilience/resilienceCalculator';
import {
  ENERGY_NEED_CHOICES,
  loadEnergyNeed,
  saveEnergyNeed,
} from '../../resilience/energy';
import {
  Chip,
  Notice,
  Panel,
  ScreenTitle,
  Stepper,
} from '../components/controls';
import { formatNumber, nextTarget } from '../format';
import { useNavigation } from '../navigation';
import { useSession } from '../session';
import { colors, sizes, space, text } from '../theme';
import { useLoader } from '../useLoader';

const MAX_MEMBERS = 12;

const KCAL_CHOICES = [1800, 2000, 2200, 2500] as const;

export function HouseholdScreen() {
  const { db } = useSession();
  const navigation = useNavigation();
  const { data, error, reload } = useLoader(async () => {
    const [household, targetDays, whPerPerson] = await Promise.all([
      loadHousehold(db),
      loadTargetDays(db),
      loadEnergyNeed(db),
    ]);
    return { household, targetDays, whPerPerson };
  });

  const title = (
    <ScreenTitle
      title="Mon foyer"
      onBack={navigation.close}
      backLabel={navigation.backLabel}
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
  const { household, targetDays, whPerPerson } = data;

  const adults = adultsOf(household);
  const children = household.children ?? 0;
  const babies = household.babies ?? 0;
  const changeComposition = async (next: {
    adults?: number;
    children?: number;
    babies?: number;
  }) => {
    const a = next.adults ?? adults;
    const c = next.children ?? children;
    const b = next.babies ?? babies;
    await saveHousehold(db, {
      ...household,
      members: a + c + b,
      children: c,
      babies: b,
    });
    await reload();
  };
  const full = household.members >= MAX_MEMBERS;
  const changeWater = async (liters: number) => {
    await saveHousehold(db, { ...household, waterLitersPerPersonDay: liters });
    await reload();
  };
  const changeKcal = async (kcal: number) => {
    await saveHousehold(db, { ...household, kcalPerPersonDay: kcal });
    await reload();
  };
  const changeEnergy = async (wh: number) => {
    await saveEnergyNeed(db, wh);
    await reload();
  };
  const changeTarget = async (direction: 1 | -1) => {
    await saveTargetDays(db, nextTarget(targetDays, direction));
    await reload();
  };

  return (
    <ScrollView contentContainerStyle={styles.page}>
      {title}
      <Text style={text.muted}>
        Toutes les hypothèses au même endroit. L’accueil, le simulateur, les
        check-lists et le plan d’achats les utilisent.
      </Text>
      <Panel title="Foyer" right={<Users color={colors.cyan} size={20} />}>
        <MemberRow
          label="Adultes"
          hint="14 ans et plus"
          value={adults}
          min={1}
          full={full}
          noun="un adulte"
          onChange={n => changeComposition({ adults: n })}
        />
        <MemberRow
          label="Enfants"
          hint="3 à 13 ans"
          value={children}
          min={0}
          full={full}
          noun="un enfant"
          onChange={n => changeComposition({ children: n })}
        />
        <MemberRow
          label="Bébés"
          hint="Moins de 3 ans"
          value={babies}
          min={0}
          full={full}
          noun="un bébé"
          onChange={n => changeComposition({ babies: n })}
        />
        <Text style={text.subtle}>
          Enfant : {formatNumber(CHILD_NEEDS.waterLiters)} L d’eau et{' '}
          {formatNumber(CHILD_NEEDS.kcal, 0)} kcal par jour. Bébé :{' '}
          {formatNumber(BABY_NEEDS.waterLiters)} L et{' '}
          {formatNumber(BABY_NEEDS.kcal, 0)} kcal. {NEEDS_SOURCE}
        </Text>
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
        <View style={styles.settingRow}>
          <Text style={[text.body, styles.grow]}>
            Eau par adulte et par jour
          </Text>
          <View style={styles.chips}>
            {[2, 3].map(liters => (
              <Chip
                key={liters}
                label={`${liters} L`}
                selected={household.waterLitersPerPersonDay === liters}
                onPress={() => {
                  void changeWater(liters);
                }}
              />
            ))}
          </View>
        </View>
        <Text style={text.subtle}>
          2 L : référence du guide officiel français (kit 72 h). 3 L : marge
          pour la cuisine, l’hygiène et la chaleur.
        </Text>
        <View style={styles.settingRow}>
          <Text style={[text.body, styles.grow]}>
            Calories par adulte et par jour
          </Text>
        </View>
        <View style={styles.chips}>
          {KCAL_CHOICES.map(kcal => (
            <Chip
              key={kcal}
              label={formatNumber(kcal, 0)}
              selected={household.kcalPerPersonDay === kcal}
              onPress={() => {
                void changeKcal(kcal);
              }}
            />
          ))}
        </View>
        <Text style={text.subtle}>
          2 000 kcal : adulte au repos. Effort physique : 2 500 à 3 500 kcal.
        </Text>
        <View style={styles.settingRow}>
          <Text style={[text.body, styles.grow]}>
            Énergie par personne et par jour
          </Text>
        </View>
        <View style={styles.chips}>
          {ENERGY_NEED_CHOICES.map(wh => (
            <Chip
              key={wh}
              label={`${wh} Wh`}
              selected={whPerPerson === wh}
              onPress={() => {
                void changeEnergy(wh);
              }}
            />
          ))}
        </View>
        <Text style={text.subtle}>
          Une recharge de téléphone fait 10 à 20 Wh (ordre de grandeur). Sert à
          compter les jours couverts par vos batteries.
        </Text>
        <Text style={text.muted}>
          Besoins du foyer ({household.members} pers.) :{' '}
          {formatNumber(dailyWaterNeed(household))} L d’eau et{' '}
          {formatNumber(dailyKcalNeed(household), 0)} kcal par jour.
        </Text>
      </Panel>
    </ScrollView>
  );
}

function MemberRow(props: {
  label: string;
  hint: string;
  value: number;
  min: number;
  full: boolean;
  noun: string;
  onChange: (value: number) => Promise<void>;
}) {
  return (
    <View style={styles.settingRow}>
      <View style={styles.grow}>
        <Text style={text.body}>{props.label}</Text>
        <Text style={text.subtle}>{props.hint}</Text>
      </View>
      <Stepper
        value={String(props.value)}
        onDecrease={() => {
          void props.onChange(props.value - 1);
        }}
        onIncrease={() => {
          void props.onChange(props.value + 1);
        }}
        canDecrease={props.value > props.min}
        canIncrease={!props.full}
        decreaseLabel={`Retirer ${props.noun}`}
        increaseLabel={`Ajouter ${props.noun}`}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  page: {
    paddingHorizontal: sizes.screenPadding,
    paddingBottom: space.xl,
    gap: space.m,
  },
  settingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: space.m,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.s },
  grow: { flex: 1, minWidth: 0 },
});
