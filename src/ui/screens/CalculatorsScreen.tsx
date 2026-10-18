/**
 * Calculateurs : besoins en eau par usage et besoins électriques par
 * appareil, comparés aux réserves du stock général. Les hypothèses sont
 * réglables et affichées ; le résultat reste une estimation.
 */
import { Droplets, Plug, Trash2 } from 'lucide-react-native';
import React, { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import {
  computeElectric,
  computeWater,
  EFFICIENCY_CHOICES,
  loadElectricSettings,
  MARGIN_CHOICES,
  parseAmount,
  saveElectricSettings,
  SPHERE_MINIMUM,
  waterStock,
  type Device,
  type ElectricSettings,
  type WaterInput,
} from '../../resilience/calculators';
import { computeEnergy, loadEnergyNeed } from '../../resilience/energy';
import {
  loadHousehold,
  loadTargetDays,
} from '../../resilience/resilienceCalculator';
import {
  Button,
  Chip,
  Field,
  IconButton,
  Notice,
  Panel,
  ScreenTitle,
  Stepper,
} from '../components/controls';
import { formatNumber } from '../format';
import { useNavigation } from '../navigation';
import { useSession } from '../session';
import { colors, space, sizes, text } from '../theme';
import { useLoader } from '../useLoader';

const LITER_STEP = 0.5;
const LITER_MAX = 10;

export function CalculatorsScreen() {
  const { db, repo } = useSession();
  const navigation = useNavigation();
  const { data, error, reload } = useLoader(async () => {
    const [household, targetDays, items, electric, whPerPerson] =
      await Promise.all([
        loadHousehold(db),
        loadTargetDays(db),
        repo.listItems({ bag: 'none' }),
        loadElectricSettings(db),
        loadEnergyNeed(db),
      ]);
    return {
      household,
      targetDays,
      stock: waterStock(items),
      storedWh: computeEnergy(items, household.members, whPerPerson).storedWh,
      electric,
    };
  });

  const title = (
    <ScreenTitle
      title="Calculateurs"
      onBack={() => navigation.open('plan')}
      backLabel="Retour au plan d’action"
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
  return (
    <ScrollView contentContainerStyle={styles.page}>
      {title}
      <Text style={text.muted}>
        Estimations à partir de vos hypothèses et de votre stock général (sacs
        exclus). Elles ne garantissent aucune durée : les consignes officielles
        priment.
      </Text>
      <WaterCalculator
        initial={{
          people: data.household.members,
          days: data.targetDays,
          drinking: data.household.waterLitersPerPersonDay,
          cooking: 0,
          hygiene: 0,
        }}
        potable={data.stock.potable}
        other={data.stock.other}
      />
      <ElectricCalculator
        settings={data.electric}
        storedWh={data.storedWh}
        onSave={async next => {
          await saveElectricSettings(db, next);
          await reload();
        }}
      />
    </ScrollView>
  );
}

// --- Eau ----------------------------------------------------------------------

function WaterCalculator(props: {
  initial: WaterInput;
  potable: number;
  other: number;
}) {
  const [input, setInput] = useState<WaterInput>(props.initial);
  const result = computeWater(input, props.potable);
  const set = (key: keyof WaterInput, value: number) =>
    setInput(current => ({ ...current, [key]: value }));
  const liters = (key: 'drinking' | 'cooking' | 'hygiene', label: string) => (
    <StepRow label={label}>
      <Stepper
        value={`${formatNumber(input[key])} L`}
        onDecrease={() => set(key, Math.max(0, input[key] - LITER_STEP))}
        onIncrease={() =>
          set(key, Math.min(LITER_MAX, input[key] + LITER_STEP))
        }
        canDecrease={input[key] > 0}
        canIncrease={input[key] < LITER_MAX}
        decreaseLabel={`Diminuer : ${label.toLowerCase()}`}
        increaseLabel={`Augmenter : ${label.toLowerCase()}`}
      />
    </StepRow>
  );

  return (
    <Panel
      title="Eau du foyer"
      right={<Droplets color={colors.water} size={20} />}
    >
      <StepRow label="Personnes">
        <Stepper
          value={String(input.people)}
          onDecrease={() => set('people', input.people - 1)}
          onIncrease={() => set('people', input.people + 1)}
          canDecrease={input.people > 1}
          canIncrease={input.people < 30}
          decreaseLabel="Une personne de moins"
          increaseLabel="Une personne de plus"
        />
      </StepRow>
      <StepRow label="Durée visée">
        <Stepper
          value={`${input.days} j`}
          onDecrease={() => set('days', input.days - 1)}
          onIncrease={() => set('days', input.days + 1)}
          canDecrease={input.days > 1}
          canIncrease={input.days < 60}
          decreaseLabel="Un jour de moins"
          increaseLabel="Un jour de plus"
        />
      </StepRow>
      <Text style={text.label}>Litres par personne et par jour</Text>
      {liters('drinking', 'Boisson')}
      {liters('cooking', 'Cuisine')}
      {liters('hygiene', 'Hygiène')}
      <Button
        compact
        variant="ghost"
        label="Repères Sphère : 2,5 L · 3 L · 2 L"
        accessibilityLabel="Appliquer les minimums du manuel Sphère : boisson 2,5 litres, cuisine 3 litres, hygiène 2 litres"
        onPress={() => setInput(current => ({ ...current, ...SPHERE_MINIMUM }))}
      />

      <View style={styles.results}>
        <ResultRow
          label="Besoin par jour"
          value={`${formatNumber(result.dailyNeed)} L`}
        />
        <ResultRow
          label={`Besoin pour ${input.days} j`}
          value={`${formatNumber(result.totalNeed)} L`}
        />
        <ResultRow
          label="Masse approximative"
          value={`${formatNumber(result.massKg, 0)} kg`}
        />
        <ResultRow
          label="Eau potable en stock"
          value={`${formatNumber(props.potable)} L`}
        />
        <ResultRow
          label="Manque d’eau potable"
          value={`${formatNumber(result.deficit)} L`}
          tone={result.deficit > 0 ? colors.warning : colors.success}
        />
        <ResultRow
          label="Autonomie théorique"
          value={result.days === null ? '—' : `${result.days} j`}
        />
      </View>
      {props.other > 0 ? (
        <Text style={text.subtle}>
          {formatNumber(props.other)} L d’eau à traiter, non potable ou de
          potabilité inconnue ne sont pas comptés : réservez-les à la chasse
          d’eau et au nettoyage, ou traitez-les selon une méthode adaptée.
        </Text>
      ) : null}
      <Text style={text.subtle}>
        Masse : 1 L ≈ 1 kg, contenants non compris. Péremptions non prises en
        compte ici (voir l’autonomie du plan d’action). Prévoir davantage par
        forte chaleur, effort, maladie ou allaitement.
      </Text>
    </Panel>
  );
}

// --- Électricité ------------------------------------------------------------------

function ElectricCalculator(props: {
  settings: ElectricSettings;
  storedWh: number;
  onSave: (next: ElectricSettings) => Promise<void>;
}) {
  const { devices, marginPct, efficiencyPct } = props.settings;
  const [name, setName] = useState('');
  const [watts, setWatts] = useState('');
  const [hours, setHours] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [formError, setFormError] = useState<string | null>(null);
  const result = computeElectric(
    devices,
    marginPct,
    efficiencyPct,
    props.storedWh,
  );

  const add = async () => {
    const w = parseAmount(watts);
    const h = parseAmount(hours);
    const q = parseAmount(quantity);
    if (name.trim() === '') {
      setFormError('Donnez un nom à l’appareil.');
      return;
    }
    if (w === null || w <= 0) {
      setFormError('Puissance invalide : lisez-la sur la plaque ou la notice.');
      return;
    }
    if (h === null || h <= 0 || h > 24) {
      setFormError('Durée invalide : entre 0 et 24 heures par jour.');
      return;
    }
    if (q === null || !Number.isInteger(q) || q < 1) {
      setFormError('Nombre invalide : un entier, au moins 1.');
      return;
    }
    const device: Device = {
      name: name.trim(),
      watts: w,
      hoursPerDay: h,
      quantity: q,
    };
    setFormError(null);
    await props.onSave({ ...props.settings, devices: [...devices, device] });
    setName('');
    setWatts('');
    setHours('');
    setQuantity('1');
  };

  return (
    <Panel
      title="Besoins électriques"
      right={<Plug color={colors.energy} size={20} />}
    >
      <Text style={text.muted}>
        Ajoutez les appareils indispensables en cas de coupure, avec la
        puissance indiquée sur leur plaque ou leur notice.
      </Text>
      {devices.length === 0 ? (
        <Text style={text.subtle}>Aucun appareil pour l’instant.</Text>
      ) : (
        devices.map((d, index) => (
          <View key={`${d.name}-${index}`} style={styles.device}>
            <View style={styles.grow}>
              <Text style={text.body}>
                {d.quantity > 1 ? `${d.quantity} × ` : ''}
                {d.name}
              </Text>
              <Text style={text.subtle}>
                {formatNumber(d.watts)} W · {formatNumber(d.hoursPerDay)} h/j ·{' '}
                {formatNumber(d.watts * d.hoursPerDay * d.quantity, 0)} Wh/j
              </Text>
            </View>
            <IconButton
              icon={Trash2}
              label={`Retirer ${d.name}`}
              color={colors.textMuted}
              onPress={() =>
                props.onSave({
                  ...props.settings,
                  devices: devices.filter((_, i) => i !== index),
                })
              }
            />
          </View>
        ))
      )}

      <Field
        label="Appareil"
        value={name}
        onChangeText={setName}
        placeholder="Ex : lampe LED, box internet"
      />
      <View style={styles.fieldRow}>
        <View style={styles.grow}>
          <Field
            label="Puissance (W)"
            value={watts}
            onChangeText={setWatts}
            keyboardType="decimal-pad"
          />
        </View>
        <View style={styles.grow}>
          <Field
            label="Heures par jour"
            value={hours}
            onChangeText={setHours}
            keyboardType="decimal-pad"
          />
        </View>
        <View style={styles.small}>
          <Field
            label="Nombre"
            value={quantity}
            onChangeText={setQuantity}
            keyboardType="number-pad"
          />
        </View>
      </View>
      {formError ? <Notice tone="error" message={formError} /> : null}
      <Button label="Ajouter l’appareil" onPress={add} />

      <Text style={text.label}>Marge pour les imprévus</Text>
      <View style={styles.chips}>
        {MARGIN_CHOICES.map(m => (
          <Chip
            key={m}
            label={`${m} %`}
            selected={m === marginPct}
            onPress={() => props.onSave({ ...props.settings, marginPct: m })}
          />
        ))}
      </View>
      <Text style={text.label}>Rendement de la batterie ou station</Text>
      <View style={styles.chips}>
        {EFFICIENCY_CHOICES.map(e => (
          <Chip
            key={e}
            label={`${e} %`}
            selected={e === efficiencyPct}
            onPress={() =>
              props.onSave({ ...props.settings, efficiencyPct: e })
            }
          />
        ))}
      </View>

      <View style={styles.results}>
        <ResultRow
          label="Consommation par jour"
          value={`${formatNumber(result.dailyWh, 0)} Wh`}
        />
        <ResultRow
          label="Capacité à prévoir par jour"
          value={`${formatNumber(result.capacityPerDay, 0)} Wh`}
        />
        <ResultRow
          label="Tous allumés ensemble"
          value={`${formatNumber(result.simultaneousWatts, 0)} W`}
        />
        <ResultRow
          label="Énergie stockée connue"
          value={`${formatNumber(props.storedWh, 0)} Wh`}
        />
        <ResultRow
          label="Autonomie estimée"
          value={result.days === null ? '—' : `${result.days} j`}
        />
      </View>
      <Text style={text.subtle}>
        Capacité = consommation × (1 + marge) ÷ rendement. La puissance de
        sortie de la batterie doit dépasser celle des appareils allumés
        ensemble, et le pic de démarrage d’un moteur (réfrigérateur, pompe).
        L’énergie stockée vient des fiches Énergie dont la capacité est
        renseignée.
      </Text>
      <Text style={styles.warning}>
        Groupe électrogène ou appareil à combustion : uniquement dehors, loin
        des ouvertures. Aucun raccordement improvisé au réseau électrique du
        logement.
      </Text>
    </Panel>
  );
}

function StepRow(props: { label: string; children: React.ReactNode }) {
  return (
    <View style={styles.stepRow}>
      <Text style={[text.body, styles.grow]}>{props.label}</Text>
      {props.children}
    </View>
  );
}

function ResultRow(props: { label: string; value: string; tone?: string }) {
  return (
    <View style={styles.resultRow}>
      <Text style={[text.muted, styles.grow]}>{props.label}</Text>
      <Text
        style={[
          text.mono,
          styles.resultValue,
          props.tone ? { color: props.tone } : null,
        ]}
      >
        {props.value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  page: {
    paddingHorizontal: sizes.screenPadding,
    paddingBottom: space.xl,
    gap: space.m,
  },
  stepRow: { flexDirection: 'row', alignItems: 'center', gap: space.m },
  results: {
    gap: space.xs,
    paddingTop: space.s,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  resultRow: { flexDirection: 'row', alignItems: 'center', gap: space.m },
  resultValue: { fontSize: 16, fontWeight: '700', color: colors.text },
  device: { flexDirection: 'row', alignItems: 'center', gap: space.m },
  fieldRow: { flexDirection: 'row', gap: space.s },
  small: { width: 80 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.s },
  grow: { flex: 1, minWidth: 0 },
  warning: { ...text.subtle, color: colors.warning },
});
