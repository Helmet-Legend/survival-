/**
 * Lignes de l'historique des mouvements de stock : quantité signée, article,
 * nature (ajout, retrait, périmé jeté…), origine (scanner, fiche) et heure.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import type { StockMovement } from '../../inventory';
import { formatNumber } from '../format';
import { colors, space, text } from '../theme';

const KIND_LABELS: Record<StockMovement['kind'], string> = {
  in: 'Ajout',
  out: 'Retrait',
  discard: 'Périmé jeté',
  correct: 'Correction',
  deleted: 'Article supprimé',
};

export function movementLabel(m: StockMovement): string {
  if (m.kind === 'in' && m.origin === 'form') {
    return 'Création de la fiche';
  }
  const base = KIND_LABELS[m.kind];
  return m.origin === 'scan' ? `${base} au scanner` : base;
}

export function movementAmount(m: StockMovement): string {
  const n = Math.abs(m.quantity);
  const unit = m.unit === 'unit' ? (n > 1 ? 'pièces' : 'pièce') : m.unit;
  return `${m.quantity > 0 ? '+' : '−'}${formatNumber(n)} ${unit}`;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Jour local d'un horodatage, `AAAA-MM-JJ`. */
export function localDay(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function localTime(iso: string): string {
  const d = new Date(iso);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function MovementRow(props: {
  movement: StockMovement;
  /** Afficher le nom de l'article (historique général). */
  showName?: boolean;
  /** Afficher la date en plus de l'heure. */
  showDate?: boolean;
}) {
  const m = props.movement;
  const positive = m.quantity > 0;
  const day = localDay(m.createdAt).split('-').reverse().join('/');
  const when = props.showDate
    ? `${day} · ${localTime(m.createdAt)}`
    : localTime(m.createdAt);
  const amount = movementAmount(m);
  const label = movementLabel(m);
  return (
    <View
      accessible
      accessibilityLabel={`${label}, ${amount}${
        props.showName ? `, ${m.itemName}` : ''
      }, ${when}`}
      style={styles.row}
    >
      <Text
        style={[
          text.mono,
          styles.amount,
          { color: positive ? colors.success : colors.danger },
        ]}
      >
        {amount}
      </Text>
      <View style={styles.grow}>
        {props.showName ? <Text style={text.body}>{m.itemName}</Text> : null}
        <Text style={text.subtle}>
          {label} · {when}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.m },
  amount: { minWidth: 92, fontSize: 15, fontWeight: '700' },
  grow: { flex: 1, minWidth: 0 },
});
