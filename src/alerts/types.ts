/**
 * Alertes : vigilances et avis officiels téléchargés quand le réseau le
 * permet, filtrés sur le téléphone (départements suivis, stock du foyer).
 */

/** Gravité, du plus faible au plus fort (codes couleur de la vigilance). */
export type AlertLevel = 'yellow' | 'orange' | 'red';

export const LEVEL_RANK: Record<AlertLevel, number> = {
  yellow: 1,
  orange: 2,
  red: 3,
};

export type AlertSource =
  | 'meteo'
  | 'recall'
  | 'medicine'
  | 'quake'
  | 'water'
  | 'supply';

export interface Alert {
  /** Stable d'un relevé à l'autre (pour ne compter une alerte qu'une fois). */
  id: string;
  source: AlertSource;
  level: AlertLevel;
  /** « Vigilance orange inondations ». */
  title: string;
  /** Lieu (« Bouches-du-Rhône ») ou article du stock concerné. */
  where: string | null;
  /** Texte officiel : description, motif du rappel… */
  detail: string | null;
  /** Conduite à tenir officielle. */
  instruction: string | null;
  /** Début et fin, ISO 8601. */
  start: string | null;
  end: string | null;
  /** Page officielle. */
  url: string | null;
  /** Article du stock concerné (rappel, médicament). */
  itemId?: string;
}

/** Requête HTTP injectable (tests, aperçu) ; texte brut de la réponse. */
export type AlertFetch = (
  url: string,
) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

export function maxLevel(alerts: readonly Alert[]): AlertLevel | null {
  let best: AlertLevel | null = null;
  for (const a of alerts) {
    if (best === null || LEVEL_RANK[a.level] > LEVEL_RANK[best]) {
      best = a.level;
    }
  }
  return best;
}

/** Les plus graves d'abord, puis les plus récentes. */
export function sortAlerts(alerts: readonly Alert[]): Alert[] {
  return [...alerts].sort(
    (a, b) =>
      LEVEL_RANK[b.level] - LEVEL_RANK[a.level] ||
      (b.start ?? '').localeCompare(a.start ?? ''),
  );
}

const TIMEOUT_MS = 25000;

/** `fetch` avec délai maximal : un réseau qui ne répond pas vaut hors ligne. */
export const defaultAlertFetch: AlertFetch = async url => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('Délai dépassé')), TIMEOUT_MS);
  });
  try {
    return await Promise.race([
      fetch(url, { headers: { Accept: 'application/json, text/plain' } }),
      timeout,
    ]);
  } finally {
    clearTimeout(timer);
  }
};
