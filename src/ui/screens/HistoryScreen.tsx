/**
 * Historique des mouvements de stock, du plus récent au plus ancien,
 * regroupé par jour : entrées, retraits, périmés jetés, corrections.
 * Filtres : sens, période, recherche par article.
 */
import React, { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { localToday, addDays } from '../../lib/dates';
import {
  Chip,
  Notice,
  Panel,
  ScreenTitle,
  SearchField,
} from '../components/controls';
import { localDay, MovementRow } from '../components/Movements';
import { useNavigation } from '../navigation';
import { useSession } from '../session';
import { sizes, space, text } from '../theme';
import { useLoader } from '../useLoader';

type Direction = 'all' | 'in' | 'out';
type Period = 'all' | 'week' | 'days30' | 'month';

const DIRECTIONS: Array<[Direction, string]> = [
  ['all', 'Tout'],
  ['in', 'Entrées'],
  ['out', 'Sorties'],
];

const PERIODS: Array<[Period, string]> = [
  ['all', 'Toutes dates'],
  ['week', '7 jours'],
  ['days30', '30 jours'],
  ['month', 'Ce mois-ci'],
];

const LIMIT = 300;

/** Début de la période (minuit local), en horodatage ISO ; undefined : tout. */
export function periodStart(
  period: Period,
  now: Date = new Date(),
): string | undefined {
  const y = now.getFullYear();
  const m = now.getMonth();
  const d = now.getDate();
  switch (period) {
    case 'week':
      return new Date(y, m, d - 6).toISOString();
    case 'days30':
      return new Date(y, m, d - 29).toISOString();
    case 'month':
      return new Date(y, m, 1).toISOString();
    default:
      return undefined;
  }
}

export function HistoryScreen() {
  const { repo } = useSession();
  const navigation = useNavigation();
  const [direction, setDirection] = useState<Direction>('all');
  const [period, setPeriod] = useState<Period>('all');
  const [query, setQuery] = useState('');
  const { data, error } = useLoader(
    () =>
      repo.listMovements({
        direction: direction === 'all' ? undefined : direction,
        since: periodStart(period),
        query,
        limit: LIMIT,
      }),
    [direction, period, query],
  );
  const filtered = period !== 'all' || query.trim() !== '';

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
      <View style={styles.chips}>
        {PERIODS.map(([value, label]) => (
          <Chip
            key={value}
            label={label}
            selected={period === value}
            onPress={() => setPeriod(value)}
          />
        ))}
      </View>
      <SearchField
        label="Rechercher un article"
        value={query}
        onChangeText={setQuery}
        placeholder="Rechercher un article…"
      />
      {error ? <Notice tone="error" message={error} /> : null}
      {data !== null && data.length === 0 ? (
        <Text style={text.muted}>
          {filtered
            ? 'Aucun mouvement pour ces filtres.'
            : 'Aucun mouvement enregistré. Chaque ajout, retrait, périmé jeté ou correction apparaîtra ici, avec son heure.'}
        </Text>
      ) : null}
      {groups.map(([day, movements]) => (
        <Panel key={day} title={dayTitle(day)}>
          {movements.map(m => (
            <MovementRow key={m.id} movement={m} showName />
          ))}
        </Panel>
      ))}
      {data !== null && data.length >= LIMIT ? (
        <Text style={text.subtle}>
          Les {LIMIT} derniers mouvements sont affichés.
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
