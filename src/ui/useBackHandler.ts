/**
 * Bouton et geste « retour » d'Android : l'écran le plus profond le traite
 * d'abord (une fiche ouverte, puis sa catégorie, puis l'écran secondaire,
 * puis la section). Sans personne pour le traiter, Android quitte
 * l'application, comme d'habitude.
 */
import { useEffect, useRef, useState } from 'react';
import { BackHandler } from 'react-native';

type Handler = () => boolean;

// Rang pris au premier rendu : un parent est rendu avant ses enfants, donc
// le rang le plus élevé est l'écran le plus profond (ou le plus récent).
let lastRank = 0;
const handlers = new Map<number, { current: Handler }>();
let installed = false;

/** Traite un appui sur « retour » ; `false` : personne ne l'a pris. */
export function pressBack(): boolean {
  const ranks = [...handlers.keys()].sort((a, b) => b - a);
  for (const rank of ranks) {
    if (handlers.get(rank)?.current()) {
      return true;
    }
  }
  return false;
}

/**
 * Traite « retour » tant que `onBack` n'est pas null. `onBack` rend `false`
 * pour laisser la main aux écrans parents.
 */
export function useBackHandler(onBack: Handler | null) {
  const [rank] = useState(() => ++lastRank);
  const ref = useRef<Handler>(() => false);
  ref.current = onBack ?? (() => false);
  const enabled = onBack !== null;
  useEffect(() => {
    if (!enabled) {
      return undefined;
    }
    if (!installed) {
      installed = true;
      BackHandler.addEventListener('hardwareBackPress', pressBack);
    }
    handlers.set(rank, ref);
    return () => {
      handlers.delete(rank);
    };
  }, [enabled, rank]);
}

/** Variante courante : revenir d'un cran quand `active` est vrai. */
export function useBack(active: boolean, back: () => void) {
  useBackHandler(
    active
      ? () => {
          back();
          return true;
        }
      : null,
  );
}
