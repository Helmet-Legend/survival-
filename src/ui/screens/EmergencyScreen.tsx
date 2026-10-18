/**
 * Écran Urgence, à un appui de l'accueil : numéros d'urgence, position GPS
 * (MGRS et degrés), envoi de la position par SMS et fiches réflexes. Tout
 * fonctionne sans réseau de données ; l'appel et le SMS passent par les
 * applications du téléphone, l'utilisateur garde la main sur l'envoi.
 */
import {
  Crosshair,
  HeartPulse,
  MessageSquareText,
  Moon,
  Phone,
  Users,
} from 'lucide-react-native';
import React, { useState } from 'react';
import {
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import type { Position } from '../../device/location';
import {
  isPlanEmpty,
  loadFamilyPlan,
  type FamilyPlan,
} from '../../plan/familyPlan';
import { formatLatLon, formatMgrs, latLonToMgrs } from '../../geo/geoConverter';
import { Button, Notice, Panel, ScreenTitle } from '../components/controls';
import { formatNumber } from '../format';
import { useNavigation } from '../navigation';
import { RED_LIGHT_SUPPORTED, useRedLight } from '../redLight';
import { useSession } from '../session';
import { colors, radius, sizes, space, text } from '../theme';
import { useLoader } from '../useLoader';
import { GuideReader } from './GuidesScreen';

const NUMBERS: Array<[string, string]> = [
  ['112', 'Urgences (toute l’Europe)'],
  ['15', 'SAMU'],
  ['18', 'Pompiers'],
  ['17', 'Police / gendarmerie'],
];

/** Fiches à ouvrir d'un appui (slugs des guides embarqués). */
const REFLEXES: Array<[string, string]> = [
  ['alerter-secours', 'Alerter les secours'],
  ['rcp-arret-cardiaque', 'Arrêt cardiaque'],
  ['hemorragie-compression', 'Saignement abondant'],
  ['pls', 'Position latérale de sécurité'],
  ['etouffement', 'Étouffement'],
];

/** Texte du SMS : MGRS (secours), degrés décimaux et lien de carte. */
export function positionMessage(position: Position): string {
  const { latitude, longitude, accuracy } = position;
  const mgrs = formatMgrs(latLonToMgrs({ latitude, longitude }, 5));
  const lat = latitude.toFixed(5);
  const lon = longitude.toFixed(5);
  const precision = accuracy === null ? '' : ` (± ${Math.round(accuracy)} m)`;
  return (
    `Ma position : ${lat}, ${lon}${precision}. MGRS ${mgrs}. ` +
    `Carte : https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=16/${lat}/${lon}`
  );
}

export function EmergencyScreen() {
  const { db, location } = useSession();
  const { data: plan } = useLoader(() => loadFamilyPlan(db));
  const navigation = useNavigation();
  const redLight = useRedLight();
  const [position, setPosition] = useState<Position | null>(null);
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reflex, setReflex] = useState<string | null>(null);

  if (reflex !== null) {
    return <GuideReader slug={reflex} onBack={() => setReflex(null)} />;
  }

  const locate = async () => {
    setError(null);
    setLocating(true);
    try {
      setPosition(await location.getPosition());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLocating(false);
    }
  };

  const open = (url: string) => {
    Linking.openURL(url).catch(() =>
      setError('Impossible d’ouvrir l’application du téléphone.'),
    );
  };

  return (
    <ScrollView contentContainerStyle={styles.page}>
      <ScreenTitle
        title="Urgence"
        onBack={navigation.close}
        backLabel={navigation.backLabel}
      />

      <View style={styles.numbers}>
        {NUMBERS.map(([number, label]) => (
          <Pressable
            key={number}
            accessibilityRole="button"
            accessibilityLabel={`Appeler le ${number}, ${label}`}
            onPress={() => open(`tel:${number}`)}
            style={({ pressed }) => [styles.call, pressed && styles.pressed]}
          >
            <Phone color={colors.text} size={20} />
            <Text style={styles.number}>{number}</Text>
            <Text style={styles.callLabel}>{label}</Text>
          </Pressable>
        ))}
      </View>
      <Text style={text.subtle}>
        114 : urgence par SMS (personnes sourdes, ou quand parler est
        dangereux). L’appel s’ouvre dans le téléphone : rien n’est composé sans
        vous.
      </Text>
      {RED_LIGHT_SUPPORTED ? (
        <Button
          variant="ghost"
          icon={Moon}
          label={
            redLight.on ? 'Quitter la lumière rouge' : 'Passer en lumière rouge'
          }
          onPress={() => {
            void redLight.set(!redLight.on);
          }}
        />
      ) : null}

      <Panel
        title="Ma position"
        right={<Crosshair color={colors.cyan} size={20} />}
      >
        {location.available ? (
          <Button
            variant="primary"
            icon={Crosshair}
            label={locating ? 'Recherche du GPS…' : 'Localiser (GPS)'}
            disabled={locating}
            onPress={() => {
              void locate();
            }}
          />
        ) : (
          <Text style={text.muted}>
            GPS indisponible sur cet appareil : saisissez votre position dans
            l’onglet Carte.
          </Text>
        )}
        {position ? (
          <View style={styles.fix}>
            <Text style={text.label}>MGRS</Text>
            <Text selectable style={styles.mgrs}>
              {formatMgrs(latLonToMgrs(position, 5))}
            </Text>
            <Text selectable style={text.mono}>
              {formatLatLon(position, 'dms')}
            </Text>
            <Text style={text.subtle}>
              {position.accuracy === null
                ? 'Précision inconnue'
                : `Précision ± ${formatNumber(position.accuracy, 0)} m`}
              {position.stale ? ' · dernière position connue' : ''}
            </Text>
            <Button
              icon={MessageSquareText}
              label="Envoyer ma position par SMS"
              onPress={() =>
                open(
                  `sms:?body=${encodeURIComponent(positionMessage(position))}`,
                )
              }
            />
            <Text style={text.subtle}>
              Le message s’ouvre dans votre application SMS : choisissez le
              destinataire, puis envoyez.
            </Text>
          </View>
        ) : null}
        {error ? <Notice tone="error" message={error} /> : null}
      </Panel>

      <FamilyPlanPanel
        plan={plan}
        position={position}
        onCall={phone => open(`tel:${phone.replace(/[^+0-9]/g, '')}`)}
        onSms={(phone, body) =>
          open(
            `sms:${phone.replace(/[^+0-9]/g, '')}?body=${encodeURIComponent(
              body,
            )}`,
          )
        }
        onEdit={() => navigation.open('familyPlan')}
      />

      <Panel
        title="Fiches réflexes"
        right={<HeartPulse color={colors.health} size={20} />}
      >
        {REFLEXES.map(([slug, label]) => (
          <Button
            key={slug}
            variant="ghost"
            label={label}
            chevron
            onPress={() => setReflex(slug)}
          />
        ))}
      </Panel>
    </ScrollView>
  );
}

