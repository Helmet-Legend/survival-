/**
 * Kit et matériel : ce qu'il faut avoir, vérifié d'après le stock. Pour la
 * maison, une seule liste par famille (eau et vivres comptés en jours selon
 * le palier, équipement reconnu dans le stock ou coché à la main), avec le
 * kit 72 h officiel repéré « Essentiel 72 h » ; exportable en tableur et
 * imprimable. Pour un sac d'évacuation, le kit 72 h vérifié sur son contenu.
 */
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
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
  isEssential,
  setGearMark,
  SHOW_WEAPONS_MARK,
  type GearReport,
  type GearResult,
} from '../../plan/baseGear';
import {
  getPreparation,
  loadHomeAutonomy,
  OFFICIAL_TIER,
  setMark,
  TIERS,
  type CheckResult,
  type PreparationReport,
  type Scope,
  type Tier,
} from '../../plan/preparation';
import {
  Button,
  Chip,
  Gauge,
  Notice,
  Panel,
  ScreenTitle,
} from '../components/controls';
import { formatDate } from '../format';
import { useNavigation, type StockFormTarget } from '../navigation';
import { useSession } from '../session';
import { colors, radius, sizes, space, text, tint } from '../theme';
import { useLoader } from '../useLoader';

const TIER_LABELS: Record<Tier, string> = {
  2: '48 h',
  3: '72 h',
  7: '7 jours',
  10: '10 jours',
};

type Filter = 'all' | 'essential' | 'missing';

type Data =
  | { kind: 'home'; bagList: { id: string; name: string }[]; gear: GearReport }
  | {
      kind: 'bag';
      bagList: { id: string; name: string }[];
      report: PreparationReport;
    };

