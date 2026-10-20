/**
 * Vigilance météorologique de Météo-France, relayée par MeteoAlarm
 * (EUMETNET) : tout le pays en un seul téléchargement, sans clé, triée ici
 * selon les départements suivis. Couvre vent, orages, pluie-inondation,
 * crues, vagues-submersion, neige-verglas, canicule, grand froid, feux de
 * forêt et avalanches.
 */
import { DEPARTMENTS, plainName } from './departments';
import { LEVEL_RANK, type Alert, type AlertLevel } from './types';

export const METEO_URL =
  'https://feeds.meteoalarm.org/api/v1/warnings/feeds-france';

/** Phénomène d'après `awareness_type` (numéro MeteoAlarm). */
const HAZARDS: Record<string, string> = {
  '1': 'vent violent',
  '2': 'neige-verglas',
  '3': 'orages',
  '4': 'brouillard',
  '5': 'canicule',
  '6': 'grand froid',
  '7': 'vagues-submersion',
  '8': 'feux de forêt',
  '9': 'avalanches',
  '10': 'pluie',
  '12': 'crues',
  '13': 'pluie-inondation',
};

const LEVELS: Record<string, AlertLevel> = {
  '2': 'yellow',
  '3': 'orange',
  '4': 'red',
};

const LEVEL_WORDS: Record<AlertLevel, string> = {
  yellow: 'jaune',
  orange: 'orange',
  red: 'rouge',
};

interface CapParameter {
  valueName?: string;
  value?: string;
}

interface CapInfo {
  language?: string;
  event?: string;
  headline?: string;
  description?: string;
  instruction?: string;
  onset?: string;
  effective?: string;
  expires?: string;
  web?: string;
  parameter?: CapParameter[];
  area?: { areaDesc?: string }[];
}

interface Feed {
  warnings?: { alert?: { identifier?: string; info?: CapInfo[] } }[];
}

function param(info: CapInfo, name: string): string | null {
  const p = (info.parameter ?? []).find(x => x.valueName === name);
  return p?.value ? p.value.split(';')[0].trim() : null;
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

/**
 * Vigilances jaunes, orange et rouges en cours ou à venir sur les
 * départements suivis ; une seule par phénomène et par département (la plus
 * grave, puis la plus récente).
 */
export function parseMeteo(
  json: unknown,
  departments: readonly string[],
  now: Date,
): Alert[] {
  const wanted = new Map<string, string>();
  for (const [code, name] of DEPARTMENTS) {
    if (departments.includes(code)) {
      wanted.set(plainName(name), name);
    }
  }
  const best = new Map<string, Alert>();
  for (const warning of (json as Feed | null)?.warnings ?? []) {
    const infos = warning.alert?.info ?? [];
    // Texte français de préférence, sinon la première langue publiée.
    const info =
      infos.find(i => i.language?.toLowerCase().startsWith('fr')) ?? infos[0];
    if (info === undefined) {
      continue;
    }
    const level = LEVELS[param(info, 'awareness_level') ?? ''];
    const type = param(info, 'awareness_type') ?? '';
    const end = text(info.expires);
    if (level === undefined || (end !== null && new Date(end) <= now)) {
      continue;
    }
    const hazard = HAZARDS[type] ?? text(info.event) ?? 'météo';
    for (const area of info.area ?? []) {
      const name = wanted.get(plainName(area.areaDesc ?? ''));
      if (name === undefined) {
        continue;
      }
      const alert: Alert = {
        id: `meteo:${type}:${name}`,
        source: 'meteo',
        level,
        title: `Vigilance ${LEVEL_WORDS[level]} ${hazard}`,
        where: name,
        detail: text(info.description),
        instruction: text(info.instruction),
        start: text(info.onset) ?? text(info.effective),
        end,
        url: text(info.web),
      };
      const previous = best.get(alert.id);
      if (
        previous === undefined ||
        LEVEL_RANK[level] > LEVEL_RANK[previous.level] ||
        (LEVEL_RANK[level] === LEVEL_RANK[previous.level] &&
          (alert.start ?? '') > (previous.start ?? ''))
      ) {
        best.set(alert.id, alert);
      }
    }
  }
  return [...best.values()];
}
