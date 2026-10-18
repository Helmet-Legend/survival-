/**
 * Réglages : composition du foyer, objectif d'autonomie, rappels de
 * péremption, confidentialité et verrouillage.
 */
import { Bell, Lock, ShieldCheck, Users } from 'lucide-react-native';
import React, { useState } from 'react';
import { ScrollView, StyleSheet, Switch, Text, View } from 'react-native';

import {
  loadHousehold,
  loadTargetDays,
  saveHousehold,
  saveTargetDays,
} from '../../resilience/resilienceCalculator';
import {
  loadRemindersEnabled,
  reminderTimes,
  saveRemindersEnabled,
  syncReminders,
} from '../../resilience/reminders';
import {
  Button,
  Notice,
  Panel,
  ScreenTitle,
  Stepper,
} from '../components/controls';
import { formatDate, formatNumber, nextTarget } from '../format';
import { localToday } from '../../lib/dates';
import { useNavigation } from '../navigation';
import { useSession } from '../session';
import { colors, sizes, space, text } from '../theme';
import { useLoader } from '../useLoader';
import { BackupPanel } from './BackupPanel';

const MAX_MEMBERS = 12;

export function SettingsScreen(props: { onLock: () => void }) {
  const { db, screenCapture, reminders } = useSession();
  const navigation = useNavigation();
  const [reminderNotice, setReminderNotice] = useState<string | null>(null);
  const { data, error, reload } = useLoader(async () => {
    const [household, targetDays, captureAllowed, remindersOn, upcoming] =
      await Promise.all([
        loadHousehold(db),
        loadTargetDays(db),
        screenCapture.isAllowed(),
        loadRemindersEnabled(db),
        reminderTimes(db),
      ]);
    return { household, targetDays, captureAllowed, remindersOn, upcoming };
  });

  const title = <ScreenTitle title="Réglages" onBack={navigation.close} />;
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
  const { household, targetDays, captureAllowed, remindersOn, upcoming } = data;
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

  const changeMembers = async (delta: number) => {
    await saveHousehold(db, {
      ...household,
      members: household.members + delta,
    });
    await reload();
  };
  const changeTarget = async (direction: 1 | -1) => {
    await saveTargetDays(db, nextTarget(targetDays, direction));
    await reload();
  };

  return (
    <ScrollView contentContainerStyle={styles.page}>
      {title}
      <Panel title="Foyer" right={<Users color={colors.cyan} size={20} />}>
        <View style={styles.settingRow}>
          <Text style={text.body}>Personnes</Text>
          <Stepper
            value={`${household.members} pers.`}
            onDecrease={() => {
              void changeMembers(-1);
            }}
            onIncrease={() => {
              void changeMembers(1);
            }}
            canDecrease={household.members > 1}
            canIncrease={household.members < MAX_MEMBERS}
            decreaseLabel="Retirer une personne"
            increaseLabel="Ajouter une personne"
          />
        </View>
        <View style={styles.settingRow}>
          <Text style={text.body}>Objectif</Text>
          <Stepper
            value={`${targetDays} j`}
            onDecrease={() => {
              void changeTarget(-1);
            }}
            onIncrease={() => {
              void changeTarget(1);
            }}
            canDecrease={nextTarget(targetDays, -1) !== targetDays}
            canIncrease={nextTarget(targetDays, 1) !== targetDays}
            decreaseLabel="Réduire l’objectif"
            increaseLabel="Augmenter l’objectif"
          />
        </View>
        <Text style={text.muted}>
          Besoins par personne :{' '}
          {formatNumber(household.waterLitersPerPersonDay)} L d’eau et{' '}
          {formatNumber(household.kcalPerPersonDay, 0)} kcal par jour.
        </Text>
      </Panel>

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
  settingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: space.m,
  },
});
