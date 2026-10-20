/**
 * Alertes affichées : le dernier relevé tout de suite, puis un nouveau
 * relevé en arrière-plan pour les sources trop anciennes (si les alertes
 * sont activées et que le réseau répond).
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import {
  currentAlerts,
  loadAlertCache,
  loadAlertSettings,
  refreshAlerts,
  type AlertCache,
  type AlertSettings,
} from '../alerts/store';
import type { Alert } from '../alerts/types';
import { useSession } from './session';

export interface AlertsState {
  settings: AlertSettings | null;
  cache: AlertCache | null;
  alerts: Alert[];
  refreshing: boolean;
  /** Relit le cache ; avec `fetch`, télécharge (toutes les sources si `force`). */
  reload(options?: { fetch?: boolean; force?: boolean }): Promise<void>;
}

export function useAlerts(
  options: { autoRefresh?: boolean } = {},
): AlertsState {
  const { db, alertFetch } = useSession();
  const [settings, setSettings] = useState<AlertSettings | null>(null);
  const [cache, setCache] = useState<AlertCache | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const mounted = useRef(true);
  useEffect(
    () => () => {
      mounted.current = false;
    },
    [],
  );

  const read = useCallback(async () => {
    const [s, c] = await Promise.all([
      loadAlertSettings(db),
      loadAlertCache(db),
    ]);
    if (mounted.current) {
      setSettings(s);
      setCache(c);
    }
    return s;
  }, [db]);

  const reload = useCallback(
    async (opts: { fetch?: boolean; force?: boolean } = {}) => {
      const s = await read();
      if (!opts.fetch || !s.enabled) {
        return;
      }
      setRefreshing(true);
      try {
        await refreshAlerts(db, alertFetch, { force: opts.force });
      } catch {
        // Hors ligne : on garde le dernier relevé.
      } finally {
        if (mounted.current) {
          setRefreshing(false);
        }
      }
      await read();
    },
    [db, alertFetch, read],
  );

  const auto = options.autoRefresh !== false;
  useEffect(() => {
    reload({ fetch: auto }).catch(() => undefined);
  }, [reload, auto]);

  return {
    settings,
    cache,
    alerts: cache && settings?.enabled ? currentAlerts(cache, new Date()) : [],
    refreshing,
    reload,
  };
}
