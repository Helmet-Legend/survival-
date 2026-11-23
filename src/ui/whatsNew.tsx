/**
 * Bulle « Nouveautés » de l'accueil : ce qui a été ajouté depuis la
 * dernière bulle fermée sur ce téléphone. Les nouveautés sont écrites ici,
 * la plus récente en premier, avec un numéro qui ne fait que croître.
 *
 * Le dernier numéro vu est gardé dans le coffre (réglage `whats_new_seen`),
 * propre à chaque téléphone, comme les bulles d'aide.
 */
import { Sparkles } from 'lucide-react-native';
import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { SqlDatabase } from '../db/types';
import { useSession } from './session';
import { colors, radius, space, text } from './theme';

export interface WhatsNewEntry {
  /** Numéro croissant : une entrée plus récente a un numéro plus grand. */
  id: number;
  title: string;
  items: readonly string[];
}

export const WHATS_NEW: readonly WhatsNewEntry[] = [
  {
    id: 2,
    title: 'Documents en PDF',
    items: [
      'Dans Stocks → Documents, « Importer un PDF » ajoute une attestation Vitale, un avis d’imposition ou un contrat de mutuelle sans le photographier. Les pages restent dans le coffre chiffré.',
    ],
  },
  {
    id: 1,
    title: 'Boussole et « Mes fiches »',
    items: [
      'Boussole hors ligne dans Position : nord magnétique ou géographique, et un cap à suivre.',
      '« Mes fiches » dans l’onglet Fiches : vos propres fiches, avec texte, photos et PDF importés.',
    ],
  },
];

/** Entrées montrées au plus, pour garder la bulle courte. */
export const WHATS_NEW_SHOWN_MAX = 3;

/** Nouveautés pas encore vues, la plus récente en premier. */
export function unseenNews(
  seen: number,
  entries: readonly WhatsNewEntry[] = WHATS_NEW,
): WhatsNewEntry[] {
  return entries
    .filter(e => e.id > seen)
    .sort((a, b) => b.id - a.id)
    .slice(0, WHATS_NEW_SHOWN_MAX);
}

const KEY = 'whats_new_seen';

export async function loadWhatsNewSeen(db: SqlDatabase): Promise<number> {
  const { rows } = await db.execute(
    'SELECT value FROM settings WHERE key = ?',
    [KEY],
  );
  const value = Number(rows[0]?.value);
  return Number.isInteger(value) && value > 0 ? value : 0;
}

export async function saveWhatsNewSeen(
  db: SqlDatabase,
  id: number,
): Promise<void> {
  await db.execute(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
    [KEY, String(id)],
  );
}

export function WhatsNewBubble() {
  const { db } = useSession();
  const [news, setNews] = useState<WhatsNewEntry[]>([]);

  useEffect(() => {
    let live = true;
    loadWhatsNewSeen(db)
      .then(seen => {
        if (live) {
          setNews(unseenNews(seen));
        }
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [db]);

  if (news.length === 0) {
    return null;
  }
  const dismiss = () => {
    setNews([]);
    saveWhatsNewSeen(db, news[0].id).catch(() => undefined);
  };
  return (
    <View
      style={styles.bubble}
      accessibilityRole="summary"
      accessibilityLabel={`Nouveautés : ${news
        .map(e => `${e.title}. ${e.items.join(' ')}`)
        .join(' ')}`}
    >
      <View style={styles.head}>
        <View style={styles.icon}>
          <Sparkles color={colors.bg} size={18} strokeWidth={2.6} />
        </View>
        <Text style={styles.title} maxFontSizeMultiplier={1.5}>
          Nouveautés
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Compris : fermer les nouveautés"
          onPress={dismiss}
          style={({ pressed }) => [styles.ok, pressed && styles.pressed]}
        >
          <Text style={styles.okText} maxFontSizeMultiplier={1.5}>
            Compris
          </Text>
        </Pressable>
      </View>
      {news.map(entry => (
        <View key={entry.id} style={styles.entry}>
          <Text style={styles.entryTitle} maxFontSizeMultiplier={1.5}>
            {entry.title}
          </Text>
          {entry.items.map(item => (
            <Text key={item} style={styles.body} maxFontSizeMultiplier={1.5}>
              • {item}
            </Text>
          ))}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  bubble: {
    gap: space.s,
    padding: space.m,
    borderRadius: radius.card,
    borderWidth: 2,
    borderColor: colors.primary,
    backgroundColor: '#2A1A08',
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: space.s },
  icon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
  },
  title: { ...text.body, fontWeight: '800', flex: 1 },
  entry: { gap: 2 },
  entryTitle: { ...text.body, fontWeight: '700', color: colors.primary },
  body: { ...text.body, fontSize: 15, lineHeight: 21, color: '#F2E9DE' },
  ok: {
    minHeight: 44,
    paddingHorizontal: space.l,
    justifyContent: 'center',
    borderRadius: radius.button,
    backgroundColor: colors.primary,
  },
  okText: { color: colors.bg, fontSize: 15, fontWeight: '800' },
  pressed: { opacity: 0.8 },
});
