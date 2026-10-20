/**
 * Matériel de base : l'équipement courant par famille, reconnu dans le
 * stock ou coché à la main, exportable en tableur et imprimable.
 */
import {
  CheckCircle2,
  Circle,
  FileSpreadsheet,
  Plus,
  Printer,
} from 'lucide-react-native';
import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { localToday } from '../../lib/dates';
import {
  gearCsv,
  gearHtml,
  GEAR_REFS,
  GEAR_SECTIONS,
  gearRefsLabel,
  getBaseGear,
  setGearMark,
  type GearResult,
} from '../../plan/baseGear';
import {
  Button,
  Chip,
  Gauge,
  Notice,
  Panel,
  ScreenTitle,
} from '../components/controls';
import { formatDate } from '../format';
import { useNavigation } from '../navigation';
import { useSession } from '../session';
import { colors, radius, sizes, space, text } from '../theme';
import { useLoader } from '../useLoader';

export function BaseGearScreen() {
  const { db, repo, bags, documents, files } = useSession();
  const navigation = useNavigation();
  const [missingOnly, setMissingOnly] = useState(false);
  const [notice, setNotice] = useState<{
    tone: 'ok' | 'error';
    message: string;
  } | null>(null);
  const { data, error, reload } = useLoader(async () => {
    const [items, docs, bagList] = await Promise.all([
      repo.listItems(),
      documents.list(),
      bags.list(),
    ]);
    return getBaseGear(db, {
      items,
      documentCount: docs.length,
      bagNames: bagList.map(b => b.name),
    });
  });

  const title = (
    <ScreenTitle
      title="Matériel de base"
      onBack={navigation.close}
      backLabel={navigation.backLabel}
    />
  );
  if (data === null) {
    return (
      <View style={styles.page}>
        {title}
        {error ? <Notice tone="error" message={error} /> : null}
      </View>
    );
  }

  const fail = (e: unknown) =>
    setNotice({
      tone: 'error',
      message: e instanceof Error ? e.message : String(e),
    });

  const toggle = async (id: string, checked: boolean) => {
    setNotice(null);
    try {
      await setGearMark(db, id, checked);
      await reload();
    } catch (e) {
      fail(e);
    }
  };

  const exportCsv = async () => {
    setNotice(null);
    try {
      const saved = await files.saveText(
        `fenrir-materiel-${localToday()}.csv`,
        'text/csv',
        gearCsv(data),
      );
      setNotice(
        saved
          ? { tone: 'ok', message: 'Liste exportée en tableur.' }
          : { tone: 'error', message: 'Export annulé.' },
      );
    } catch (e) {
      fail(e);
    }
  };

  const print = async () => {
    setNotice(null);
    try {
      await files.printHtml?.(
        'Matériel de base',
        gearHtml(data, formatDate(localToday())),
      );
    } catch (e) {
      fail(e);
    }
  };

  const add = (result: GearResult) => {
    const { definition } = result;
    if (definition.source === 'documents') {
      navigation.goTo('stock', { category: 'documents' });
    } else if (definition.source === 'bags') {
      navigation.goTo('stock', { category: 'bags' });
    } else if (definition.add) {
      navigation.openStockForm({
        category: definition.add.category,
        prefill: definition.add.prefill,
      });
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.page}>
      {title}
      <Text style={text.muted}>
        L’équipement courant d’un foyer préparé, reconnu dans votre stock
        (maison et sacs). Ce que vous avez sans l’avoir saisi se coche d’un
        appui. Chaque élément indique la liste officielle qui le recommande ; «
        conseil courant » signale ceux qu’aucune ne cite. Liste indicative :
        adaptez-la à votre foyer.
      </Text>

      <Panel>
        <Text style={styles.score}>
          {data.have} sur {data.total}
        </Text>
        <Gauge value={data.have / data.total} color={colors.success} />
        <View style={styles.row}>
          {files.available ? (
            <Button
              compact
              icon={FileSpreadsheet}
              label="Tableur"
              accessibilityLabel="Exporter la liste en tableur (Excel)"
              onPress={() => {
                void exportCsv();
              }}
              style={styles.grow}
            />
          ) : null}
          {files.printHtml ? (
            <Button
              compact
              icon={Printer}
              label="Imprimer / PDF"
              accessibilityLabel="Imprimer la liste ou l’enregistrer en PDF"
              onPress={() => {
                void print();
              }}
              style={styles.grow}
            />
          ) : null}
        </View>
      </Panel>
      {notice ? <Notice tone={notice.tone} message={notice.message} /> : null}

      <View style={styles.chips}>
        <Chip
          label="Tout"
          selected={!missingOnly}
          onPress={() => setMissingOnly(false)}
        />
        <Chip
          label={`À prévoir (${data.total - data.have})`}
          selected={missingOnly}
          onPress={() => setMissingOnly(true)}
        />
      </View>

      {GEAR_SECTIONS.map(section => {
        const results = data.results.filter(
          r =>
            r.section.id === section.id &&
            (!missingOnly || r.status === 'missing'),
        );
        if (results.length === 0) {
          return null;
        }
        return (
          <Panel key={section.id} title={section.title}>
            {results.map(result => (
              <GearRow
                key={result.definition.id}
                result={result}
                onAdd={() => add(result)}
                onToggle={checked => {
                  void toggle(result.definition.id, checked);
                }}
              />
            ))}
          </Panel>
        );
      })}
      {missingOnly && data.have === data.total ? (
        <Text style={text.subtle}>Rien à prévoir : tout est là.</Text>
      ) : null}
      <Panel title="Sources">
        {Object.values(GEAR_REFS).map(ref => (
          <Text key={ref.short} style={text.subtle}>
            {ref.short} : {ref.title}
          </Text>
        ))}
      </Panel>
    </ScrollView>
  );
}

