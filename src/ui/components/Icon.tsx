/**
 * Pictogrammes dessinés avec de simples vues : aucune police d'icônes ni
 * module natif supplémentaire (moins de risques à la compilation).
 */
/* eslint-disable react-native/no-inline-styles -- géométrie calculée selon la taille demandée */
import React from 'react';
import { StyleSheet, View } from 'react-native';

export type IconName = 'gauge' | 'stock' | 'nav' | 'book' | 'lock';

export function Icon({
  name,
  color,
  size = 22,
}: {
  name: IconName;
  color: string;
  size?: number;
}) {
  const s = size;
  const line = Math.max(2, Math.round(s / 11));
  const box = { width: s, height: s };

  switch (name) {
    case 'gauge':
      // Trois barres de niveau croissant.
      return (
        <View style={[box, styles.row, { gap: line }]}>
          {[0.45, 0.7, 1].map(h => (
            <View
              key={h}
              style={{
                width: line * 1.6,
                height: s * h,
                backgroundColor: color,
                borderRadius: 1,
              }}
            />
          ))}
        </View>
      );
    case 'stock':
      // Trois caisses empilées.
      return (
        <View style={[box, styles.stack]}>
          <View
            style={[
              styles.crate,
              {
                width: s * 0.5,
                height: s * 0.42,
                borderColor: color,
                borderWidth: line,
              },
            ]}
          />
          <View style={[styles.rowCenter, { gap: line }]}>
            {[0, 1].map(i => (
              <View
                key={i}
                style={[
                  styles.crate,
                  {
                    width: s * 0.46,
                    height: s * 0.42,
                    borderColor: color,
                    borderWidth: line,
                  },
                ]}
              />
            ))}
          </View>
        </View>
      );
    case 'nav':
      // Réticule : cercle et croix.
      return (
        <View style={[box, styles.center]}>
          <View
            style={{
              width: s * 0.72,
              height: s * 0.72,
              borderRadius: s,
              borderWidth: line,
              borderColor: color,
            }}
          />
          <View
            style={[
              styles.abs,
              { width: line, height: s, backgroundColor: color },
            ]}
          />
          <View
            style={[
              styles.abs,
              { width: s, height: line, backgroundColor: color },
            ]}
          />
        </View>
      );
    case 'book':
      // Fiche : rectangle et lignes de texte.
      return (
        <View style={[box, styles.center]}>
          <View
            style={{
              width: s * 0.78,
              height: s * 0.92,
              borderWidth: line,
              borderColor: color,
              borderRadius: 2,
              padding: line,
              gap: line,
              justifyContent: 'center',
            }}
          >
            {[1, 0.7, 1, 0.55].map((w, i) => (
              <View
                key={i}
                style={{
                  width: `${w * 100}%`,
                  height: line * 0.8,
                  backgroundColor: color,
                }}
              />
            ))}
          </View>
        </View>
      );
    case 'lock':
      // Cadenas : anse et corps.
      return (
        <View style={[box, styles.lock]}>
          <View
            style={{
              width: s * 0.5,
              height: s * 0.42,
              borderWidth: line,
              borderBottomWidth: 0,
              borderColor: color,
              borderTopLeftRadius: s,
              borderTopRightRadius: s,
            }}
          />
          <View
            style={{
              width: s * 0.78,
              height: s * 0.5,
              backgroundColor: color,
              borderRadius: 3,
            }}
          />
        </View>
      );
  }
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  rowCenter: { flexDirection: 'row', justifyContent: 'center' },
  stack: { alignItems: 'center', justifyContent: 'flex-end', gap: 1 },
  crate: { borderRadius: 2 },
  center: { alignItems: 'center', justifyContent: 'center' },
  abs: { position: 'absolute' },
  lock: { alignItems: 'center', justifyContent: 'flex-end' },
});
