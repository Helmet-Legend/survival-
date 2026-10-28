/**
 * Pharmacie familiale : adultes, poids de chaque enfant, durée et marge,
 * puis « Calculer mon stock ». Chaque médicament et le petit matériel
 * reçoivent un nombre de boîtes ; l'utilisateur indique ce qu'il a, Fenrir
 * dit ce qu'il manque. Un tableau montre la progression de 1 à 6 adultes.
 * Les repères non sourcés sont signalés ; aucune posologie n'est affichée.
 */
import {
  AlertTriangle,
  Baby,
  Check,
  ChevronDown,
  ChevronRight,
  FileSpreadsheet,
  ListChecks,
  Package,
  Plus,
  Trash2,
  User,
  type LucideIcon,
} from 'lucide-react-native';
import React, { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { localToday } from '../../lib/dates';
import {
  ADULT_WEIGHT,
  boxesByChildren,
  DURATIONS,
  INFANT_WEIGHT,
  NATIONAL_USE,
  PARACETAMOL_PER_VISIT,
  WEIGHT_RANGE,
  type CatalogueMed,
  type MedCategory,
} from '../../plan/pharmacyEngine';
import {
  boxesByAdults,
  buildPharmacyList,
  CATEGORY_LABELS,
  formatBoxes,
  formatQuantity,
  HAVE_MAX,
  LIST_LIMITS,
  loadListSettings,
  medInfo,
  newListSettings,
  pharmacyListCsv,
  saveListSettings,
  stockSummary,
  stockTable,
  STOCK_RULES,
  type ListItem,
  type ListSettings,
  type StockRow,
} from '../../plan/pharmacyList';
import { loadHousehold } from '../../resilience/resilienceCalculator';
import {
  Button,
  Chip,
  Field,
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

/** Toutes les rubriques du moteur, dans l'ordre d'affichage. */
const CATEGORIES = Object.keys(CATEGORY_LABELS) as MedCategory[];

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
  // Rubriques et explications repliées : la page tient sur peu d'écran.
  const [open, setOpen] = useState<string[]>([]);
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
  /** Un réglage du foyer changé masque le calcul jusqu'au prochain. */
  const change = (patch: Partial<ListSettings>) =>
    save({ ...settings, ...patch, generated: false });
  const toggle = (key: string) =>
    setOpen(open.includes(key) ? open.filter(k => k !== key) : [...open, key]);

  const people = settings.adults + settings.childWeights.length;
  const table = settings.generated ? stockTable(settings) : null;
  const summary = table ? stockSummary(table.rows) : null;
  const advice = settings.generated ? buildPharmacyList(settings) : [];
  const weights = settings.childWeights.filter((w): w is number => w !== null);
  const childWeight =
    weights.length === 0
      ? null
      : weights.reduce((a, b) => a + b, 0) / weights.length;
  const setHave = (ref: string, n: number) =>
    save({ ...settings, have: { ...settings.have, [ref]: n } });

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
    <ScrollView
      contentContainerStyle={styles.page}
      keyboardShouldPersistTaps="handled"
    >
      <ScreenTitle
        title="Pharmacie familiale"
        onBack={navigation.close}
        backLabel={navigation.backLabel}
      />
      <View style={styles.banner}>
        <AlertTriangle color={colors.warning} size={20} />
        <Text style={[text.body, styles.grow]}>
          Estimation : données à moduler selon vos besoins spécifiques.
        </Text>
      </View>
      <Text style={text.muted}>
        Indiquez le foyer et la durée : Fenrir calcule combien de boîtes de
        chaque médicament et de matériel stocker, puis ce qu’il vous manque.
      </Text>

      <Panel title="01 · Composition du foyer">
        <Counter
          icon={User}
          label="Adultes"
          value={settings.adults}
          min={settings.childWeights.length > 0 ? LIST_LIMITS.adults[0] : 1}
          max={LIST_LIMITS.adults[1]}
          less="Retirer un adulte"
          more="Ajouter un adulte"
          onChange={adults => change({ adults })}
        />
        {settings.childWeights.map((weight, i) => (
          <View key={i} style={styles.child}>
            <Baby color={colors.textMuted} size={20} />
            <View style={styles.grow}>
              <WeightField
                label={`Enfant ${i + 1} : poids en kg`}
                value={weight}
                onChange={w =>
                  change({
                    childWeights: settings.childWeights.map((x, j) =>
                      j === i ? w : x,
                    ),
                  })
                }
              />
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Retirer l’enfant ${i + 1}`}
              disabled={settings.adults === 0 && people === 1}
              onPress={() =>
                change({
                  childWeights: settings.childWeights.filter((_, j) => j !== i),
                })
              }
              style={styles.trash}
            >
              <Trash2 color={colors.textMuted} size={20} />
            </Pressable>
          </View>
        ))}
        {settings.childWeights.length < LIST_LIMITS.children[1] ? (
          <Button
            variant="secondary"
            compact
            icon={Plus}
            label="Ajouter un enfant"
            onPress={() =>
              change({ childWeights: [...settings.childWeights, null] })
            }
          />
        ) : null}
        <Text style={text.subtle}>
          Le poids sert à choisir la forme de paracétamol : sirop sous 25 kg,
          500 mg de 25 à 40 kg, comprimés adultes au-delà ; la dose se lit sur
          la notice ou se demande au pharmacien.
        </Text>
      </Panel>

      <Panel title="02 · Durée d’autonomie">
        <View style={styles.chips}>
          {DURATIONS.map(d => (
            <Chip
              key={d}
              label={`${d} jours`}
              selected={settings.days === d}
              onPress={() => change({ days: d })}
            />
          ))}
        </View>
        <Text style={text.subtle}>
          Calculé pour une crise sans réapprovisionnement : le stock se partage
          dans le foyer, et 90 jours ne demandent que 1,5 fois la dotation de 30
          jours ; le matériel fixe ne change pas.
        </Text>
      </Panel>

      <Button
        icon={ListChecks}
        label="Calculer mon stock"
        disabled={people === 0}
        onPress={() => save({ ...settings, generated: true })}
      />

      {table && summary ? (
        <Panel
          title="03 · Mon stock à constituer"
          right={
            <Text style={text.subtle}>
              {summary.complete}/{summary.total} complets
            </Text>
          }
        >
          <Text style={text.subtle}>
            {settings.adults} adulte(s), {settings.childWeights.length}{' '}
            enfant(s) · {settings.days} jours
          </Text>
          <View style={styles.figures}>
            <Figure label="Boîtes à stocker" value={summary.boxes} />
            <Figure label="J’en ai" value={summary.have} />
            <Figure
              label="Il manque"
              value={summary.missing}
              color={summary.missing > 0 ? colors.warning : colors.success}
            />
          </View>
          {table.result.missingWeights > 0 ? (
            <Text style={[text.subtle, { color: colors.warning }]}>
              Poids à indiquer pour{' '}
              {settings.childWeights.filter(w => w === null).length} enfant(s) :
              leur paracétamol pédiatrique n’est pas compté.
            </Text>
          ) : null}
          {table.result.infant ? (
            <Text style={[text.subtle, { color: colors.warning }]}>
              Nourrisson de moins de {INFANT_WEIGHT} kg : pas de lopéramide ni
              de diosmectite pour lui, chlorhexidine aqueuse comme antiseptique,
              kit nourrisson ajouté.
            </Text>
          ) : null}
          {table.result.pharmacyVisits > 0 ? (
            <Text style={text.subtle}>
              Paracétamol : au plus {PARACETAMOL_PER_VISIT} boîtes par passage
              sans ordonnance (ANSM), soit environ {table.result.pharmacyVisits}{' '}
              passage(s) en pharmacie à étaler.
            </Text>
          ) : null}
          <Fold
            label="Comment c’est calculé"
            open={open.includes('how')}
            onToggle={() => toggle('how')}
          >
            <Text style={text.subtle}>
              1. Profil par le poids : adultes et enfants de {ADULT_WEIGHT} kg
              ou plus (formes adultes), enfants de {INFANT_WEIGHT} à{' '}
              {ADULT_WEIGHT} kg, bas âge sous {INFANT_WEIGHT} kg.
            </Text>
            <Text style={text.subtle}>
              2. Besoin mutualisé pour 30 jours : un socle pour le foyer, plus
              une part par personne concernée (détail dans chaque fiche).
            </Text>
            <Text style={text.subtle}>
              3. Durée amortie : 15 jours × 0,8 ; 30 jours × 1 ; 45 jours × 1,15
              ; 90 jours × 1,5. Le matériel fixe (garrots, thermomètre, trousse,
              ciseaux…) ne change pas.
            </Text>
            <Text style={text.subtle}>
              4. Boîtes = besoin ÷ unités par boîte, arrondi au-dessus
              (l’arrondi sert de marge), au moins 1.
            </Text>
            <Text style={text.subtle}>
              Modèle de mutualisation du cahier des charges Fenrir ; socles et
              parts par personne : repères non sourcés, à valider.
            </Text>
            {STOCK_RULES.map(rule => (
              <Text key={rule} style={text.subtle}>
                • {rule}
              </Text>
            ))}
          </Fold>
          {CATEGORIES.map(category => {
            const rows = table.rows.filter(r => r.med.categorie === category);
            if (rows.length === 0) {
              return null;
            }
            const complete = rows.filter(r => r.missing === 0).length;
            const isOpen = open.includes(category);
            const Chevron = isOpen ? ChevronDown : ChevronRight;
            return (
              <View key={category}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ expanded: isOpen }}
                  accessibilityLabel={`${CATEGORY_LABELS[category]}, ${complete} sur ${rows.length} complets`}
                  onPress={() => toggle(category)}
                  style={({ pressed }) => [
                    styles.sectionHead,
                    pressed && styles.pressed,
                  ]}
                >
                  <Text style={[text.label, styles.grow]}>
                    {CATEGORY_LABELS[category]}
                  </Text>
                  <Text
                    style={[
                      text.subtle,
                      complete === rows.length && { color: colors.success },
                    ]}
                  >
                    {complete}/{rows.length}
                  </Text>
                  <Chevron color={colors.textMuted} size={18} />
                </Pressable>
                {isOpen
                  ? rows.map(row => (
                      <StockLine
                        key={row.ref}
                        row={row}
                        people={people}
                        days={settings.days}
                        open={open.includes(`d:${row.ref}`)}
                        onToggle={() => toggle(`d:${row.ref}`)}
                        onHave={n => setHave(row.ref, n)}
                      />
                    ))
                  : null}
              </View>
            );
          })}
        </Panel>
      ) : null}

      {table ? (
        <Panel title="04 · Selon la taille du foyer">
          <Fold
            label={`Pour 1 à 6 adultes (${settings.days} jours)`}
            open={open.includes('scale')}
            onToggle={() => toggle('scale')}
          >
            <ScaleTable head="Adultes" rows={boxesByAdults(settings)} />
          </Fold>
          <Fold
            label="Pour 1 à 6 enfants"
            open={open.includes('scaleKids')}
            onToggle={() => toggle('scaleKids')}
          >
            {childWeight === null ? (
              <Text style={text.subtle}>
                Indiquez le poids d’au moins un enfant : le tableau prend leur
                poids moyen.
              </Text>
            ) : (
              <>
                <Text style={text.subtle}>
                  Enfants de {fmt(childWeight)} kg (poids moyen saisi), sans
                  adulte.
                </Text>
                <ScaleTable
                  head="Enfants"
                  rows={boxesByChildren(settings, childWeight)}
                />
              </>
            )}
          </Fold>
        </Panel>
      ) : null}

      {settings.generated ? (
        <Panel
          title="05 · À voir avec le pharmacien"
          right={
            <Text style={text.subtle}>
              {advice.filter(i => settings.checked.includes(i.id)).length}/
              {advice.length}
            </Text>
          }
        >
          {advice.map(item => (
            <AdviceRow
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
          <Text style={styles.title}>Lots et péremptions</Text>
          <Text style={text.subtle}>
            Suivre chaque boîte avec sa date de péremption, alertes avant
            qu’elle périme
          </Text>
        </View>
        <ChevronRight color={colors.textMuted} size={20} />
      </Pressable>
    </ScrollView>
  );
}

const fmt = (n: number) =>
  (Math.round(n * 1000) / 1000).toString().replace('.', ',');

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

/** Bloc repliable : une ligne, le détail sur un appui. */
function Fold(props: {
  label: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  const Chevron = props.open ? ChevronDown : ChevronRight;
  return (
    <View style={styles.fold}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: props.open }}
        accessibilityLabel={props.label}
        onPress={props.onToggle}
        style={styles.foldHead}
      >
        <AlertTriangle color={colors.warning} size={16} />
        <Text style={[text.muted, styles.grow]}>{props.label}</Text>
        <Chevron color={colors.textMuted} size={18} />
      </Pressable>
      {props.open ? <View style={styles.details}>{props.children}</View> : null}
    </View>
  );
}

function StockLine(props: {
  row: StockRow;
  people: number;
  days: number;
  open: boolean;
  onToggle: () => void;
  onHave: (n: number) => void;
}) {
  const { row } = props;
  const info = medInfo(row.med);
  const done = row.missing === 0;
  return (
    <View style={styles.item}>
      <View style={styles.row}>
        <View style={styles.grow}>
          <Text style={styles.title}>{row.med.nom}</Text>
          <Text style={[styles.qty, { color: colors.cyan }]}>
            À stocker : {formatBoxes(row.boxes, row.med)}
          </Text>
        </View>
        {done ? (
          <View style={styles.done}>
            <Check color={colors.success} size={16} />
            <Text style={[text.subtle, { color: colors.success }]}>
              Complet
            </Text>
          </View>
        ) : (
          <Text style={[styles.qty, { color: colors.warning }]}>
            Il manque {row.missing}
          </Text>
        )}
      </View>
      <View style={styles.row}>
        <Text style={[text.muted, styles.grow]}>J’en ai</Text>
        <Stepper
          value={String(row.have)}
          onDecrease={() => props.onHave(row.have - 1)}
          onIncrease={() => props.onHave(row.have + 1)}
          canDecrease={row.have > 0}
          canIncrease={row.have < HAVE_MAX}
          decreaseLabel={`Une de moins : ${row.med.nom}`}
          increaseLabel={`Une de plus : ${row.med.nom}`}
        />
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: props.open }}
        accessibilityLabel={`${
          props.open ? 'Masquer' : 'Afficher'
        } les détails : ${row.med.nom}`}
        onPress={props.onToggle}
      >
        <Text style={text.muted}>{row.med.usage}</Text>
        {props.open ? (
          <View style={styles.details}>
            <Text style={text.subtle}>
              Quantité totale : {formatQuantity(row.withMargin, row.med.format)}{' '}
              (marge comprise) · {row.med.boiteSource}
            </Text>
            <Text style={text.subtle}>Pour : {row.from.join(', ')}</Text>
            {NATIONAL_USE[row.ref] ? (
              <Text style={text.subtle}>
                Repère de consommation : {NATIONAL_USE[row.ref].source}. Au même
                rythme, votre foyer en utiliserait environ{' '}
                {Math.round(
                  (NATIONAL_USE[row.ref].perYear * props.people * props.days) /
                    365,
                )}{' '}
                boîtes sur la durée (tous dosages, ordonnances comprises).
              </Text>
            ) : null}
            <Text
              style={[
                text.subtle,
                styles.basis,
                !row.sourced && { color: colors.warning },
              ]}
            >
              {row.sourced
                ? 'Fréquence publiée, pas une prescription'
                : 'Repère non sourcé, à valider'}
            </Text>
            {info.practical ? (
              <Text style={text.subtle}>{info.practical}</Text>
            ) : null}
            {info.caution ? (
              <Text style={[text.subtle, { color: colors.danger }]}>
                {info.caution}
              </Text>
            ) : null}
            <Text style={[text.subtle, styles.sources]}>
              Sources :{' '}
              {[...row.sources, info.deliverySource ?? '']
                .filter(Boolean)
                .join(' · ')}
            </Text>
          </View>
        ) : (
          <Text style={[text.subtle, styles.more]}>Détails et sources</Text>
        )}
      </Pressable>
    </View>
  );
}

/** Boîtes pour 1 à 6 personnes : la progression d'un coup d'œil. */
function ScaleTable(props: {
  head: string;
  rows: { ref: string; med: CatalogueMed; boxes: number[] }[];
}) {
  const { rows } = props;
  return (
    <View>
      <View style={styles.scaleRow}>
        <Text style={[text.label, styles.scaleName]}>{props.head}</Text>
        {rows[0]?.boxes.map((_, i) => (
          <Text key={i} style={[text.label, styles.scaleCell]}>
            {i + 1}
          </Text>
        ))}
      </View>
      {rows.map(r => (
        <View key={r.ref} style={styles.scaleRow}>
          <Text style={[text.subtle, styles.scaleName]} numberOfLines={3}>
            {r.med.nom}
          </Text>
          {r.boxes.map((n, i) => (
            <Text key={i} style={[text.body, styles.scaleCell]}>
              {n}
            </Text>
          ))}
        </View>
      ))}
      <Text style={text.subtle}>
        En boîtes, flacons ou conditionnements ; le matériel durable reste fixe,
        le consommable croît moins vite que les médicaments.
      </Text>
    </View>
  );
}

function AdviceRow(props: {
  item: ListItem;
  checked: boolean;
  onToggle: () => void;
}) {
  const { item } = props;
  const [open, setOpen] = useState(false);
  return (
    <View style={[styles.item, styles.row]}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={`${open ? 'Masquer' : 'Afficher'} les détails : ${
          item.name
        }`}
        onPress={() => setOpen(!open)}
        style={styles.grow}
      >
        <Text style={[styles.title, props.checked && styles.doneText]}>
          {item.name}
        </Text>
        <Text style={[styles.qty, { color: colors.warning }]}>
          {item.quantity}
        </Text>
        <Text style={text.muted}>{item.use}</Text>
        {open ? (
          <View style={styles.details}>
            <Text style={text.subtle}>{item.detail}</Text>
            {item.consult ? (
              <Text style={text.subtle}>Quand consulter : {item.consult}</Text>
            ) : null}
            {item.practical ? (
              <Text style={text.subtle}>{item.practical}</Text>
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
        ) : null}
      </Pressable>
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked: props.checked }}
        accessibilityLabel={`${item.name}, ${item.quantity}`}
        onPress={props.onToggle}
        hitSlop={12}
        style={[
          styles.box,
          props.checked && {
            backgroundColor: colors.success,
            borderColor: colors.success,
          },
        ]}
      />
    </View>
  );
}

function Figure(props: { label: string; value: number; color?: string }) {
  return (
    <View style={styles.figure}>
      <Text style={[styles.figureValue, props.color && { color: props.color }]}>
        {props.value}
      </Text>
      <Text style={[text.subtle, styles.center]}>{props.label}</Text>
    </View>
  );
}

/** Poids en kg ; vide = à indiquer ; une saisie hors limites n'est pas gardée. */
function WeightField(props: {
  label: string;
  value: number | null;
  onChange: (n: number | null) => void;
}) {
  const [draft, setDraft] = useState(
    props.value === null ? '' : String(props.value).replace('.', ','),
  );
  const [error, setError] = useState<string | null>(null);
  return (
    <Field
      label={props.label}
      value={draft}
      keyboardType="decimal-pad"
      placeholder="À indiquer"
      error={error}
      onChangeText={t => {
        setDraft(t);
        const trimmed = t.trim().replace(',', '.');
        if (trimmed === '') {
          setError(null);
          props.onChange(null);
          return;
        }
        const n = Number(trimmed);
        if (!Number.isFinite(n) || n < WEIGHT_RANGE[0] || n > WEIGHT_RANGE[1]) {
          setError(`Entre ${WEIGHT_RANGE[0]} et ${WEIGHT_RANGE[1]} kg.`);
          return;
        }
        setError(null);
        props.onChange(n);
      }}
    />
  );
}

const styles = StyleSheet.create({
  page: { padding: space.l, gap: space.m, paddingBottom: space.xl },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.m },
  grow: { flex: 1, minWidth: 0 },
  center: { textAlign: 'center' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.s },
  child: { flexDirection: 'row', alignItems: 'flex-start', gap: space.m },
  trash: { padding: space.s, marginTop: space.l },
  figures: { flexDirection: 'row', gap: space.s },
  figure: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: space.s,
    borderRadius: radius.s,
    backgroundColor: colors.bg,
  },
  figureValue: { ...text.h2, fontVariant: ['tabular-nums'] },
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.s,
    minHeight: 48,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  item: {
    gap: space.xs,
    paddingVertical: space.m,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  title: { ...text.body, fontWeight: '600' },
  doneText: { color: colors.textMuted, textDecorationLine: 'line-through' },
  qty: { ...text.body, fontWeight: '700' },
  done: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  details: { gap: space.xs, marginTop: space.xs },
  more: { color: colors.cyan, marginTop: space.xs },
  basis: { fontStyle: 'italic' },
  sources: { fontSize: 12, lineHeight: 16 },
  fold: {
    padding: space.m,
    borderRadius: radius.s,
    borderWidth: 1,
    borderColor: colors.warning,
    backgroundColor: colors.bg,
  },
  foldHead: { flexDirection: 'row', alignItems: 'center', gap: space.s },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.s,
    padding: space.m,
    borderRadius: radius.s,
    borderWidth: 1,
    borderColor: colors.warning,
    backgroundColor: tint(colors.warning),
  },
  scaleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingVertical: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  scaleName: { flex: 1, minWidth: 0, paddingRight: space.xs },
  scaleCell: {
    width: 24,
    fontSize: 14,
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
  },
  box: {
    width: 24,
    height: 24,
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
});
