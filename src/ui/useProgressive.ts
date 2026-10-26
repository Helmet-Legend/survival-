/**
 * Affichage progressif des longues listes : seules les premières lignes
 * sont dessinées, la suite s'ajoute quand le défilement approche du bas
 * (signal donné par l'écran qui défile, via `ScrollEndContext`).
 */
import { createContext, useContext, useEffect, useState } from 'react';

export const LIST_PAGE = 40;

/** Incrémenté par l'écran à chaque fois que le bas de la page approche. */
export const ScrollEndContext = createContext(0);

/**
 * `tick` : signal de défilement, pour l'écran qui fournit lui-même
 * `ScrollEndContext` (il ne peut pas le lire) ; sinon celui du contexte.
 */
export function useProgressive(
  total: number,
  resetKey: unknown,
  tick?: number,
) {
  const fromContext = useContext(ScrollEndContext);
  const signal = tick ?? fromContext;
  const [shown, setShown] = useState(LIST_PAGE);
  useEffect(() => {
    setShown(LIST_PAGE);
  }, [resetKey]);
  useEffect(() => {
    if (signal > 0) {
      setShown(s => (s < total ? s + LIST_PAGE : s));
    }
    // Seul un nouveau signal de défilement agrandit la liste.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signal]);
  const visible = Math.min(shown, total);
  return {
    visible,
    rest: total - visible,
    more: () => setShown(s => s + LIST_PAGE),
  };
}