export function KitScreen() {
  const { db, repo, bags, documents, files, armory } = useSession();
  const navigation = useNavigation();
  const [scope, setScope] = useState<Scope>('home');
  const [tier, setTier] = useState<Tier>(OFFICIAL_TIER);
  const [filter, setFilter] = useState<Filter>('all');
  /** Familles ouvertes ou fermées à la main (sinon : ouvertes s'il manque). */
  const [opened, setOpened] = useState<Record<string, boolean>>({});
  const [notice, setNotice] = useState<{
    tone: 'ok' | 'error';
    message: string;
  } | null>(null);

  const { data, error, reload } = useLoader(async (): Promise<Data> => {
    const today = localToday();
    const [bagList, docs] = await Promise.all([bags.list(), documents.list()]);
    // Sac supprimé entre-temps : retour à la maison.
    if (scope !== 'home' && bagList.some(b => b.id === scope)) {
      const report = await getPreparation(db, {
        scope,
        tier,
        items: await repo.listItems({ bag: scope }),
        documentCount: docs.length,
        asOf: today,
      });
      return { kind: 'bag', bagList, report };
    }
    const [items, weapons, autonomy] = await Promise.all([
      repo.listItems(),
      armory.listWeapons(),
      loadHomeAutonomy(db, today),
    ]);
    const gear = await getBaseGear(db, {
      items,
      documentCount: docs.length,
      bagNames: bagList.map(b => b.name),
      weaponCount: weapons.length,
      autonomy: { days: tier, ...autonomy },
    });
    return { kind: 'home', bagList, gear };
  }, [scope, tier]);

  const title = (
    <ScreenTitle
      title="Kit et matériel"
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
  const run = async (task: () => Promise<void>) => {
    setNotice(null);
    try {
      await task();
      await reload();
    } catch (e) {
      fail(e);
    }
  };
  const bagId = data.kind === 'bag' ? data.report.scope : null;
  const openForm = (target: StockFormTarget) =>
    navigation.openStockForm(bagId ? { ...target, bagId } : target);

  return (
    <ScrollView contentContainerStyle={styles.page}>
      {title}
      <Text style={text.muted}>
        Ce qu’il faut avoir, vérifié d’après votre stock. « Essentiel 72 h » :
        le kit du guide officiel « Tous responsables ».
      </Text>

      <View style={styles.chips}>
        <Chip
          label="Maison"
          selected={data.kind === 'home'}
          onPress={() => setScope('home')}
        />
        {data.bagList.map(b => (
          <Chip
            key={b.id}
            label={b.name}
            selected={bagId === b.id}
            onPress={() => setScope(b.id)}
          />
        ))}
      </View>

      {data.kind === 'bag' ? (
        <BagKit
          report={data.report}
          onAdd={result => {
            if (result.definition.add) {
              openForm({
                category: result.definition.add.category,
                prefill: result.definition.add.prefill,
              });
            }
          }}
          onToggle={(id, checked) => {
            void run(() => setMark(db, data.report.scope, id, checked));
          }}
        />
      ) : (
        <HomeKit
          gear={data.gear}
          tier={tier}
          setTier={setTier}
          filter={filter}
          setFilter={setFilter}
          opened={opened}
          setOpened={setOpened}
          canExport={files.available}
          canPrint={files.printHtml !== undefined}
          onExport={() => {
            setNotice(null);
            files
              .saveText(
                `fenrir-kit-${localToday()}.csv`,
                'text/csv',
                gearCsv(data.gear),
              )
              .then(saved =>
                setNotice(
                  saved
                    ? { tone: 'ok', message: 'Liste exportée en tableur.' }
                    : { tone: 'error', message: 'Export annulé.' },
                ),
              )
              .catch(fail);
          }}
          onPrint={() => {
            setNotice(null);
            files
              .printHtml?.(
                'Kit et matériel',
                gearHtml(data.gear, formatDate(localToday())),
              )
              .catch(fail);
          }}
          onToggle={(id, checked) => {
            void run(() => setGearMark(db, id, checked));
          }}
          onAdd={result => {
            const { definition } = result;
            if (definition.source === 'documents') {
              navigation.goTo('stock', { category: 'documents' });
            } else if (definition.source === 'bags') {
              navigation.goTo('stock', { category: 'bags' });
            } else if (definition.add) {
              openForm({
                category: definition.add.category,
                recordType: definition.add.recordType,
                prefill: definition.add.prefill,
              });
            }
          }}
          notice={notice}
        />
      )}
      {data.kind === 'bag' && notice ? (
        <Notice tone={notice.tone} message={notice.message} />
      ) : null}
    </ScrollView>
  );
}

function HomeKit(props: {
  gear: GearReport;
  tier: Tier;
  setTier: (tier: Tier) => void;
  filter: Filter;
  setFilter: (filter: Filter) => void;
  opened: Record<string, boolean>;
  setOpened: (opened: Record<string, boolean>) => void;
  canExport: boolean;
  canPrint: boolean;
  onExport: () => void;
  onPrint: () => void;
  onToggle: (id: string, checked: boolean) => void;
  onAdd: (result: GearResult) => void;
  notice: { tone: 'ok' | 'error'; message: string } | null;
}) {
  const { gear, filter } = props;
  const shown = (r: GearResult) =>
    filter === 'all' ||
    (filter === 'missing' && r.status === 'missing') ||
    (filter === 'essential' && isEssential(r.definition));
  const refs = [...new Set(gear.results.flatMap(r => r.definition.refs))];
  return (
    <>
      <View style={styles.chips}>
        {TIERS.map(t => (
          <Chip
            key={t}
            label={TIER_LABELS[t]}
            selected={props.tier === t}
            onPress={() => props.setTier(t)}
          />
        ))}
      </View>

      <Panel>
        <Text style={styles.score}>
          {gear.have} sur {gear.total}
        </Text>
        <Gauge value={gear.have / gear.total} color={colors.success} />
        <Text style={text.subtle}>
          Dont Essentiel 72 h : {gear.essentialHave} sur {gear.essentialTotal}.
          L’eau et les vivres se comptent en jours pour tout le foyer (
          {TIER_LABELS[props.tier]}).
        </Text>
        {props.canExport || props.canPrint ? (
          <View style={styles.row}>
            {props.canExport ? (
              <Button
                compact
                icon={FileSpreadsheet}
                label="Tableur"
                accessibilityLabel="Exporter la liste en tableur (Excel)"
                onPress={props.onExport}
                style={styles.grow}
              />
            ) : null}
            {props.canPrint ? (
              <Button
                compact
                icon={Printer}
                label="Imprimer / PDF"
                accessibilityLabel="Imprimer la liste ou l’enregistrer en PDF"
                onPress={props.onPrint}
                style={styles.grow}
              />
            ) : null}
          </View>
        ) : null}
      </Panel>
      {props.notice ? (
        <Notice tone={props.notice.tone} message={props.notice.message} />
      ) : null}

      <View style={styles.chips}>
        <Chip
          label="Tout"
          selected={filter === 'all'}
          onPress={() => props.setFilter('all')}
        />
        <Chip
          label="Essentiel 72 h"
          selected={filter === 'essential'}
          onPress={() => props.setFilter('essential')}
        />
        <Chip
          label={`À prévoir (${gear.total - gear.have})`}
          selected={filter === 'missing'}
          onPress={() => props.setFilter('missing')}
        />
        {gear.weaponsOptional ? (
          <Chip
            label="Volet armes"
            selected={gear.weapons}
            onPress={() => props.onToggle(SHOW_WEAPONS_MARK, !gear.weapons)}
          />
        ) : null}
      </View>

      {GEAR_SECTIONS.map(section => {
        const all = gear.results.filter(r => r.section.id === section.id);
        const results = all.filter(shown);
        if (results.length === 0) {
          return null;
        }
        const have = all.filter(r => r.status !== 'missing').length;
        // Fermée par défaut quand tout y est, sauf filtre actif.
        const open =
          filter !== 'all' || (props.opened[section.id] ?? have < all.length);
        const Chevron = open ? ChevronDown : ChevronRight;
        return (
          <View key={section.id} style={styles.section}>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ expanded: open }}
              accessibilityLabel={`${section.title}, ${have} sur ${all.length}`}
              disabled={filter !== 'all'}
              onPress={() =>
                props.setOpened({ ...props.opened, [section.id]: !open })
              }
              style={({ pressed }) => [styles.head, pressed && styles.pressed]}
            >
              <Text style={[text.label, styles.grow]}>{section.title}</Text>
              <Text
                style={[
                  styles.count,
                  have === all.length && { color: colors.success },
                ]}
              >
                {have}/{all.length}
              </Text>
              {filter === 'all' ? (
                <Chevron color={colors.textMuted} size={18} />
              ) : null}
            </Pressable>
            {open
              ? results.map(result => (
                  <GearRow
                    key={result.definition.id}
                    result={result}
                    onAdd={() => props.onAdd(result)}
                    onToggle={checked =>
                      props.onToggle(result.definition.id, checked)
                    }
                  />
                ))
              : null}
          </View>
        );
      })}
      {filter === 'missing' && gear.have === gear.total ? (
        <Text style={text.subtle}>Rien à prévoir : tout est là.</Text>
      ) : null}
      <Panel title="Sources">
        {refs.map(id => (
          <Text key={id} style={text.subtle}>
            {GEAR_REFS[id].short} : {GEAR_REFS[id].title}
          </Text>
        ))}
        <Text style={text.subtle}>
          Liste indicative : adaptez-la à votre foyer.
        </Text>
      </Panel>
    </>
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
  // Eau et vivres : comptés en jours, pas cochables.
  const counted = props.result.counted === true;
  const locked = status === 'stock' || counted;
  const canAdd =
    status === 'missing' &&
    (definition.add !== undefined || definition.source !== undefined);
  const sub =
    counted || (status === 'stock' && detail)
      ? counted
        ? detail
        : `Dans le stock : ${detail}`
      : status === 'checked'
      ? 'Coché à la main'
      : definition.hint ?? null;
  const essential = isEssential(definition);
  return (
    <View style={styles.item}>
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked: have, disabled: locked }}
        accessibilityLabel={definition.label}
        disabled={locked}
        onPress={() => props.onToggle(status !== 'checked')}
        style={({ pressed }) => [styles.check, pressed && styles.pressed]}
      >
        <Icon color={have ? colors.success : colors.textSubtle} size={22} />
        <View style={styles.grow}>
          <Text style={text.body}>{definition.label}</Text>
          {sub ? (
            <Text style={counted && !have ? styles.missing : text.subtle}>
              {sub}
            </Text>
          ) : null}
          <View style={styles.meta}>
            {essential ? (
              <Text style={styles.badge}>Essentiel 72 h</Text>
            ) : null}
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
        </View>
      </Pressable>
      {canAdd ? (
        <AddButton label={definition.label} onPress={props.onAdd} />
      ) : null}
    </View>
  );
}

