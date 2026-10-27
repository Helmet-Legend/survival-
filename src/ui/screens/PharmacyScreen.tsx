/**
 * Stock de pharmacie : objectif de stock de produits de santé pour une durée
 * d'autonomie, inventaire par lots, alertes (péremption, froid, doublons) et
 * export en tableur. Jamais de posologie : les quantités viennent de
 * l'utilisateur ou de l'ordonnance, une donnée absente est signalée.
 */
import {
  AlertTriangle,
  FileSpreadsheet,
  Pill,
  Plus,
  Trash2,
} from 'lucide-react-native';
import React, { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { localToday } from '../../lib/dates';
import {
  computeLine,
  DELIVERY_LABELS,
  DAYS_PER_MONTH,
  DURATION_LABELS,
  durationDays,
  KIND_LABELS,
  lineError,
  lineFromCatalog,
  loadPharmacyPlan,
  MISSING_LABELS,
  newPlan,
  PHARMACY_CATALOG,
  pharmacyAlerts,
  pharmacyCsv,
  savePharmacyPlan,
  STORAGE_LABELS,
  type CatalogEntry,
  type DurationUnit,
  type LineResult,
  type PharmacyAlert,
  type PharmacyKind,
  type PharmacyLine,
  type PharmacyPlan,
  type Storage,
} from '../../plan/pharmacy';
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
import { useSession } from '../session';
import { colors, radius, space, text, tint } from '../theme';
import { useBack } from '../useBackHandler';
import { useLoader } from '../useLoader';

const KINDS: PharmacyKind[] = ['occasional', 'consumable', 'prescribed'];
const UNITS: DurationUnit[] = ['days', 'weeks', 'months'];
const MARGINS = [0, 10, 20, 30];
const STORAGES: Storage[] = ['ambient', 'cold', 'unknown'];
/** Libellés courts des puces ; le libellé complet reste dans l'export. */
const STORAGE_CHIPS: Record<Storage, string> = {
  ambient: 'Ambiante',
  cold: 'Au frais, 2 à 8 °C',
  unknown: 'À vérifier',
};

let counter = 0;
const newId = () => `${Date.now().toString(36)}-${(++counter).toString(36)}`;

/** Stock réel de pharmacie, ouvert depuis la liste de pharmacie familiale. */
export function PharmacyInventory(props: { onBack: () => void }) {
  const { db, files } = useSession();
  const today = localToday();
  const { data, error } = useLoader(async () => {
    const saved = await loadPharmacyPlan(db);
    return saved ?? newPlan((await loadHousehold(db)).members);
  }, []);
  const [plan, setPlan] = useState<PharmacyPlan | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [feedback, setFeedback] = useState<{
    tone: 'ok' | 'error';
    message: string;
  } | null>(null);
  useBack(editing !== null || adding, () => {
    setEditing(null);
    setAdding(false);
  });
  useEffect(() => {
    if (data && plan === null) {
      setPlan(data);
    }
  }, [data, plan]);

  /** Chaque modification valide est enregistrée aussitôt dans le coffre. */
  const update = (next: PharmacyPlan) => {
    setPlan(next);
    setFeedback(null);
    savePharmacyPlan(db, next).catch((e: unknown) =>
      setFeedback({
        tone: 'error',
        message: e instanceof Error ? e.message : String(e),
      }),
    );
  };

  if (error) {
    return (
      <View style={styles.page}>
        <Notice tone="error" message={error} />
      </View>
    );
  }
  if (plan === null) {
    return null;
  }

  const editedLine = plan.lines.find(l => l.id === editing);
  if (editedLine) {
    return (
      <LineEditor
        line={editedLine}
        plan={plan}
        today={today}
        onChange={line =>
          update({
            ...plan,
            lines: plan.lines.map(l => (l.id === line.id ? line : l)),
          })
        }
        onDelete={() => {
          update({ ...plan, lines: plan.lines.filter(l => l.id !== editing) });
          setEditing(null);
        }}
        onBack={() => setEditing(null)}
        feedback={feedback}
      />
    );
  }
  if (adding) {
    return (
      <CatalogPicker
        onBack={() => setAdding(false)}
        onPick={entry => {
          const id = newId();
          const line: PharmacyLine = entry
            ? lineFromCatalog(entry, id)
            : {
                id,
                name: 'Nouveau produit',
                need: 'À préciser',
                kind: 'occasional',
                unit: 'unité',
                storage: 'unknown',
                lots: [],
              };
          update({ ...plan, lines: [...plan.lines, line] });
          setAdding(false);
          setEditing(id);
        }}
      />
    );
  }

  const results = plan.lines.map(l => computeLine(l, plan, today));
  const alerts = pharmacyAlerts(plan, today);
  const days = durationDays(plan.duration);
  const toComplete = results.filter(r => (r.toBuyPacks ?? 0) > 0).length;
  const incomplete = results.filter(
    r => r.missing.length > 0 || r.needsValidation,
  ).length;
  const complete = results.filter(
    r => r.toBuyPacks === 0 && r.missing.length === 0 && !r.needsValidation,
  ).length;

  const exportCsv = async () => {
    try {
      const saved = await files.saveText(
        `fenrir-pharmacie-${today}.csv`,
        'text/csv',
        pharmacyCsv(plan, today),
      );
      setFeedback(
        saved
          ? { tone: 'ok', message: 'Pharmacie exportée en tableur.' }
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
        title="Stock de pharmacie"
        onBack={props.onBack}
        backLabel="Retour à la liste de pharmacie"
      />
      <Text style={text.muted}>
        Estimation du stock pour tenir la durée choisie, pas une posologie.
        Repères sourcés et modifiables ; à faire valider par votre pharmacien.
      </Text>

      <Panel title="Foyer et durée">
        <View style={styles.row}>
          <Text style={[text.body, styles.grow]}>Personnes</Text>
          <Stepper
            value={String(plan.persons)}
            onDecrease={() => update({ ...plan, persons: plan.persons - 1 })}
            onIncrease={() => update({ ...plan, persons: plan.persons + 1 })}
            canDecrease={plan.persons > 1}
            canIncrease={plan.persons < 50}
            decreaseLabel="Une personne de moins"
            increaseLabel="Une personne de plus"
          />
        </View>
        <View style={styles.row}>
          <Text style={[text.body, styles.grow]}>Durée</Text>
          <Stepper
            value={String(plan.duration.value)}
            onDecrease={() =>
              update({
                ...plan,
                duration: { ...plan.duration, value: plan.duration.value - 1 },
              })
            }
            onIncrease={() =>
              update({
                ...plan,
                duration: { ...plan.duration, value: plan.duration.value + 1 },
              })
            }
            canDecrease={plan.duration.value > 1}
            canIncrease={
              durationDays({
                ...plan.duration,
                value: plan.duration.value + 1,
              }) <= 3650
            }
            decreaseLabel="Durée plus courte"
            increaseLabel="Durée plus longue"
          />
        </View>
        <View style={styles.chips}>
          {UNITS.map(unit => (
            <Chip
              key={unit}
              label={DURATION_LABELS[unit][1]}
              selected={plan.duration.unit === unit}
              onPress={() => {
                const next = { ...plan.duration, unit };
                if (durationDays(next) <= 3650) {
                  update({ ...plan, duration: next });
                }
              }}
            />
          ))}
        </View>
        <Text style={text.subtle}>
          Soit {days} jours (1 mois = {DAYS_PER_MONTH} jours).
        </Text>
        <Text style={text.label}>Marge logistique</Text>
        <View style={styles.chips}>
          {MARGINS.map(m => (
            <Chip
              key={m}
              label={`${m} %`}
              selected={plan.marginPercent === m}
              onPress={() => update({ ...plan, marginPercent: m })}
            />
          ))}
        </View>
        <Text style={text.subtle}>
          Ajoutée aux estimations, pas aux boîtes choisies à la main.
        </Text>
      </Panel>

      <Panel title="Bilan">
        <Text style={text.body}>
          {plan.lines.length === 0
            ? 'Aucun produit : ajoutez-en depuis le catalogue.'
            : `${plan.lines.length} produit${
                plan.lines.length > 1 ? 's' : ''
              } · ${complete} complet${
                complete > 1 ? 's' : ''
              } · ${toComplete} à compléter · ${incomplete} avec des données à fournir`}
        </Text>
        {alerts.map((alert, i) => (
          <AlertRow key={i} alert={alert} />
        ))}
      </Panel>

      {results.map(r => (
        <LineCard
          key={r.line.id}
          result={r}
          onPress={() => setEditing(r.line.id)}
        />
      ))}

      <Button
        icon={Plus}
        label="Ajouter un produit"
        onPress={() => setAdding(true)}
      />
      {files.available && plan.lines.length > 0 ? (
        <Button
          variant="secondary"
          icon={FileSpreadsheet}
          label="Exporter en tableur"
          onPress={() => {
            void exportCsv();
          }}
        />
      ) : null}
      {feedback ? (
        <Notice tone={feedback.tone} message={feedback.message} />
      ) : null}

      <Panel title="Hypothèses et formule">
        <Text style={text.muted}>
          Consommable : unités = quantité par personne et par mois × personnes ×
          jours ÷ {DAYS_PER_MONTH} × (1 + marge), arrondi à l’unité, puis au
          conditionnement supérieur.
        </Text>
        <Text style={text.muted}>
          Médicament occasionnel : unités = épisodes par personne et par an ×
          personnes × jours ÷ 365 × unités au plus par épisode × (1 + marge),
          puis arrondi à la boîte. Les repères préremplis citent leur source
          (fréquence publiée, notice) et se modifient ; ils valent pour un
          adulte. Sans repère publié, c’est à vous de les indiquer.
        </Text>
        <Text style={text.muted}>
          Traitement prescrit : unités = quantité par jour de l’ordonnance ×
          personnes concernées × jours × (1 + marge), arrondi au conditionnement
          supérieur. À faire valider par le médecin.
        </Text>
        <Text style={text.muted}>
          Stock : seuls les lots non périmés comptent. À acheter = objectif −
          stock utilisable, jamais négatif.
        </Text>
      </Panel>
    </ScrollView>
  );
}

function AlertRow({ alert }: { alert: PharmacyAlert }) {
  const color =
    alert.kind === 'expired' || alert.kind === 'duplicate'
      ? colors.danger
      : colors.warning;
  return (
    <View style={[styles.alert, { borderColor: color }]}>
      <AlertTriangle color={color} size={18} />
      <Text style={[text.body, styles.grow]}>{alert.message}</Text>
    </View>
  );
}

function LineCard(props: { result: LineResult; onPress: () => void }) {
  const r = props.result;
  const pending = [
    ...r.missing.map(m => MISSING_LABELS[m]),
    ...(r.needsValidation ? ['À valider avec le médecin'] : []),
  ];
  const status =
    r.toBuyPacks === null
      ? colors.textMuted
      : r.toBuyPacks > 0
      ? colors.warning
      : colors.success;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${r.line.name}, ${KIND_LABELS[r.line.kind]}`}
      onPress={props.onPress}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
    >
      <View style={styles.row}>
        <View style={[styles.icon, { backgroundColor: tint(colors.health) }]}>
          <Pill color={colors.health} size={20} />
        </View>
        <View style={styles.grow}>
          <Text style={styles.title}>{r.line.name}</Text>
          <Text style={text.subtle}>
            {KIND_LABELS[r.line.kind]} · {r.line.need}
          </Text>
        </View>
      </View>
      <View style={styles.figures}>
        <Figure label="Objectif" value={r.targetPacks} />
        <Figure label="En stock" value={r.availablePacks} />
        <Figure label="À acheter" value={r.toBuyPacks} color={status} />
      </View>
      {pending.length > 0 ? (
        <Text style={[text.subtle, styles.pending]}>{pending.join(' · ')}</Text>
      ) : null}
    </Pressable>
  );
}

function Figure(props: {
  label: string;
  value: number | null;
  color?: string;
}) {
  return (
    <View style={styles.figure}>
      <Text style={[styles.figureValue, props.color && { color: props.color }]}>
        {props.value === null ? '—' : props.value}
      </Text>
      <Text style={text.subtle}>{props.label}</Text>
    </View>
  );
}

function CatalogPicker(props: {
  onBack: () => void;
  onPick: (entry: CatalogEntry | null) => void;
}) {
  return (
    <ScrollView contentContainerStyle={styles.page}>
      <ScreenTitle
        title="Ajouter un produit"
        onBack={props.onBack}
        backLabel="Retour à la pharmacie"
      />
      {KINDS.map(kind => (
        <Panel key={kind} title={KIND_LABELS[kind]}>
          {PHARMACY_CATALOG.filter(e => e.kind === kind).map(entry => (
            <Pressable
              key={entry.id}
              accessibilityRole="button"
              accessibilityLabel={`Ajouter ${entry.name}`}
              onPress={() => props.onPick(entry)}
              style={({ pressed }) => [styles.pick, pressed && styles.pressed]}
            >
              <View style={styles.grow}>
                <Text style={styles.title}>{entry.name}</Text>
                <Text style={text.subtle}>
                  {entry.need}
                  {entry.examples ? ` · ${entry.examples}` : ''}
                </Text>
              </View>
              <Plus color={colors.cyan} size={20} />
            </Pressable>
          ))}
        </Panel>
      ))}
      <Button
        variant="secondary"
        icon={Plus}
        label="Autre produit"
        onPress={() => props.onPick(null)}
      />
    </ScrollView>
  );
}

/** Champ numérique : vide = donnée absente ; une saisie invalide n'est pas gardée. */
function NumberField(props: {
  label: string;
  value: number | undefined;
  integer?: boolean;
  min?: number;
  hint?: string;
  onChange: (n: number | undefined) => void;
}) {
  const [draft, setDraft] = useState(
    props.value === undefined ? '' : String(props.value).replace('.', ','),
  );
  const [error, setError] = useState<string | null>(null);
  return (
    <Field
      label={props.label}
      value={draft}
      hint={props.hint}
      error={error}
      keyboardType="decimal-pad"
      onChangeText={t => {
        setDraft(t);
        const trimmed = t.trim().replace(',', '.');
        if (trimmed === '') {
          setError(null);
          props.onChange(undefined);
          return;
        }
        const n = Number(trimmed);
        const min = props.min ?? 0;
        if (
          !Number.isFinite(n) ||
          n < min ||
          (props.integer && !Number.isInteger(n))
        ) {
          setError(
            props.integer
              ? `Nombre entier, au moins ${min}.`
              : `Nombre positif, au moins ${min}.`,
          );
          return;
        }
        setError(null);
        props.onChange(n);
      }}
    />
  );
}

function LineEditor(props: {
  line: PharmacyLine;
  plan: PharmacyPlan;
  today: string;
  onChange: (line: PharmacyLine) => void;
  onDelete: () => void;
  onBack: () => void;
  feedback: { tone: 'ok' | 'error'; message: string } | null;
}) {
  const { line } = props;
  const [confirm, setConfirm] = useState(false);
  const r = computeLine(line, props.plan, props.today);
  const catalog = PHARMACY_CATALOG.find(e => e.id === line.catalogId);
  const set = (patch: Partial<PharmacyLine>) => {
    const next = { ...line, ...patch };
    if (lineError(next) === null) {
      props.onChange(next);
    }
  };
  const pending = [
    ...r.missing.map(m => MISSING_LABELS[m]),
    ...(r.needsValidation ? ['Quantité à valider avec le médecin'] : []),
  ];

  return (
    <ScrollView
      contentContainerStyle={styles.page}
      keyboardShouldPersistTaps="handled"
    >
      <ScreenTitle
        title={line.name}
        onBack={props.onBack}
        backLabel="Retour à la pharmacie"
      />

      <Panel title="Besoin pour la durée choisie">
        <View style={styles.figures}>
          <Figure label="Objectif" value={r.targetPacks} />
          <Figure label="En stock" value={r.availablePacks} />
          <Figure label="À acheter" value={r.toBuyPacks} />
        </View>
        {r.units !== null ? (
          <Text style={text.muted}>
            Soit {r.units} {line.unit}
            {r.units > 1 ? 's' : ''} au total.
          </Text>
        ) : null}
        {r.expiredPacks > 0 ? (
          <Text style={[text.muted, { color: colors.danger }]}>
            {r.expiredPacks} conditionnement(s) périmé(s), non comptés.
          </Text>
        ) : null}
        <Text style={text.subtle}>{r.formula}</Text>
        {pending.map(p => (
          <Text key={p} style={[text.muted, { color: colors.warning }]}>
            Donnée manquante : {p}
          </Text>
        ))}
      </Panel>

      {catalog?.caution ? (
        <View style={[styles.alert, { borderColor: colors.danger }]}>
          <AlertTriangle color={colors.danger} size={18} />
          <Text style={[text.body, styles.grow]}>{catalog.caution}</Text>
        </View>
      ) : null}

      <Panel title="Produit">
        <Field
          label="Nom"
          value={line.name}
          maxLength={120}
          onChangeText={name => set({ name })}
        />
        <Field
          label="Principe actif (facultatif)"
          value={line.ingredient ?? ''}
          maxLength={80}
          hint="Sert à repérer deux produits qui contiennent la même substance."
          onChangeText={t =>
            set({ ingredient: t.trim() === '' ? undefined : t })
          }
        />
        <Field
          label="Unité comptée"
          value={line.unit}
          maxLength={30}
          onChangeText={unit => set({ unit })}
        />
        <Text style={text.label}>Type</Text>
        <View style={styles.chips}>
          {KINDS.map(kind => (
            <Chip
              key={kind}
              label={KIND_LABELS[kind]}
              selected={line.kind === kind}
              onPress={() =>
                set({
                  kind,
                  ...(kind === 'prescribed' &&
                  line.prescribedPersons === undefined
                    ? { prescribedPersons: 1 }
                    : {}),
                })
              }
            />
          ))}
        </View>
        <Text style={text.label}>Conservation</Text>
        <View style={styles.chips}>
          {STORAGES.map(storage => (
            <Chip
              key={storage}
              label={STORAGE_CHIPS[storage]}
              selected={line.storage === storage}
              onPress={() => set({ storage })}
            />
          ))}
        </View>
        <Text style={text.subtle}>{STORAGE_LABELS[line.storage]}</Text>
        <Text style={text.muted}>
          Délivrance :{' '}
          {line.delivery
            ? `${DELIVERY_LABELS[line.delivery.status]} (source : ${
                line.delivery.source
              })`
            : 'à confirmer avec le pharmacien'}
        </Text>
      </Panel>

      <Panel title="Quantités">
        {line.kind === 'occasional' ? (
          <>
            <NumberField
              label="Épisodes par personne et par an"
              value={line.episodesPerYear}
              hint={
                catalog?.estimate
                  ? `Repère : ${catalog.estimate.episodesSource}.`
                  : 'Pas de fréquence publiée trouvée : votre estimation.'
              }
              onChange={n => set({ episodesPerYear: n })}
            />
            <NumberField
              label={`Unités au plus par épisode (${line.unit})`}
              value={line.unitsPerEpisode}
              hint={
                catalog?.estimate
                  ? `Repère : ${catalog.estimate.unitsSource}. Repère de stock pour un adulte, pas une posologie.`
                  : 'À lire sur la notice : dose maximale par jour × durée maximale sans avis médical.'
              }
              onChange={n => set({ unitsPerEpisode: n })}
            />
            <NumberField
              label="Ou nombre de boîtes choisi à la main (facultatif)"
              value={line.precautionPacks}
              integer
              hint="Rempli, il remplace l’estimation."
              onChange={n => set({ precautionPacks: n })}
            />
          </>
        ) : line.kind === 'consumable' ? (
          <NumberField
            label={`${line.unit} par personne et par mois`}
            value={line.perPersonPerMonth}
            hint="Votre estimation d’usage ; Fenrir n’en invente pas."
            onChange={n => set({ perPersonPerMonth: n })}
          />
        ) : (
          <>
            <NumberField
              label={`${line.unit} par jour selon l’ordonnance`}
              value={line.prescribedPerDay}
              onChange={n => set({ prescribedPerDay: n })}
            />
            <NumberField
              label="Personnes concernées"
              value={line.prescribedPersons}
              integer
              min={1}
              onChange={n => set({ prescribedPersons: n ?? 1 })}
            />
            <Pressable
              accessibilityRole="checkbox"
              accessibilityState={{ checked: line.validated === true }}
              accessibilityLabel="Quantité validée avec le médecin ou le pharmacien"
              onPress={() => set({ validated: line.validated !== true })}
              style={styles.check}
            >
              <View
                style={[
                  styles.box,
                  line.validated && {
                    backgroundColor: colors.success,
                    borderColor: colors.success,
                  },
                ]}
              />
              <Text style={[text.body, styles.grow]}>
                Quantité validée avec le médecin ou le pharmacien
              </Text>
            </Pressable>
          </>
        )}
        <NumberField
          label={`${line.unit} par conditionnement`}
          value={line.packSize}
          integer
          min={1}
          hint={
            catalog?.estimate?.packSource
              ? `Repère : ${catalog.estimate.packSource}. Vérifiez sur votre boîte.`
              : 'Indiqué sur la boîte.'
          }
          onChange={n => set({ packSize: n })}
        />
      </Panel>

      <Panel title="En stock">
        {line.lots.length === 0 ? (
          <Text style={text.subtle}>Aucun lot enregistré.</Text>
        ) : null}
        {line.lots.map((lot, i) => (
          <View key={lot.id} style={styles.lot}>
            <View style={styles.grow}>
              <NumberField
                label={`Lot ${i + 1} : conditionnements`}
                value={lot.packs}
                integer
                onChange={n =>
                  set({
                    lots: line.lots.map(l =>
                      l.id === lot.id ? { ...l, packs: n ?? 0 } : l,
                    ),
                  })
                }
              />
              <ExpiryField
                value={lot.expiry}
                onChange={expiry =>
                  set({
                    lots: line.lots.map(l =>
                      l.id === lot.id ? { ...l, expiry } : l,
                    ),
                  })
                }
              />
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Retirer le lot ${i + 1}`}
              onPress={() =>
                set({ lots: line.lots.filter(l => l.id !== lot.id) })
              }
              style={styles.trash}
            >
              <Trash2 color={colors.textMuted} size={20} />
            </Pressable>
          </View>
        ))}
        <Button
          variant="secondary"
          compact
          icon={Plus}
          label="Ajouter un lot"
          onPress={() =>
            set({ lots: [...line.lots, { id: newId(), packs: 1 }] })
          }
        />
      </Panel>

      {props.feedback ? (
        <Notice tone={props.feedback.tone} message={props.feedback.message} />
      ) : null}
      {confirm ? (
        <View style={styles.chips}>
          <Button
            variant="danger"
            label="Confirmer la suppression"
            onPress={props.onDelete}
          />
          <Button
            variant="ghost"
            label="Annuler"
            onPress={() => setConfirm(false)}
          />
        </View>
      ) : (
        <Button
          variant="ghost"
          icon={Trash2}
          label="Retirer ce produit"
          onPress={() => setConfirm(true)}
        />
      )}
    </ScrollView>
  );
}

