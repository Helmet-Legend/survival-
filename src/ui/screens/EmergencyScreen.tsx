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
  Phone,
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
import { formatLatLon, formatMgrs, latLonToMgrs } from '../../geo/geoConverter';
import { Button, Notice, Panel, ScreenTitle } from '../components/controls';
import { formatNumber } from '../format';
import { useNavigation } from '../navigation';
import { useSession } from '../session';
import { colors, radius, sizes, space, text } from '../theme';
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
  const { location } = useSession();
  const navigation = useNavigation();
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
      <ScreenTitle title="Urgence" onBack={navigation.close} />

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

const styles = StyleSheet.create({
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