/** Résumé du plan familial : points de regroupement et contacts à joindre. */
function FamilyPlanPanel(props: {
  plan: FamilyPlan | null;
  position: Position | null;
  onCall: (phone: string) => void;
  onSms: (phone: string, body: string) => void;
  onEdit: () => void;
}) {
  const { plan, position } = props;
  const empty = plan === null || isPlanEmpty(plan);
  return (
    <Panel
      title="Plan familial"
      right={<Users color={colors.cyan} size={20} />}
    >
      {empty ? (
        <Text style={text.muted}>
          Préparez à l’avance où vous retrouver et qui appeler : le jour J, le
          réseau peut tomber.
        </Text>
      ) : null}
      {plan && plan.meetingNear.place !== '' ? (
        <View>
          <Text style={text.label}>Regroupement près du domicile</Text>
          <Text style={text.body}>{plan.meetingNear.place}</Text>
          {plan.meetingNear.position ? (
            <Text selectable style={text.mono}>
              {plan.meetingNear.position}
            </Text>
          ) : null}
        </View>
      ) : null}
      {plan && plan.meetingFar.place !== '' ? (
        <View>
          <Text style={text.label}>Regroupement hors du quartier</Text>
          <Text style={text.body}>{plan.meetingFar.place}</Text>
          {plan.meetingFar.position ? (
            <Text selectable style={text.mono}>
              {plan.meetingFar.position}
            </Text>
          ) : null}
        </View>
      ) : null}
      {plan ? <CommsSummary plan={plan} /> : null}
      {plan?.contacts
        .filter(c => c.phone !== '')
        .map((c, i) => (
          <View key={i} style={styles.contact}>
            <View style={styles.grow}>
              <Text style={text.body}>
                {c.name || c.phone}
                {c.outOfArea ? (
                  <Text style={styles.outOfArea}> · hors zone</Text>
                ) : null}
              </Text>
              {c.relation ? (
                <Text style={text.subtle}>{c.relation}</Text>
              ) : null}
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Appeler ${c.name || c.phone}`}
              onPress={() => props.onCall(c.phone)}
              style={styles.round}
            >
              <Phone color={colors.text} size={18} />
            </Pressable>
            {position ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Envoyer ma position à ${
                  c.name || c.phone
                }`}
                onPress={() => props.onSms(c.phone, positionMessage(position))}
                style={styles.round}
              >
                <MessageSquareText color={colors.text} size={18} />
              </Pressable>
            ) : null}
          </View>
        ))}
      <Button
        variant="ghost"
        label={
          empty ? 'Préparer le plan familial' : 'Modifier le plan familial'
        }
        chevron
        onPress={props.onEdit}
      />
    </Panel>
  );
}

