/**
 * Plan familial : contacts (dont un hors zone), points de regroupement,
 * itinéraires, coupures d'eau, de gaz et d'électricité, rôles et dernier
 * exercice. Gardé dans le coffre chiffré ; consultable depuis l'écran
 * Urgence.
 */
import { Plus, Trash2 } from 'lucide-react-native';
import React, { useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';

import { frToIso, isoToFr } from '../../lib/dates';
import {
  CONTACTS_MAX,
  loadFamilyPlan,
  PlanError,
  saveFamilyPlan,
  type FamilyPlan,
  type PlanContact,
} from '../../plan/familyPlan';
import {
  Button,
  Field,
  Notice,
  Panel,
  ScreenTitle,
} from '../components/controls';
import { useNavigation } from '../navigation';
import { useSession } from '../session';
import { colors, sizes, space, text } from '../theme';
import { useLoader } from '../useLoader';

export function FamilyPlanScreen() {
  const { db } = useSession();
  const { data, error } = useLoader(() => loadFamilyPlan(db));
  const navigation = useNavigation();
  const title = (
    <ScreenTitle
      title="Plan familial"
      onBack={() => navigation.open('emergency')}
    />
  );
  if (error || data === null) {
    return (
      <View style={styles.page}>
        {title}
        {error ? <Notice tone="error" message={error} /> : null}
      </View>
    );
  }
  return <PlanForm initial={data} title={title} />;
}

function PlanForm(props: { initial: FamilyPlan; title: React.ReactNode }) {
  const { db } = useSession();
  const [plan, setPlan] = useState<FamilyPlan>(props.initial);
  const [drill, setDrill] = useState(
    props.initial.lastDrill ? isoToFr(props.initial.lastDrill) : '',
  );
  const [feedback, setFeedback] = useState<{
    message: string;
    tone: 'ok' | 'error';
  } | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const set = <K extends keyof FamilyPlan>(key: K, value: FamilyPlan[K]) =>
    setPlan(p => ({ ...p, [key]: value }));
  const setContact = (index: number, patch: Partial<PlanContact>) =>
    setPlan(p => ({
      ...p,
      contacts: p.contacts.map((c, i) =>
        i === index ? { ...c, ...patch } : c,
      ),
    }));

  const save = async () => {
    setErrors({});
    setFeedback(null);
    const lastDrill = drill.trim() === '' ? null : frToIso(drill);
    if (drill.trim() !== '' && lastDrill === null) {
      setErrors({ lastDrill: 'Date au format JJ/MM/AAAA' });
      return;
    }
    try {
      const saved = await saveFamilyPlan(db, { ...plan, lastDrill });
      setPlan(saved);
      setFeedback({ message: 'Plan familial enregistré.', tone: 'ok' });
    } catch (e) {
      if (e instanceof PlanError) {
        setErrors({ [e.field]: e.message });
      } else {
        setFeedback({
          message: e instanceof Error ? e.message : String(e),
          tone: 'error',
        });
      }
    }
  };

  return (
    <ScrollView
      contentContainerStyle={styles.page}
      keyboardShouldPersistTaps="handled"
    >
      {props.title}
      <Text style={text.muted}>
        À préparer à l’avance et à connaître de tous : en cas de crise, le
        réseau peut tomber et chacun doit savoir où aller et qui appeler.
      </Text>

      <Panel title="Contacts">
        <Text style={text.subtle}>
          Ajoutez un proche hors de la zone : chacun l’appelle pour donner des
          nouvelles, il centralise.
        </Text>
        {plan.contacts.map((contact, i) => (
          <View key={i} style={styles.contact}>
            <View style={styles.row}>
              <Text style={[text.label, styles.grow]}>Contact {i + 1}</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Retirer le contact ${i + 1}`}
                onPress={() =>
                  set(
                    'contacts',
                    plan.contacts.filter((_, j) => j !== i),
                  )
                }
                hitSlop={8}
              >
                <Trash2 color={colors.danger} size={18} />
              </Pressable>
            </View>
            <Field
              label="Nom"
              value={contact.name}
              onChangeText={v => setContact(i, { name: v })}
              maxLength={80}
              error={errors[`contacts.${i}.name`]}
            />
            <Field
              label="Téléphone"
              value={contact.phone}
              onChangeText={v => setContact(i, { phone: v })}
              keyboardType="phone-pad"
              maxLength={30}
              error={errors[`contacts.${i}.phone`]}
            />
            <Field
              label="Lien ou rôle"
              value={contact.relation}
              onChangeText={v => setContact(i, { relation: v })}
              placeholder="Ex : sœur à Lyon, voisin"
              maxLength={80}
            />
            <View style={styles.row}>
              <Text style={[text.body, styles.grow]}>Contact hors zone</Text>
              <Switch
                accessibilityLabel={`Contact ${i + 1} hors zone`}
                value={contact.outOfArea}
                onValueChange={v => setContact(i, { outOfArea: v })}
                trackColor={{ false: colors.border, true: colors.primary }}
                thumbColor={colors.text}
              />
            </View>
          </View>
        ))}
        {plan.contacts.length < CONTACTS_MAX ? (
          <Button
            compact
            icon={Plus}
            label="Ajouter un contact"
            onPress={() =>
              set('contacts', [
                ...plan.contacts,
                { name: '', phone: '', relation: '', outOfArea: false },
              ])
            }
          />
        ) : null}
      </Panel>

      <Panel title="Points de regroupement">
        <Field
          label="Près du domicile"
          value={plan.meetingNear.place}
          onChangeText={v =>
            set('meetingNear', { ...plan.meetingNear, place: v })
          }
          placeholder="Ex : parking de l’école"
          maxLength={120}
        />
        <Field
          label="Position du point proche (facultatif)"
          value={plan.meetingNear.position}
          onChangeText={v =>
            set('meetingNear', { ...plan.meetingNear, position: v })
          }
          placeholder="Ex : 31U DQ 48251 11932"
          autoCapitalize="characters"
          maxLength={60}
        />
        <Field
          label="Hors du quartier"
          value={plan.meetingFar.place}
          onChangeText={v =>
            set('meetingFar', { ...plan.meetingFar, place: v })
          }
          placeholder="Ex : chez Paul, 12 rue des Lilas"
          maxLength={120}
        />
        <Field
          label="Position du point éloigné (facultatif)"
          value={plan.meetingFar.position}
          onChangeText={v =>
            set('meetingFar', { ...plan.meetingFar, position: v })
          }
          autoCapitalize="characters"
          maxLength={60}
        />
        <Field
          label="Itinéraires d’évacuation"
          value={plan.routes}
          onChangeText={v => set('routes', v)}
          placeholder="Ex : par la D12 vers le nord ; à pied par le chemin du lavoir"
          multiline
          maxLength={500}
        />
      </Panel>

      <Panel title="Coupures">
        <Field
          label="Eau"
          value={plan.shutoffWater}
          onChangeText={v => set('shutoffWater', v)}
          placeholder="Ex : vanne sous l’évier de la cuisine"
          maxLength={120}
        />
        <Field
          label="Gaz"
          value={plan.shutoffGas}
          onChangeText={v => set('shutoffGas', v)}
          placeholder="Ex : robinet à côté du compteur, garage"
          maxLength={120}
        />
        <Field
          label="Électricité"
          value={plan.shutoffPower}
          onChangeText={v => set('shutoffPower', v)}
          placeholder="Ex : disjoncteur général, entrée"
          maxLength={120}
        />
      </Panel>

      <Panel title="Organisation">
        <Field
          label="Qui fait quoi"
          value={plan.roles}
          onChangeText={v => set('roles', v)}
          placeholder="Ex : Léa récupère les enfants à l’école, Marc prend le chien et les sacs"
          multiline
          maxLength={500}
        />
        <Field
          label="Dernier exercice (JJ/MM/AAAA)"
          value={drill}
          onChangeText={setDrill}
          placeholder="Ex : 15/03/2026"
          keyboardType="numbers-and-punctuation"
          maxLength={10}
          error={errors.lastDrill}
          hint="Conseil : un exercice par an, sortir avec les sacs en moins de 5 minutes."
        />
        <Field
          label="Notes"
          value={plan.notes}
          onChangeText={v => set('notes', v)}
          multiline
          maxLength={500}
        />
      </Panel>

      {feedback ? <Notice {...feedback} /> : null}
      <Button
        variant="primary"
        label="Enregistrer le plan"
        onPress={() => {
          void save();
        }}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: {
    paddingHorizontal: sizes.screenPadding,
    paddingBottom: space.xl,
    gap: space.m,
  },
  contact: {
    gap: space.s,
    paddingVertical: space.s,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.m },
  grow: { flex: 1, minWidth: 0 },
});
