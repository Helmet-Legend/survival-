/**
 * Réserves hors eau et vivres, calculées d'après les fiches Énergie et
 * Matériel du stock général (sacs exclus, comme pour l'autonomie) :
 *
 * - énergie électrique stockée (Wh), rapportée à un besoin quotidien du
 *   foyer modifiable (recharge de téléphone, lampe) ;
 * - éclairage : lampes en état d'usage rapportées au nombre de personnes.
 *
 * Rien n'est deviné : une capacité absente, ou en mAh sans tension connue
 * (piles), est signalée comme inconnue et n'entre pas dans le calcul.
 */
import type { SqlDatabase } from '../db/types';
import type { ItemSummary, ItemUnit } from '../inventory';

/** Tension nominale d'une cellule lithium (batteries externes). */
export const LITHIUM_VOLTS = 3.7;
/** Part de l'énergie réellement utilisable (conversion, câbles, froid). */
export const USABLE_SHARE = 0.8;

export const ENERGY_NEED_DEFAULT = 15;
export const ENERGY_NEED_CHOICES = [10, 15, 20, 30] as const;
const ENERGY_NEED_KEY = 'wh_per_person_day';

export interface EnergyReport {
  /** Énergie stockée connue (Wh), avant pertes. */
  storedWh: number;
  /** Énergie utilisable (Wh), après pertes. */
  usableWh: number;
  /** Besoin quotidien du foyer (Wh). */
  dailyNeed: number;
  /** Jours entiers couverts, ou null si aucune capacité n'est connue. */
  days: number | null;
  /** Articles d'énergie électrique dont la capacité n'est pas exploitable. */
  unknown: string[];
  /** Carburant, gaz, bois… : listés, sans conversion en jours. */
  fuels: Array<{ name: string; quantity: number; unit: ItemUnit }>;
  /** Lampes en état d'usage. */
  lights: number;
}

const ELECTRIC = new Set(['battery', 'powerbank', 'solar', 'generator']);
const FUELS = new Set(['fuel', 'gas', 'wood', 'candle']);

/** Wh d'une unité d'article, ou null si la capacité n'est pas exploitable. */
export function unitWh(item: ItemSummary): number | null {
  const value = item.attributes.capacityValue;
  const unit = item.attributes.capacityUnit;
  if (value === undefined || !(value > 0)) {
    return null;
  }
  if (unit === 'Wh') {
    return value;
  }
  // mAh : seule la tension d'une batterie lithium est connue avec sûreté.
  if (unit === 'mAh' && item.subtype === 'powerbank') {
    return (value * LITHIUM_VOLTS) / 1000;
  }
  return null;
}

export function computeEnergy(
  items: readonly ItemSummary[],
  members: number,
  whPerPersonDay: number,
): EnergyReport {
  let storedWh = 0;
  let known = false;
  const unknown: string[] = [];
  const fuels: EnergyReport['fuels'] = [];
  let lights = 0;
  for (const item of items) {
    if (item.usableQuantity <= 0 || item.bagId !== null) {
      continue;
    }
    if (item.category === 'power' && item.subtype !== null) {
      if (ELECTRIC.has(item.subtype)) {
        const wh = unitWh(item);
        if (wh === null) {
          unknown.push(item.name);
        } else {
          storedWh += wh * item.usableQuantity;
          known = true;
        }
      } else if (FUELS.has(item.subtype)) {
        fuels.push({
          name: item.name,
          quantity: item.usableQuantity,
          unit: item.unit,
        });
      }
    }
    if (item.category === 'energy' && item.subtype === 'lighting') {
      lights += item.usableQuantity;
    }
  }
  const usableWh = storedWh * USABLE_SHARE;
  const dailyNeed = members * whPerPersonDay;
  return {
    storedWh,
    usableWh,
    dailyNeed,
    days: known ? Math.floor(usableWh / dailyNeed) : null,
    unknown,
    fuels,
    lights,
  };
}

export async function loadEnergyNeed(db: SqlDatabase): Promise<number> {
  const { rows } = await db.execute(
    'SELECT value FROM settings WHERE key = ?',
    [ENERGY_NEED_KEY],
  );
  const value = Number(rows[0]?.value);
  return value > 0 && value <= 1000 ? value : ENERGY_NEED_DEFAULT;
}

export async function saveEnergyNeed(
  db: SqlDatabase,
  whPerPersonDay: number,
): Promise<void> {
  await db.execute(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
    [ENERGY_NEED_KEY, String(whPerPersonDay)],
  );
}
