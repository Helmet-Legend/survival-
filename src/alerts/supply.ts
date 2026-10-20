/**
 * Ressources : restrictions d'eau (VigiEau), signal gaz (Ecogaz) et
 * stations-service en rupture (prix des carburants). Données nationales ou
 * par département, triées ici.
 */
import { departmentName } from './departments';
import type { Alert, AlertLevel } from './types';

// --- Restrictions d'eau (VigiEau) ------------------------------------------------

export const WATER_URL = 'https://api.vigieau.gouv.fr/api/departements';

const WATER_LEVELS: Record<string, { level: AlertLevel; label: string }> = {
  vigilance: { level: 'yellow', label: 'vigilance' },
  alerte: { level: 'yellow', label: 'alerte' },
  alerte_renforcee: { level: 'orange', label: 'alerte renforcée' },
  crise: { level: 'red', label: 'crise' },
};

/** Niveau de restriction le plus élevé de chaque département suivi. */
export function parseWater(
  json: unknown,
  departments: readonly string[],
): Alert[] {
  const alerts: Alert[] = [];
  for (const d of Array.isArray(json) ? json : []) {
    const code = String((d as { code?: unknown }).code ?? '');
    const max = (d as { niveauGraviteMax?: unknown }).niveauGraviteMax;
    const kind = typeof max === 'string' ? WATER_LEVELS[max] : undefined;
    if (!departments.includes(code) || kind === undefined) {
      continue;
    }
    alerts.push({
      id: `water:${code}`,
      source: 'water',
      level: kind.level,
      title: `Restrictions d’eau : ${kind.label}`,
      where: departmentName(code) ?? code,
      detail:
        'Niveau le plus élevé en vigueur dans le département : selon votre commune, les restrictions peuvent être moindres.',
      instruction:
        'Consultez les usages autorisés pour votre adresse et ménagez votre réserve.',
      start: null,
      end: null,
      url: 'https://vigieau.gouv.fr/',
    });
  }
  return alerts;
}

// --- Gaz (Ecogaz) ----------------------------------------------------------------

export const GAS_URL =
  'https://odre.opendatasoft.com/api/explore/v2.1/catalog/datasets/signal-ecogaz/records' +
  '?select=date,couleur_du_signal_fr&where=couleur_du_signal_fr%20is%20not%20null' +
  '&order_by=date%20desc&limit=8';

const GAS_LEVELS: Record<string, AlertLevel> = {
  jaune: 'yellow',
  orange: 'orange',
  rouge: 'red',
};

/** Signal national du jour et des jours suivants, au-delà du vert. */
export function parseGas(json: unknown, today: string): Alert[] {
  const rows =
    (json as { results?: { date?: string; couleur_du_signal_fr?: string }[] })
      ?.results ?? [];
  const alerts: Alert[] = [];
  for (const r of rows) {
    const color = (r.couleur_du_signal_fr ?? '').trim().toLowerCase();
    const level = GAS_LEVELS[color];
    if (level === undefined || (r.date ?? '') < today) {
      continue;
    }
    alerts.push({
      id: `gas:${r.date}`,
      source: 'supply',
      level,
      title: `Ecogaz ${color} : tension sur le gaz`,
      where: 'France',
      detail:
        level === 'red'
          ? 'Signal rouge : des coupures de gaz sont possibles.'
          : 'Le réseau de gaz est tendu.',
      instruction: 'Réduisez votre consommation de gaz.',
      start: r.date ?? null,
      end: r.date ?? null,
      url: 'https://www.monecogaz.fr/',
    });
  }
  return alerts;
}

// --- Carburants -----------------------------------------------------------------

/** Stations d'un département (préfixe du code postal) avec leurs ruptures. */
export function fuelUrl(department: string): string {
  const prefix = department === '2A' || department === '2B' ? '20' : department;
  const where = encodeURIComponent(`startswith(cp, "${prefix}")`);
  return (
    'https://data.economie.gouv.fr/api/explore/v2.1/catalog/datasets/' +
    `prix-des-carburants-en-france-flux-instantane-v2/exports/json?select=cp,rupture&where=${where}`
  );
}

/** Part des stations en rupture temporaire à partir de laquelle Fenrir signale. */
export const FUEL_THRESHOLDS = { yellow: 0.1, orange: 0.25 };

/** Corse : 200 et 201 en Corse-du-Sud, les autres en Haute-Corse. */
function corsica(cp: string): string {
  return /^20[01]/.test(cp) ? '2A' : '2B';
}

export function parseFuel(
  json: unknown,
  department: string,
  now: Date,
): Alert[] {
  let stations = 0;
  let short = 0;
  const fuels = new Set<string>();
  const since = new Date(now.getTime() - 7 * 86_400_000)
    .toISOString()
    .slice(0, 10);
  for (const s of Array.isArray(json) ? json : []) {
    const cp = String((s as { cp?: unknown }).cp ?? '');
    if (
      (department === '2A' || department === '2B') &&
      corsica(cp) !== department
    ) {
      continue;
    }
    stations += 1;
    let list: { '@nom'?: string; '@type'?: string; '@debut'?: string }[] = [];
    try {
      const raw = (s as { rupture?: unknown }).rupture;
      list = typeof raw === 'string' && raw !== '' ? JSON.parse(raw) : [];
    } catch {
      list = [];
    }
    // Ruptures temporaires récentes : les ruptures définitives (carburant
    // jamais vendu) ne disent rien d'une pénurie.
    const recent = (Array.isArray(list) ? list : []).filter(
      r => r['@type'] === 'temporaire' && (r['@debut'] ?? '') >= since,
    );
    if (recent.length > 0) {
      short += 1;
      recent.forEach(r => r['@nom'] && fuels.add(r['@nom']));
    }
  }
  if (stations === 0) {
    return [];
  }
  const share = short / stations;
  if (share < FUEL_THRESHOLDS.yellow) {
    return [];
  }
  return [
    {
      id: `fuel:${department}`,
      source: 'supply',
      level: share >= FUEL_THRESHOLDS.orange ? 'orange' : 'yellow',
      title: 'Stations-service en rupture',
      where: departmentName(department) ?? department,
      detail: `${short} stations sur ${stations} signalent une rupture temporaire${
        fuels.size > 0 ? ` (${[...fuels].join(', ')})` : ''
      }. Fenrir signale à partir de 10 % des stations.`,
      instruction:
        'Faites le plein si besoin et vérifiez vos jerricans ; ne stockez le carburant que dans des contenants homologués.',
      start: null,
      end: null,
      url: 'https://www.prix-carburants.gouv.fr/',
    },
  ];
}
