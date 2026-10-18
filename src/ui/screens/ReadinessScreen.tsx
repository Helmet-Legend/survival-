/**
 * Indice de préparation : score sur 100, critère par critère, avec la raison
 * des points et l'action qui en ajouterait. Calculé d'après ce qui est saisi
 * dans Fenrir ; ce n'est pas une mesure de la sécurité réelle.
 */
import { CheckCircle2, CircleDashed } from 'lucide-react-native';
import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { localToday } from '../../lib/dates';
import {
  getReadiness,
  type ReadinessAction,
  type ReadinessCriterion,
} from '../../plan/readiness';
import {
  Button,
  Gauge,
  Notice,
  Panel,
  ScreenTitle,
} from '../components/controls';
import { useNavigation, type Navigation } from '../navigation';
import { useSession } from '../session';
import { colors, fonts, sizes, space, text } from '../theme';
import { useLoader } from '../useLoader';

export function scoreColor(score: number): string {
  return score >= 70
    ? colors.success
    : score >= 40
    ? colors.warning
    : colors.danger;
}

export function runReadinessAction(
  navigation: Navigation,
  action: ReadinessAction,
): void {
  switch (action.kind) {
    case 'add':
      navigation.openStockForm({
        category: action.category,
        prefill: action.prefill,
      });
      return;
    case 'preparation':
      navigation.open('preparation');
      return;
    case 'familyPlan':
      navigation.open('familyPlan');
      return;
    case 'documents':
      navigation.goTo('stock', { category: 'documents' });
      return;
    case 'bags':
      navigation.goTo('stock', { category: 'bags' });
      return;
  }
}

const ACTION_LABELS: Record<ReadinessAction['kind'], string> = {
  add: 'Ajouter au stock',
  preparation: 'Voir le kit 72 h',
  familyPlan: 'Ouvrir le plan familial',
  documents: 'Ouvrir les documents',
  bags: 'Ouvrir les sacs',
};

export function ReadinessScreen() {
  const { db, repo, documents, bags } = useSession();
  const navigation = useNavigation();
  const { data, error } = useLoader(async () => {
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

  const title = (
    <ScreenTitle
      title="Indice de préparation"
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
  const color = scoreColor(data.score);
  return (
    <ScrollView contentContainerStyle={styles.page}>
      {title}
      <Panel>
        <View style={styles.scoreRow}>
          <Text style={[styles.score, { color }]}>
            {data.score}
            <Text style={styles.scoreMax}> / 100</Text>
          </Text>
          <Text style={[text.body, styles.level, { color }]}>{data.level}</Text>
        </View>
        <Gauge value={data.score / 100} color={color} />
        <Text style={text.subtle}>
          Calculé d’après ce que vous avez saisi dans Fenrir : stock général,
          kit 72 h, documents, plan familial et sacs. Un indice élevé ne
          garantit pas la sécurité ; les consignes officielles priment.
        </Text>
      </Panel>

      {data.next.length > 0 ? (
        <Panel title="Prochaines actions">
          {data.next.slice(0, 3).map(c => (
            <View key={c.id} style={styles.next}>
              <Text style={[text.body, styles.grow]}>
                {c.todo}
                <Text style={text.subtle}> · +{c.max - c.points} pts</Text>
              </Text>
              <Button
                compact
                label={ACTION_LABELS[c.action.kind]}
                accessibilityLabel={`${ACTION_LABELS[c.action.kind]} : ${
                  c.label
                }`}
                onPress={() => runReadinessAction(navigation, c.action)}
              />
            </View>
          ))}
        </Panel>
      ) : (
        <Notice
          tone="ok"
          message="Tous les critères sont remplis. Pensez au bilan mensuel pour les garder à jour."
        />
      )}

      <Panel title="Détail des critères">
        {data.criteria.map(c => (
          <CriterionRow key={c.id} criterion={c} />
        ))}
      </Panel>
    </ScrollView>
  );
}

function CriterionRow({ criterion: c }: { criterion: ReadinessCriterion }) {
  const complete = c.points >= c.max;
  const Icon = complete ? CheckCircle2 : CircleDashed;
  return (
    <View
      accessible
      accessibilityLabel={`${c.label} : ${c.points} sur ${c.max} points. ${
        c.reason
      }.${c.todo ? ` À faire : ${c.todo}.` : ''}`}
      style={styles.criterion}
    >
      <Icon
        color={complete ? colors.success : colors.textMuted}
        size={20}
        strokeWidth={2}
      />
      <View style={styles.grow}>
        <View style={styles.criterionHead}>
          <Text style={[text.body, styles.grow]}>{c.label}</Text>
          <Text style={text.mono}>
            {c.points}/{c.max}
          </Text>
        </View>
        <Gauge
          value={c.points / c.max}
          color={complete ? colors.success : colors.warning}
        />
        <Text style={text.subtle}>
          {c.reason}
          {c.todo ? ` · À faire : ${c.todo}` : ''}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  page: {
    paddingHorizontal: sizes.screenPadding,
    paddingBottom: space.xl,
    gap: space.m,
  },
  scoreRow: { flexDirection: 'row', alignItems: 'baseline', gap: space.m },
  score: {
    fontFamily: fonts.display,
    fontSize: 44,
    fontWeight: '800',
    lineHeight: 48,
  },
  scoreMax: { fontSize: 18, color: colors.textMuted },
  level: { fontWeight: '700' },
  next: { gap: space.s },
  criterion: { flexDirection: 'row', gap: space.m, alignItems: 'flex-start' },
  criterionHead: { flexDirection: 'row', alignItems: 'center', gap: space.s },
  grow: { flex: 1, minWidth: 0, gap: space.xs },
});
