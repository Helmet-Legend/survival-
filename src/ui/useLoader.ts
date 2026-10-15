import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Charge des données asynchrones et permet de les recharger après une
 * modification. Ignore les réponses arrivées après le démontage de l'écran
 * ou dépassées par un chargement plus récent. Recharge quand `deps` change.
 */
export function useLoader<T>(
  load: () => Promise<T>,
  deps: readonly unknown[] = [],
) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);
  const loadRef = useRef(load);
  loadRef.current = load;

  const reload = useCallback(async () => {
    const current = ++generation.current;
    try {
      const result = await loadRef.current();
      if (current === generation.current) {
        setData(result);
        setError(null);
      }
    } catch (e) {
      if (current === generation.current) {
        setError(e instanceof Error ? e.message : String(e));
      }
    }
  }, []);

  useEffect(() => {
    void reload();
    // Au démontage ou au changement de `deps`, invalide le chargement en cours.
    const counter = generation;
    return () => {
      counter.current++;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- dépendances fournies par l'appelant
  }, [reload, ...deps]);

  return { data, error, reload };
}