function GearRow(props: {
  result: GearResult;
  onAdd: () => void;
  onToggle: (checked: boolean) => void;
}) {
  const { definition, status, detail } = props.result;
  const have = status !== 'missing';
  const Icon = have ? CheckCircle2 : Circle;
  const canAdd =
    status === 'missing' &&
    (definition.add !== undefined || definition.source !== undefined);
  const sub =
    status === 'stock' && detail
      ? `Dans le stock : ${detail}`
      : status === 'checked'
      ? 'Coché à la main'
      : definition.hint ?? null;
  return (
    <View style={styles.item}>
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked: have, disabled: status === 'stock' }}
        accessibilityLabel={definition.label}
        disabled={status === 'stock'}
        onPress={() => props.onToggle(status !== 'checked')}
        style={({ pressed }) => [styles.check, pressed && styles.pressed]}
      >
        <Icon color={have ? colors.success : colors.textSubtle} size={22} />
        <View style={styles.grow}>
          <Text style={text.body}>{definition.label}</Text>
          {sub ? <Text style={text.subtle}>{sub}</Text> : null}
          <Text
            style={
              definition.refs.length === 0 ? styles.unofficial : styles.ref
            }
          >
            {definition.refs.length === 0
              ? gearRefsLabel(definition)
              : `Source : ${gearRefsLabel(definition)}`}
          </Text>
        </View>
      </Pressable>
      {canAdd ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Ajouter : ${definition.label}`}
          onPress={props.onAdd}
          style={({ pressed }) => [styles.add, pressed && styles.pressed]}
        >
          <Plus color={colors.text} size={16} />
          <Text style={styles.addText}>Ajouter</Text>
        </Pressable>
      ) : null}
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
  row: { flexDirection: 'row', gap: space.s, flexWrap: 'wrap' },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.s,
    paddingVertical: space.s,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  check: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.m,
  },
  grow: { flex: 1, minWidth: 0 },
  score: { ...text.value, fontSize: 22, color: colors.text },
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
  ref: { ...text.subtle, fontSize: 12, color: colors.cyanSoft },
  unofficial: { ...text.subtle, fontSize: 12, fontStyle: 'italic' },
  addText: { color: colors.text, fontSize: 13, fontWeight: '600' },
  pressed: { opacity: 0.82 },
});
