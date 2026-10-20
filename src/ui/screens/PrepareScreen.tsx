/**
 * Préparer : la porte d'entrée de tout ce qui sert à se préparer, rangé en
 * quatre blocs (mon foyer, où j'en suis, planifier, s'entraîner). Chaque ligne ouvre
 * l'écran existant ; le retour y ramène.
 */
import {
  Calculator,
  ChevronRight,
  ClipboardList,
  Hourglass,
  House,
  ListChecks,
  ShoppingCart,
  Users,
  type LucideIcon,
} from 'lucide-react-native';
import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { localToday } from '../../lib/dates';
import {
  currentMonthIndex,
  loadPurchasePlan,
  monthLabel,
  monthOf,
  monthTotal,
} from '../../plan/purchasePlan';
import { getReadiness } from '../../plan/readiness';
import {
  loadHousehold,
  loadTargetDays,
} from '../../resilience/resilienceCalculator';
import { Gauge, ScreenTitle } from '../components/controls';
import { formatEuros } from '../format';
import { useNavigation, type Overlay } from '../navigation';
import { useSession } from '../session';
import { colors, radius, sizes, space, text, tint } from '../theme';
import { useLoader } from '../useLoader';
import { scoreColor } from './ReadinessScreen';

export function PrepareScreen() {
  const { db, repo, documents, bags } = useSession();
  const navigation = useNavigation();
  const { data } = useLoader(async () => {
    const [items, docs, bagList, plan] = await Promise.all([
      repo.listItems({ bag: 'none' }),
      documents.list(),
      bags.list(),
      loadPurchasePlan(db),
    ]);
    const today = localToday();
    const readiness = await getReadiness(db, {
      items,
      documentCount: docs.length,
      bags: bagList,
      asOf: today,
    });
    let purchases: string | null = null;
    if (plan !== null) {
      const month = currentMonthIndex(plan, today);
      const pending = plan.entries.filter(e => !e.done && e.month <= month);
      const total = monthTotal(plan, month);
      purchases = `${monthLabel(monthOf(today))} : ${
        pending.length === 0 ? 'rien à acheter' : `${pending.length} à faire`
      }${total > 0 ? ` · ${formatEuros(total)}` : ''}${
        plan.budget !== undefined ? ` / ${formatEuros(plan.budget)}` : ''
      }`;
    }
    const [household, targetDays] = await Promise.all([
      loadHousehold(db),
      loadTargetDays(db),
    ]);
    const n = household.members;
    return {
      readiness,
      purchases,
      household: `${n} personne${
        n > 1 ? 's' : ''
      } · objectif ${targetDays} jours`,
    };
  });

  const open = (overlay: Overlay) => () => navigation.open(overlay);
  const readiness = data?.readiness;
  const color = readiness ? scoreColor(readiness.score) : colors.textMuted;

  return (
    <ScrollView contentContainerStyle={styles.page}>
      <ScreenTitle title="Préparer" />

      {readiness ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Indice de préparation : ${readiness.score} sur 100, ${readiness.level}. Voir le détail`}
          onPress={open('readiness')}
          style={({ pressed }) => [styles.card, pressed && styles.pressed]}
        >
          <View style={styles.head}>
            <Text style={[text.label, styles.grow]}>Indice de préparation</Text>
            <Text style={[text.mono, styles.score, { color }]}>
              {readiness.score}/100
            </Text>
          </View>
          <Gauge value={readiness.score / 100} color={color} />
          <Text style={text.subtle}>
            {readiness.level}
            {readiness.next[0]
              ? ` · Prochaine action : ${readiness.next[0].todo}`
              : ''}
          </Text>
        </Pressable>
      ) : null}

      <Text style={[text.label, styles.section]}>Mon foyer</Text>
      <NavRow
        icon={House}
        title={data?.household ?? 'Mon foyer'}
        detail="Personnes, objectif, eau, calories et énergie"
        accessibilityLabel="Ouvrir Mon foyer : personnes, objectif, eau, calories, énergie"
        onPress={open('household')}
      />

      <Text style={[text.label, styles.section]}>Où j’en suis</Text>
      <NavRow
        icon={ListChecks}
        title="Kit et matériel"
        detail="Kit 72 h, matériel par famille, sacs · tableur et impression"
        accessibilityLabel="Ouvrir le kit et matériel"
        onPress={open('preparation')}
      />
      <NavRow
        icon={ClipboardList}
        title="Plan d’action"
        detail="Objectif d’autonomie, à racheter, péremptions"
        accessibilityLabel="Ouvrir le plan d’action"
        onPress={open('plan')}
      />

      <Text style={[text.label, styles.section]}>Planifier</Text>
      <NavRow
        icon={ShoppingCart}
        color={colors.primary}
        title="Plan d’achats"
        detail={data?.purchases ?? 'Étaler les achats sur plusieurs mois'}
        accessibilityLabel="Ouvrir le plan d’achats"
        onPress={open('purchases')}
      />
      <NavRow
        icon={Users}
        title="Plan familial et communication"
        detail="Contacts, points de regroupement, PACE"
        accessibilityLabel="Ouvrir le plan familial"
        onPress={open('familyPlan')}
      />

      <Text style={[text.label, styles.section]}>S’entraîner</Text>
      <NavRow
        icon={Hourglass}
        title="Simulateur de crise"
        detail="Une crise jour par jour sur votre stock"
        accessibilityLabel="Ouvrir le simulateur de crise"
        onPress={open('crisis')}
      />
      <NavRow
        icon={Calculator}
        title="Calculateurs"
        detail="Eau par usage, besoins électriques"
        accessibilityLabel="Ouvrir les calculateurs"
        onPress={open('calculators')}
      />
    </ScrollView>
  );
}

function NavRow(props: {
  icon: LucideIcon;
  title: string;
  detail: string;
  accessibilityLabel: string;
  onPress: () => void;
  color?: string;
}) {
  const Icon = props.icon;
  const color = props.color ?? colors.cyan;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={props.accessibilityLabel}
      onPress={props.onPress}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      <View style={[styles.icon, { backgroundColor: tint(color, '1a') }]}>
        <Icon color={color} size={20} strokeWidth={2} />
      </View>
      <View style={styles.grow}>
        <Text style={styles.rowTitle}>{props.title}</Text>
        <Text style={text.subtle}>{props.detail}</Text>
      </View>
      <ChevronRight color={colors.textMuted} size={20} strokeWidth={2} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  page: {
    paddingHorizontal: sizes.screenPadding,
    paddingBottom: space.xl,
    gap: space.s,
  },
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.card,
    padding: space.m,
    gap: space.s,
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: space.m },
  score: { fontSize: 18, fontWeight: '800' },
  section: { marginTop: space.m },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.m,
    minHeight: 60,
    paddingHorizontal: space.m,
    paddingVertical: space.s,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.card,
  },
  icon: {
    width: 38,
    height: 38,
    borderRadius: radius.s,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowTitle: { color: colors.text, fontSize: 16, fontWeight: '600' },
  grow: { flex: 1, minWidth: 0, gap: 2 },
  pressed: { opacity: 0.82 },
});
