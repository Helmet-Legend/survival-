/**
 * Historique des mouvements de stock, du plus récent au plus ancien,
 * regroupé par jour : entrées, retraits, périmés jetés, corrections.
 */
import React, { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { localToday, addDays } from '../../lib/dates';
import { Chip, Notice, Panel, ScreenTitle } from '../components/controls';
import { localDay, MovementRow } from '../components/Movements';
import { useNavigation } from '../navigation';
import { useSession } from '../session';
import { sizes, space, text } from '../theme';
import { useLoader } from '../useLoader';

type Direction = 'all' | 'in' | 'out';

const DIRECTIONS: Array<[Direction, string]> = [
  ['all', 'Tout'],
  ['in', 'Entrées'],
  ['out', 'Sorties'],
];

export function HistoryScreen() {
  const { repo } = useSession();
  const navigation = useNavigation();
  const [direction, setDirection] = useState<Direction>('all');
  const { data, error } = useLoader(
    () =>
      repo.listMovements({
        direction: direction === 'all' ? undefined : direction,
        limit: 300,
      }),
    [direction],
  );

  const today = localToday();
  const yesterday = addDays(today, -1);
  const dayTitle = (day: string) =>
    day === today
      ? 'Aujourd’hui'
      : day === yesterday
      ? 'Hier'
      : day.split('-').reverse().join('/');

  const groups: Array<[string, NonNullable<typeof data>]> = [];
  for (const m of data ?? []) {
    const day = localDay(m.createdAt);
    const last = groups[groups.length - 1];
    if (last && last[0] === day) {
      last[1].push(m);
    } else {
      groups.push([day, [m]]);
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.page}>
      <ScreenTitle
        title="Historique"
        onBack={() => navigation.goTo('stock')}
        backLabel="Retour aux stocks"
      />
      <View style={styles.chips}>
        {DIRECTIONS.map(([value, label]) => (
          <Chip
            key={value}
            label={label}
            selected={direction === value}
            onPress={() => setDirection(value)}
          />
        ))}
      </View>
      {error ? <Notice tone="error" message={error} /> : null}
      {data !== null && data.length === 0 ? (
        <Text style={text.muted}>
          Aucun mouvement enregistré. Chaque ajout, retrait, périmé jeté ou
          correction apparaîtra ici, avec son heure.
        </Text>
      ) : null}
      {groups.map(([day, movements]) => (
        <Panel key={day} title={dayTitle(day)}>
          {movements.map(m => (
            <MovementRow key={m.id} movement={m} showName />
          ))}
        </Panel>
      ))}
      {data !== null && data.length >= 300 ? (
        <Text style={text.subtle}>
          Les 300 derniers mouvements sont affichés.
        </Text>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: {
    paddingHorizontal: sizes.screenPadding,
    paddingBottom: space.xl,
    gap: space.m,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.s },
});
