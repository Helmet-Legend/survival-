/**
 * Préparation par paliers : le kit d'urgence recommandé, coché d'après le
 * stock réel, pour la maison (2, 3, 7 ou 10 jours) ou pour chaque sac
 * d'évacuation (72 h). Un élément manquant ouvre la fiche d'ajout habituelle.
 */
import { CheckCircle2, Circle, Plus } from 'lucide-react-native';
import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { localToday } from '../../lib/dates';
import {
  getPreparation,
  OFFICIAL_TIER,
  setMark,
  TIERS,
  type CheckResult,
  type Scope,
  type Tier,
} from '../../plan/preparation';
import {
  Chip,
  Gauge,
  Notice,
  Panel,
  ScreenTitle,
} from '../components/controls';
import { useNavigation } from '../navigation';
import { useSession } from '../session';
import { colors, radius, sizes, space, text } from '../theme';
import { useLoader } from '../useLoader';

const TIER_LABELS: Record<Tier, string> = {
  2: '48 h',
  3: '72 h',
  7: '7 jours',
  10: '10 jours',
};

export function PreparationScreen() {
  const { db, repo, bags, documents } = useSession();
  const navigation = useNavigation();
  const [scope, setScope] = useState<Scope>('home');
  const [tier, setTier] = useState<Tier>(OFFICIAL_TIER);
  const [error, setError] = useState<string | null>(null);
  const {
    data,
    error: loadError,
    reload,
  } = useLoader(async () => {
    const [bagList, items, docs] = await Promise.all([
      bags.list(),
      repo.listItems({ bag: scope === 'home' ? 'none' : scope }),
      documents.list(),
    ]);
    // Sac supprimé entre-temps : retour à la maison.
    const current =
      scope === 'home' || bagList.some(b => b.id === scope) ? scope : 'home';
    const report = await getPreparation(db, {
      scope: current,
      tier,
      items: current === scope ? items : await repo.listItems({ bag: 'none' }),
      documentCount: docs.length,
      asOf: localToday(),
    });
    return { bagList, report };
  }, [scope, tier]);

  const title = (
    <ScreenTitle
      title="Préparation"
      onBack={navigation.close}
      backLabel={navigation.backLabel}
    />
  );
  if (data === null) {
    return (
      <View style={styles.page}>
        {title}
        {loadError ? <Notice tone="error" message={loadError} /> : null}
      </View>
    );
  }
  const { bagList, report } = data;
  const bag = report.scope === 'home' ? null : report.scope;

  const toggle = async (id: string, checked: boolean) => {
    setError(null);
    try {
      await setMark(db, report.scope, id, checked);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const add = (result: CheckResult) => {
    const { definition } = result;
    if (definition.kind === 'documents') {
      navigation.goTo('stock', { category: 'documents' });
    } else if (definition.add) {
      navigation.openStockForm({
        category: definition.add.category,
        prefill: definition.add.prefill,
        ...(bag ? { bagId: bag } : {}),
      });
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.page}>
      {title}
      <Text style={text.muted}>
        Le kit recommandé par le guide officiel « Tous responsables » (SGDSN)
        pour tenir 72 h seul, vérifié d’après votre stock. Liste indicative :
        adaptez-la à votre foyer.
      </Text>

      <View style={styles.chips}>
        <Chip
          label="Maison"
          selected={report.scope === 'home'}
          onPress={() => setScope('home')}
        />
        {bagList.map(b => (
          <Chip
            key={b.id}
            label={b.name}
            selected={report.scope === b.id}
            onPress={() => setScope(b.id)}
          />
        ))}
      </View>

      {bag === null ? (
        <View style={styles.chips}>
          {TIERS.map(t => (
            <Chip
              key={t}
              label={TIER_LABELS[t]}
              selected={tier === t}
              onPress={() => setTier(t)}
            />
          ))}
        </View>
      ) : null}

      <Panel
        title={
          bag === null
            ? `Maison · ${TIER_LABELS[report.tier]}`
            : `Sac · 72 h pour une personne`
        }
      >
        <Text style={styles.score}>
          {report.done} sur {report.total} prêts
        </Text>
        <Gauge value={report.done / report.total} color={colors.success} />
        <Text style={text.subtle}>
          {bag === null
            ? 'L’eau et les vivres se comptent en jours pour tout le foyer ; l’équipement est le même à chaque palier.'
            : 'L’eau et les vivres se comptent dans le contenu du sac, pour une personne.'}
        </Text>
        {report.results.map(result => (
          <CheckRow
            key={result.definition.id}
            result={result}
            onAdd={() => add(result)}
            onToggle={checked => {
              void toggle(result.definition.id, checked);
            }}
          />
        ))}
      </Panel>
      {error ? <Notice tone="error" message={error} /> : null}
      <Text style={text.subtle}>
        Pensez à vérifier le kit régulièrement : dates de péremption des
        médicaments et des vivres, piles à remplacer.
      </Text>
    </ScrollView>
  );
}

function CheckRow(props: {
  result: CheckResult;
  onAdd: () => void;
  onToggle: (checked: boolean) => void;
}) {
  const { definition, done, detail } = props.result;
  const manual = definition.kind === 'manual';
  const Icon = done ? CheckCircle2 : Circle;
  const body = (
    <>
      <Icon color={done ? colors.success : colors.textSubtle} size={22} />
      <View style={styles.grow}>
        <Text style={text.body}>{definition.label}</Text>
        {detail ? (
          <Text style={done ? text.subtle : styles.missing}>{detail}</Text>
        ) : definition.hint ? (
          <Text style={text.subtle}>{definition.hint}</Text>
        ) : null}
      </View>
    </>
  );
  if (manual) {
    return (
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked: done }}
        accessibilityLabel={definition.label}
        onPress={() => props.onToggle(!done)}
        style={({ pressed }) => [styles.row, pressed && styles.pressed]}
      >
        {body}
      </Pressable>
    );
  }
  return (
    <View style={styles.row}>
      {body}
      {done ? null : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Ajouter : ${definition.label}`}
          onPress={props.onAdd}
          style={({ pressed }) => [styles.add, pressed && styles.pressed]}
        >
          <Plus color={colors.text} size={16} />
          <Text style={styles.addText}>Ajouter</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  page: {
    paddingHorizontal: sizes.screenPadding,
    paddingBottom: space.xl,
    gap: space.m,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.s },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.m,
    paddingVertical: space.s,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  grow: { flex: 1, minWidth: 0 },
  score: { ...text.value, fontSize: 22, color: colors.text },
  missing: { ...text.subtle, color: colors.warning },
  add: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: space.m,
    paddingVertical: space.s,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.borderActive,
  },
  addText: { color: colors.text, fontSize: 13, fontWeight: '600' },
  pressed: { opacity: 0.82 },
});
