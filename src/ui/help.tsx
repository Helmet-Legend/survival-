/**
 * Bulles d'aide : une courte explication à la première ouverture de chaque
 * écran principal. « Compris » la ferme pour de bon sur ce téléphone ; le
 * bouton « ? » de l'en-tête la rouvre, et les Réglages les remettent toutes.
 *
 * Les écrans vus sont gardés dans le coffre (réglage `help_seen`), propre à
 * chaque téléphone : il n'est pas partagé avec le foyer.
 */
import { Info } from 'lucide-react-native';
import React, { createContext, useContext } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { SqlDatabase } from '../db/types';
import type { Overlay, Tab } from './navigation';
import { colors, radius, space, text } from './theme';

export type HelpId =
  | 'home'
  | 'stock'
  | 'prepare'
  | 'guides'
  | 'map'
  | 'emergency'
  | 'pharmacy'
  | 'scan'
  | 'familyPlan'
  | 'crisis'
  | 'kit'
  | 'sync';

export const HELP_TIPS: Record<HelpId, string> = {
  home: 'Votre tableau de bord : combien de jours le foyer tient, la ressource qui manque en premier et ce qui périme bientôt. Les accès rapides ouvrent Préparer, le plan familial, la pharmacie et le scanner.',
  stock:
    'Tout ce que vous avez, rangé par catégorie. Ajoutez un article avec « + » ou en scannant son code-barres. Les dates de péremption servent aux rappels et au calcul de l’autonomie.',
  prepare:
    'Tout ce qui sert à se préparer : votre foyer, le kit et le matériel, le plan d’action, les achats, la pharmacie, le plan familial, le simulateur de crise et les calculateurs.',
  guides:
    'Les consignes de survie, lisibles sans réseau. Cherchez par mot-clé ou ouvrez une famille. Les fiches réflexes (hémorragie, arrêt cardiaque…) sont aussi dans l’écran Urgence.',
  map: 'Vos points de repère, la carte hors ligne, vos coordonnées (GPS et MGRS) et l’azimut vers un point. Tout fonctionne sans réseau une fois la carte téléchargée.',
  emergency:
    'Les numéros d’urgence, le signal lumineux, votre position à envoyer par SMS et les fiches réflexes. Le coffre reste ouvert 2 minutes pendant un appel lancé ici.',
  pharmacy:
    'Indiquez qui compose le foyer et pour combien de temps : Fenrir calcule les boîtes à stocker. Notez ce que vous avez déjà pour voir ce qui manque. Aucune posologie : demandez conseil au pharmacien.',
  scan: 'Scannez les codes-barres à la suite : chaque produit va dans le panier. Confirmez ensuite pour l’ajouter au stock. Un produit inconnu, nommé une fois, est reconnu ensuite.',
  familyPlan:
    'Préparez à l’avance où vous retrouver, qui appeler et dans quel ordre essayer les moyens de communication. Le plan reste lisible depuis l’écran Urgence.',
  crisis:
    'Choisissez un scénario (coupure de courant, confinement…) et une durée : Fenrir simule jour par jour ce que votre stock réel permet de tenir, et ce qui manquerait.',
  kit: 'Le sac d’évacuation et le matériel de la maison, comparés à ce que vous avez déjà. Cochez ce qui est prêt ; ce qui manque peut s’ajouter au stock.',
  sync: 'Partagez le stock du foyer entre vos téléphones, sur le même réseau Wi-Fi et sans passer par Internet. Choisissez ce qui est partagé en plus des stocks.',
};

/** Bulle de l'écran affiché : section, ou écran secondaire ouvert dessus. */
export function helpIdFor(tab: Tab, overlay: Overlay | null): HelpId | null {
  if (overlay === null) {
    return tab;
  }
  switch (overlay) {
    case 'emergency':
    case 'pharmacy':
    case 'scan':
    case 'familyPlan':
    case 'crisis':
    case 'sync':
      return overlay;
    case 'preparation':
      return 'kit';
    default:
      return null;
  }
}

const KEY = 'help_seen';

export async function loadHelpSeen(db: SqlDatabase): Promise<HelpId[]> {
  const { rows } = await db.execute(
    'SELECT value FROM settings WHERE key = ?',
    [KEY],
  );
  try {
    const value: unknown = JSON.parse(String(rows[0]?.value ?? '[]'));
    return Array.isArray(value)
      ? value.filter(
          (id): id is HelpId => typeof id === 'string' && id in HELP_TIPS,
        )
      : [];
  } catch {
    return [];
  }
}

export async function saveHelpSeen(
  db: SqlDatabase,
  seen: readonly HelpId[],
): Promise<void> {
  await db.execute(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
    [KEY, JSON.stringify([...new Set(seen)])],
  );
}

export interface Help {
  /** Écrans dont la bulle a été fermée. */
  seen: ReadonlySet<HelpId>;
  /** Bulle rouverte avec « ? », affichée même si elle a été vue. */
  reopened: HelpId | null;
  dismiss(id: HelpId): void;
  reopen(id: HelpId): void;
  /** Toutes les bulles réapparaîtront (Réglages). */
  reset(): void;
}

/** Sans coffre ouvert (Urgence sans code), aucune bulle. */
export const HelpContext = createContext<Help | null>(null);

export function useHelp(): Help | null {
  return useContext(HelpContext);
}

/** Bulle d'un écran, en haut de son contenu, tant qu'elle n'a pas été vue. */
export function HelpBubble({ id }: { id: HelpId }) {
  const help = useHelp();
  if (help === null || (help.seen.has(id) && help.reopened !== id)) {
    return null;
  }
  return (
    <View
      style={styles.bubble}
      accessibilityRole="summary"
      accessibilityLabel={`Aide : ${HELP_TIPS[id]}`}
    >
      <View style={styles.head}>
        <View style={styles.icon}>
          <Info color={colors.bg} size={18} strokeWidth={2.6} />
        </View>
        <Text style={styles.title}>À quoi sert cet écran ?</Text>
      </View>
      <Text style={styles.body}>{HELP_TIPS[id]}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Compris : fermer l’aide"
        onPress={() => help.dismiss(id)}
        style={({ pressed }) => [styles.ok, pressed && styles.pressed]}
      >
        <Text style={styles.okText}>Compris</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  bubble: {
    gap: space.s,
    padding: space.m,
    borderRadius: radius.card,
    borderWidth: 2,
    borderColor: colors.cyan,
    backgroundColor: '#072431',
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: space.s },
  icon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.cyan,
  },
  title: { ...text.body, fontWeight: '800', flex: 1 },
  body: { ...text.body, fontSize: 15, lineHeight: 21, color: '#E3EDF2' },
  ok: {
    alignSelf: 'flex-end',
    minHeight: 44,
    paddingHorizontal: space.xl,
    justifyContent: 'center',
    borderRadius: radius.button,
    backgroundColor: colors.cyan,
  },
  okText: { color: colors.bg, fontSize: 15, fontWeight: '800' },
  pressed: { opacity: 0.8 },
});