/** Plan PACE : l'ordre des moyens à essayer, et le canal radio. */
function CommsSummary({ plan }: { plan: FamilyPlan }) {
  const c = plan.comms;
  const steps = [c.primary, c.alternate, c.contingency, c.emergency]
    .map((step, i) => (step ? `${i + 1}. ${step}` : ''))
    .filter(Boolean);
  if (steps.length === 0 && !c.radio && !c.schedule) {
    return null;
  }
  return (
    <View>
      <Text style={text.label}>Communication</Text>
      {steps.map(step => (
        <Text key={step} style={text.body}>
          {step}
        </Text>
      ))}
      {c.radio ? <Text style={text.mono}>Radio : {c.radio}</Text> : null}
      {c.schedule ? (
        <Text style={text.subtle}>Vacations : {c.schedule}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  contact: { flexDirection: 'row', alignItems: 'center', gap: space.s },
  grow: { flex: 1, minWidth: 0 },
  outOfArea: { color: colors.primary, fontSize: 13 },
  round: {
    width: 42,
    height: 42,
    borderRadius: 21,
    borderWidth: 1,
    borderColor: colors.borderActive,
    alignItems: 'center',
    justifyContent: 'center',
  },
  page: {
    paddingHorizontal: sizes.screenPadding,
    paddingBottom: space.xl,
    gap: space.m,
  },
  numbers: { flexDirection: 'row', flexWrap: 'wrap', gap: space.s },
  call: {
    width: '48%',
    flexGrow: 1,
    gap: 2,
    padding: space.m,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.danger,
    backgroundColor: colors.dangerSurface,
  },
  number: { ...text.value, fontSize: 30, color: colors.text },
  callLabel: { color: colors.text, fontSize: 13 },
  pressed: { opacity: 0.82 },
  fix: { gap: space.s, marginTop: space.s },
  mgrs: {
    ...text.mono,
    fontSize: 20,
    fontWeight: '700',
    color: colors.primary,
  },
});