/** Sac d'évacuation : le kit 72 h vérifié sur son contenu. */
function BagKit(props: {
  report: PreparationReport;
  onAdd: (result: CheckResult) => void;
  onToggle: (id: string, checked: boolean) => void;
}) {
  const { report } = props;
  return (
    <Panel title="Sac · 72 h pour une personne">
      <Text style={styles.score}>
        {report.done} sur {report.total} prêts
      </Text>
      <Gauge value={report.done / report.total} color={colors.success} />
      <Text style={text.subtle}>
        L’eau et les vivres se comptent dans le contenu du sac, pour une
        personne.
      </Text>
      {report.results.map(result => {
        const { definition, done, detail } = result;
        const Icon = done ? CheckCircle2 : Circle;
        const body = (
          <>
            <Icon color={done ? colors.success : colors.textSubtle} size={22} />
            <View style={styles.grow}>
              <Text style={text.body}>{definition.label}</Text>
              {detail ? (
                <Text style={done ? text.subtle : styles.missing}>
                  {detail}
                </Text>
              ) : definition.hint ? (
                <Text style={text.subtle}>{definition.hint}</Text>
              ) : null}
            </View>
          </>
        );
        if (definition.kind === 'manual') {
          return (
            <Pressable
              key={definition.id}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: done }}
              accessibilityLabel={definition.label}
              onPress={() => props.onToggle(definition.id, !done)}
              style={({ pressed }) => [
                styles.item,
                styles.check,
                pressed && styles.pressed,
              ]}
            >
              {body}
            </Pressable>
          );
        }
        return (
          <View key={definition.id} style={styles.item}>
            <View style={styles.check}>{body}</View>
            {done || !definition.add ? null : (
              <AddButton
                label={definition.label}
                onPress={() => props.onAdd(result)}
              />
            )}
          </View>
        );
      })}
    </Panel>
  );
}

function AddButton(props: { label: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Ajouter : ${props.label}`}
      onPress={props.onPress}
      style={({ pressed }) => [styles.add, pressed && styles.pressed]}
    >
      <Plus color={colors.text} size={16} />
      <Text style={styles.addText}>Ajouter</Text>
    </Pressable>
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
  section: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.card,
    paddingHorizontal: space.m,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.s,
    minHeight: 48,
  },
  count: { ...text.mono, color: colors.warning, fontWeight: '700' },
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
  meta: { flexDirection: 'row', flexWrap: 'wrap', gap: space.s, marginTop: 2 },
  badge: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.primary,
    backgroundColor: tint(colors.primary, '1f'),
    borderRadius: radius.pill,
    paddingHorizontal: 6,
    overflow: 'hidden',
  },
  score: { ...text.value, fontSize: 22, color: colors.text },
  missing: { ...text.subtle, color: colors.warning },
  ref: { ...text.subtle, fontSize: 12, color: colors.cyanSoft },
  unofficial: { ...text.subtle, fontSize: 12, fontStyle: 'italic' },
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
