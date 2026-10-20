/**
 * Réglages : accès à Mon foyer (hypothèses du calcul), rappels de
 * péremption, confidentialité et verrouillage.
 */
import {
  Bell,
  Lock,
  Moon,
  ShieldCheck,
  Users,
  TriangleAlert,
} from 'lucide-react-native';
import React, { useState } from 'react';
import { ScrollView, StyleSheet, Switch, Text, View } from 'react-native';

import {
  loadRemindersEnabled,
  reminderTimes,
  saveRemindersEnabled,
  syncReminders,
} from '../../resilience/reminders';
import { Button, Notice, Panel, ScreenTitle } from '../components/controls';
import { formatDate } from '../format';
import { localToday } from '../../lib/dates';
import { useNavigation } from '../navigation';
import { RED_LIGHT_SUPPORTED, useRedLight } from '../redLight';
import { loadOnlineLookup, saveOnlineLookup } from '../../scanner/products';
import { useSession } from '../session';
import { colors, sizes, space, text } from '../theme';
import { useLoader } from '../useLoader';
import { BackupPanel } from './BackupPanel';

export function SettingsScreen(props: { onLock: () => void }) {
  const { db, screenCapture, reminders } = useSession();
  const redLight = useRedLight();
  const navigation = useNavigation();
  const [reminderNotice, setReminderNotice] = useState<string | null>(null);
  const { data, error, reload } = useLoader(async () => {
    const [captureAllowed, remindersOn, upcoming, barcodeOnline] =
      await Promise.all([
        screenCapture.isAllowed(),
        loadRemindersEnabled(db),
        reminderTimes(db),
        loadOnlineLookup(db),
      ]);
    return { captureAllowed, remindersOn, upcoming, barcodeOnline };
  });

  const title = (
    <ScreenTitle
      title="Réglages"
      onBack={navigation.close}
      backLabel={navigation.backLabel}
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
  const { captureAllowed, remindersOn, upcoming } = data;
  const toggleReminders = async (enabled: boolean) => {
    setReminderNotice(null);
    if (enabled && !(await reminders.requestPermission())) {
      setReminderNotice(
        'Notifications refusées : autorisez-les pour Fenrir dans les réglages Android, puis réessayez.',
      );
      return;
    }
    await saveRemindersEnabled(db, enabled);
    await syncReminders(db, reminders);
    await reload();
  };
  const toggleCapture = async (allowed: boolean) => {
    await screenCapture.setAllowed(allowed);
    await reload();
  };

  return (
    <ScrollView contentContainerStyle={styles.page}>
      {title}
      <Button
        icon={Users}
        chevron
        label="Mon foyer et hypothèses"
        accessibilityLabel="Ouvrir Mon foyer : personnes, objectif, eau, calories, énergie"
        onPress={() => navigation.open('household')}
      />
      <Button
        icon={TriangleAlert}
        chevron
        label="Alertes"
        accessibilityLabel="Ouvrir les alertes : vigilances, rappels, ruptures"
        onPress={() => navigation.open('alerts')}
      />

      {reminders.available ? (
        <Panel
          title="Rappels de péremption"
          right={<Bell color={colors.primary} size={20} />}
        >
          <View style={styles.settingRow}>
            <Text style={[text.body, styles.grow]}>
              Me prévenir sur le téléphone
            </Text>
            <Switch
              accessibilityLabel="Rappels de péremption"
              value={remindersOn}
              onValueChange={value => {
                void toggleReminders(value);
              }}
              trackColor={{ false: colors.border, true: colors.primary }}
              thumbColor={colors.text}
            />
          </View>
          <Text style={text.subtle}>
            Notification neutre « Fenrir : un rappel vous attend », sans nom
            d’article : rien ne s’affiche sur l’écran de verrouillage. Un rappel
            à l’entrée dans le seuil d’alerte (30 jours par défaut), un autre le
            jour de la péremption, sacs d’évacuation compris.
          </Text>
          {remindersOn ? (
            <Text style={text.muted}>
              {upcoming.length === 0
                ? 'Aucun rappel à venir.'
                : `${upcoming.length} rappel${
                    upcoming.length > 1 ? 's' : ''
                  } prévu${
                    upcoming.length > 1 ? 's' : ''
                  }, le prochain le ${formatDate(
                    localToday(new Date(upcoming[0])),
                  )}.`}
            </Text>
          ) : null}
          {reminderNotice ? (
            <Notice tone="error" message={reminderNotice} />
          ) : null}
        </Panel>
      ) : null}

      {RED_LIGHT_SUPPORTED ? (
        <Panel
          title="Affichage de nuit"
          right={<Moon color={colors.danger} size={20} />}
        >
          <View style={styles.settingRow}>
            <Text style={[text.body, styles.grow]}>Mode lumière rouge</Text>
            <Switch
              accessibilityLabel="Mode lumière rouge"
              value={redLight.on}
              onValueChange={value => {
                void redLight.set(value);
              }}
              trackColor={{ false: colors.border, true: colors.danger }}
              thumbColor={colors.text}
            />
          </View>
          <Text style={text.subtle}>
            Tout l’écran passe en rouge : l’œil garde sa vision de nuit et
            l’écran se voit moins de loin. Baissez aussi la luminosité du
            téléphone.
          </Text>
        </Panel>
      ) : null}

      <BackupPanel onRestored={reload} />

      <Panel
        title="Confidentialité"
        right={<ShieldCheck color={colors.success} size={20} />}
      >
        <Text style={text.muted}>
          Les données sont chiffrées sur ce téléphone et ne quittent jamais
          l’appareil. Le coffre se verrouille dès que l’application passe en
          arrière-plan.
        </Text>
        <View style={styles.settingRow}>
          <Text style={[text.body, styles.grow]}>
            Reconnaître les codes-barres en ligne
          </Text>
          <Switch
            accessibilityLabel="Reconnaître les codes-barres en ligne"
            value={data.barcodeOnline === true}
            onValueChange={value => {
              void saveOnlineLookup(db, value).then(reload);
            }}
            trackColor={{ false: colors.border, true: colors.primary }}
            thumbColor={colors.text}
          />
        </View>
        <Text style={text.subtle}>
          {data.barcodeOnline === true
            ? 'Activé : seul le code-barres d’un produit scanné est envoyé à Open Food Facts et Open Beauty Facts pour en trouver le nom et les calories. Les médicaments sont reconnus sans réseau.'
            : 'Désactivé : les codes scannés restent dans le téléphone ; les fiches se complètent à la main.'}
        </Text>
        {screenCapture.available ? (
          <>
            <View style={styles.settingRow}>
              <Text style={[text.body, styles.grow]}>
                Autoriser les captures d’écran
              </Text>
              <Switch
                accessibilityLabel="Autoriser les captures d’écran"
                value={captureAllowed}
                onValueChange={value => {
                  void toggleCapture(value);
                }}
                trackColor={{ false: colors.border, true: colors.primary }}
                thumbColor={colors.text}
              />
            </View>
            <Text style={text.subtle}>
              {captureAllowed
                ? 'Captures autorisées : vos stocks, armes et documents peuvent se retrouver dans la galerie. À désactiver après le développement.'
                : 'Désactivé : l’écran apparaît noir sur les captures et dans les applications récentes.'}
            </Text>
          </>
        ) : null}
        <Button
          icon={Lock}
          label="Verrouiller maintenant"
          onPress={props.onLock}
        />
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
  grow: { flex: 1, minWidth: 0 },
  chips: { flexDirection: 'row', gap: space.s },
  settingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: space.m,
  },
});
