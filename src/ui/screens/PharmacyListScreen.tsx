/**
 * Pharmacie familiale : adultes, enfants, durée, puis « Générer ma liste ».
 * La liste se coche, s'exporte, et mène au stock réel de pharmacie (lots,
 * péremptions). Estimations statistiques signalées comme telles ; aucune
 * posologie, surtout pour les enfants.
 */
import {
  AlertTriangle,
  Baby,
  ChevronRight,
  FileSpreadsheet,
  ListChecks,
  Package,
  User,
  type LucideIcon,
} from 'lucide-react-native';
import React, { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { localToday } from '../../lib/dates';
import {
  BASIS_LABELS,
  buildPharmacyList,
  LIST_LIMITS,
  LIST_MONTHS,
  loadListSettings,
  newListSettings,
  pharmacyListCsv,
  saveListSettings,
  SECTION_LABELS,
  type ListItem,
  type ListSection,
  type ListSettings,
} from '../../plan/pharmacyList';
import { loadHousehold } from '../../resilience/resilienceCalculator';
import {
  Button,
  Chip,
  Notice,
  Panel,
  ScreenTitle,
  Stepper,
} from '../components/controls';
import { useNavigation } from '../navigation';
import { useSession } from '../session';
import { colors, radius, space, text, tint } from '../theme';
import { useBack } from '../useBackHandler';
import { useLoader } from '../useLoader';
import { PharmacyInventory } from './PharmacyScreen';

const SECTIONS: ListSection[] = ['adults', 'children', 'household', 'gear'];

export function PharmacyListScreen() {
  const { db, files } = useSession();
  const navigation = useNavigation();
  const today = localToday();
  const { data, error } = useLoader(async () => {
    const saved = await loadListSettings(db);
    if (saved) {
      return saved;
    }
    const h = await loadHousehold(db);
    const children = (h.children ?? 0) + (h.babies ?? 0);
    return newListSettings(h.members - children, children);
  }, []);
  const [settings, setSettings] = useState<ListSettings | null>(null);
  const [inventory, setInventory] = useState(false);
  const [feedback, setFeedback] = useState<{
    tone: 'ok' | 'error';
    message: string;
  } | null>(null);
  useBack(inventory, () => setInventory(false));
  useEffect(() => {
    if (data && settings === null) {
      setSettings(data);
    }
  }, [data, settings]);

  if (error) {
    return (
      <View style={styles.page}>
        <Notice tone="error" message={error} />
      </View>
    );
  }
  if (settings === null) {
    return null;
  }
  if (inventory) {
    return <PharmacyInventory onBack={() => setInventory(false)} />;
  }

  const save = (next: ListSettings) => {
    setSettings(next);
    setFeedback(null);
    saveListSettings(db, next).catch((e: unknown) =>
      setFeedback({
        tone: 'error',
        message: e instanceof Error ? e.message : String(e),
      }),
    );
  };
  /** Un réglage changé masque la liste jusqu'à la prochaine génération. */
  const change = (patch: Partial<ListSettings>) =>
    save({ ...settings, ...patch, generated: false });

  const people = settings.adults + settings.children;
  const items = settings.generated ? buildPharmacyList(settings) : [];
  const done = items.filter(i => settings.checked.includes(i.id)).length;

  const exportCsv = async () => {
    try {
      const saved = await files.saveText(
        `fenrir-pharmacie-familiale-${today}.csv`,
        'text/csv',
        pharmacyListCsv(settings, today),
      );
      setFeedback(
        saved
          ? { tone: 'ok', message: 'Liste exportée en tableur.' }
          : { tone: 'error', message: 'Export annulé.' },
      );
    } catch (e) {
      setFeedback({
        tone: 'error',
        message: e instanceof Error ? e.message : String(e),
      });
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.page}>
      <ScreenTitle
        title="Pharmacie familiale"
        onBack={navigation.close}
        backLabel={navigation.backLabel}
      />
      <Text style={text.muted}>
        Choisissez la composition du foyer et la durée d’autonomie pour générer
        une liste de préparation.
      </Text>

      <Panel title="01 · Composition du foyer">
        <Counter
          icon={User}
          label="Adultes"
          value={settings.adults}
          min={settings.children > 0 ? LIST_LIMITS.adults[0] : 1}
          max={LIST_LIMITS.adults[1]}
          less="Retirer un adulte"
          more="Ajouter un adulte"
          onChange={adults => change({ adults })}
        />
        <Counter
          icon={Baby}
          label="Enfants"
          value={settings.children}
          min={settings.adults > 0 ? LIST_LIMITS.children[0] : 1}
          max={LIST_LIMITS.children[1]}
          less="Retirer un enfant"
          more="Ajouter un enfant"
          onChange={children => change({ children })}
        />
      </Panel>

      <Panel title="02 · Durée souhaitée">
        <View style={styles.chips}>
          {LIST_MONTHS.map(months => (
            <Chip
              key={months}
              label={`${months} mois`}
              selected={settings.months === months}
              onPress={() => change({ months })}
            />
          ))}
        </View>
      </Panel>

      <View style={styles.summary}>
        <Text style={text.muted}>
          Foyer :{' '}
          <Text style={styles.strong}>
            {people} personne{people > 1 ? 's' : ''}
          </Text>
        </Text>
        <Text style={text.muted}>
          Autonomie : <Text style={styles.strong}>{settings.months} mois</Text>
        </Text>
      </View>

      <Button
        icon={ListChecks}
        label="Générer ma liste"
        disabled={people === 0}
        onPress={() => save({ ...settings, generated: true })}
      />

      {settings.generated ? (
        <Panel
          title="03 · Liste de préparation"
          right={
            <Text style={text.subtle}>
              {done}/{items.length}
            </Text>
          }
        >
          <Text style={text.subtle}>
            {settings.adults} adulte(s), {settings.children} enfant(s) ·{' '}
            {settings.months} mois d’autonomie
          </Text>
          <View style={styles.warning}>
            <AlertTriangle color={colors.warning} size={18} />
            <Text style={[text.muted, styles.grow]}>
              Liste indicative, pas une prescription. Les quantités estimées
              viennent de fréquences publiées et des notices, pour des adultes ;
              le reste se décide avec votre pharmacien, surtout pour les enfants
              (dose selon le poids et l’âge).
            </Text>
          </View>
          {SECTIONS.map(section => {
            const rows = items.filter(i => i.section === section);
            return rows.length === 0 ? null : (
              <View key={section} style={styles.section}>
                <Text style={text.label}>{SECTION_LABELS[section]}</Text>
                {rows.map(item => (
                  <ItemRow
                    key={item.id}
                    item={item}
                    checked={settings.checked.includes(item.id)}
                    onToggle={() =>
                      save({
                        ...settings,
                        checked: settings.checked.includes(item.id)
                          ? settings.checked.filter(id => id !== item.id)
                          : [...settings.checked, item.id],
                      })
                    }
                  />
                ))}
              </View>
            );
          })}
          {files.available ? (
            <Button
              variant="secondary"
              icon={FileSpreadsheet}
              label="Exporter en tableur"
              onPress={() => {
                void exportCsv();
              }}
            />
          ) : null}
        </Panel>
      ) : null}
      {feedback ? (
        <Notice tone={feedback.tone} message={feedback.message} />
      ) : null}

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Ouvrir mon stock de pharmacie"
        onPress={() => setInventory(true)}
        style={({ pressed }) => [styles.stock, pressed && styles.pressed]}
      >
        <View style={[styles.icon, { backgroundColor: tint(colors.health) }]}>
          <Package color={colors.health} size={20} />
        </View>
        <View style={styles.grow}>
          <Text style={styles.title}>Mon stock de pharmacie</Text>
          <Text style={text.subtle}>
            Ce que j’ai déjà, lots et dates de péremption, ce qu’il reste à
            acheter
          </Text>
        </View>
        <ChevronRight color={colors.textMuted} size={20} />
      </Pressable>

      <Text style={[text.subtle, styles.foot]}>
        Les traitements prescrits et le choix des médicaments se valident avec
        un médecin ou un pharmacien. Les doses pédiatriques dépendent du poids
        et de l’âge.
      </Text>
    </ScrollView>
  );
}

function Counter(props: {
  icon: LucideIcon;
  label: string;
  value: number;
  min: number;
  max: number;
  less: string;
  more: string;
  onChange: (n: number) => void;
}) {
  const Icon = props.icon;
  return (
    <View style={styles.row}>
      <Icon color={colors.textMuted} size={20} />
      <Text style={[text.body, styles.grow]}>{props.label}</Text>
      <Stepper
        value={String(props.value)}
        onDecrease={() => props.onChange(props.value - 1)}
        onIncrease={() => props.onChange(props.value + 1)}
        canDecrease={props.value > props.min}
        canIncrease={props.value < props.max}
        decreaseLabel={props.less}
        increaseLabel={props.more}
      />
    </View>
  );
}

function ItemRow(props: {
  item: ListItem;
  checked: boolean;
  onToggle: () => void;
}) {
  const { item } = props;
  const qtyColor =
    item.basis === 'estimate'
      ? colors.cyan
      : item.basis === 'presence'
      ? colors.success
      : colors.warning;
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked: props.checked }}
      accessibilityLabel={`${item.name}, ${item.quantity}`}
      onPress={props.onToggle}
      style={({ pressed }) => [styles.item, pressed && styles.pressed]}
    >
      <View style={styles.grow}>
        <Text style={[styles.title, props.checked && styles.done]}>
          {item.name}
        </Text>
        <Text style={[styles.qty, { color: qtyColor }]}>{item.quantity}</Text>
        <Text style={text.subtle}>{item.detail}</Text>
        {item.basis !== 'advice' ? (
          <Text style={[text.subtle, styles.basis]}>
            {BASIS_LABELS[item.basis]}
          </Text>
        ) : null}
        {item.caution ? (
          <Text style={[text.subtle, { color: colors.danger }]}>
            {item.caution}
          </Text>
        ) : null}
        {item.sources.length > 0 ? (
          <Text style={[text.subtle, styles.sources]}>
            Sources : {item.sources.join(' · ')}
          </Text>
        ) : null}
      </View>
      <View
        style={[
          styles.box,
          props.checked && {
            backgroundColor: colors.success,
            borderColor: colors.success,
          },
        ]}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  page: { padding: space.l, gap: space.m, paddingBottom: space.xl },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.m,
    minHeight: 56,
  },
  grow: { flex: 1, minWidth: 0 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.s },
  summary: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    gap: space.s,
    padding: space.m,
    borderRadius: radius.s,
    backgroundColor: colors.surface,
  },
  strong: { color: colors.text, fontWeight: '700' },
  section: { gap: space.xs, marginTop: space.s },
  item: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.m,
    paddingVertical: space.m,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  title: { ...text.body, fontWeight: '600' },
  done: { color: colors.textMuted, textDecorationLine: 'line-through' },
  qty: { ...text.body, fontWeight: '700', marginVertical: 2 },
  basis: { fontStyle: 'italic' },
  sources: { fontSize: 12, lineHeight: 16 },
  box: {
    width: 24,
    height: 24,
    marginTop: 2,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: colors.textMuted,
  },
  stock: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.m,
    padding: space.m,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  icon: {
    width: 36,
    height: 36,
    borderRadius: radius.s,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: { opacity: 0.82 },
  foot: { textAlign: 'center' },
  warning: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.s,
    padding: space.m,
    borderRadius: radius.s,
    borderWidth: 1,
    borderColor: colors.warning,
    backgroundColor: colors.bg,
  },
});