/** Date AAAA-MM-JJ ; une date incomplète ou impossible n'est pas gardée. */
function ExpiryField(props: {
  value: string | undefined;
  onChange: (v: string | undefined) => void;
}) {
  const [draft, setDraft] = useState(props.value ?? '');
  const [error, setError] = useState<string | null>(null);
  return (
    <Field
      label="Péremption (AAAA-MM-JJ, facultative)"
      value={draft}
      placeholder="2027-06-30"
      maxLength={10}
      error={error}
      onChangeText={t => {
        setDraft(t);
        if (t.trim() === '') {
          setError(null);
          props.onChange(undefined);
          return;
        }
        const ok =
          /^\d{4}-\d{2}-\d{2}$/.test(t) &&
          !Number.isNaN(Date.parse(`${t}T00:00:00Z`)) &&
          new Date(`${t}T00:00:00Z`).toISOString().slice(0, 10) === t;
        setError(ok ? null : 'Date au format AAAA-MM-JJ.');
        if (ok) {
          props.onChange(t);
        }
      }}
    />
  );
}

const styles = StyleSheet.create({
  page: { padding: space.l, gap: space.m, paddingBottom: space.xl },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.m },
  grow: { flex: 1, minWidth: 0 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.s },
  card: {
    gap: space.s,
    padding: space.m,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  pressed: { opacity: 0.82 },
  icon: {
    width: 36,
    height: 36,
    borderRadius: radius.s,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { ...text.body, fontWeight: '600' },
  figures: { flexDirection: 'row', gap: space.s },
  figure: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: space.s,
    borderRadius: radius.s,
    backgroundColor: colors.bg,
  },
  figureValue: { ...text.h2, fontVariant: ['tabular-nums'] },
  pending: { color: colors.warning },
  alert: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.s,
    padding: space.m,
    borderRadius: radius.s,
    borderWidth: 1,
    backgroundColor: colors.bg,
  },
  pick: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.m,
    minHeight: 52,
    paddingVertical: space.xs,
  },
  check: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.m,
    minHeight: 44,
  },
  box: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: colors.textMuted,
  },
  lot: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.s,
    paddingBottom: space.s,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  trash: { padding: space.s, marginTop: space.l },
});
