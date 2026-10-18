/**
 * Calculateurs paramétrables : besoins en eau par usage et besoins
 * électriques par appareil. Ce sont des estimations : les hypothèses sont
 * saisies par l'utilisateur et affichées avec le résultat ; rien ne garantit
 * une durée d'autonomie.
 */
import type { SqlDatabase } from '../db/types';
import type { ItemSummary } from '../inventory';

// --- Eau ----------------------------------------------------------------------

export interface WaterInput {
  people: number;
  days: number;
  drinking: number;
  cooking: number;
  hygiene: number;
}

/** Repères du manuel Sphère, valeurs basses (L par personne et par jour). */
export const SPHERE_MINIMUM = { drinking: 2.5, cooking: 3, hygiene: 2 };

export interface WaterStock {
  /** Litres potables (ou sans potabilité renseignée). */
  potable: number;
  /** Litres à traiter, non potables ou de potabilité inconnue. */
  other: number;
}

export interface WaterResult {
  dailyNeed: number;
  totalNeed: number;
  /** Litres potables manquants pour la durée visée. */
  deficit: number;
  /** Masse approximative du besoin total, contenants non compris. */
  massKg: number;
  /** Jours entiers couverts par l'eau potable, ou null sans besoin. */
  days: number | null;
}

function liters(item: ItemSummary): number {
  if (item.unit === 'L') {
    return item.usableQuantity;
  }
  if (item.unit === 'mL') {
    return item.usableQuantity / 1000;
  }
  return 0;
}

/** Eau du stock général (sacs exclus), séparée selon la potabilité. */
export function waterStock(items: readonly ItemSummary[]): WaterStock {
  const stock: WaterStock = { potable: 0, other: 0 };
  for (const item of items) {
    if (item.category !== 'water' || item.bagId !== null) {
      continue;
    }
    const potability = item.attributes.potability;
    if (potability === undefined || potability === 'potable') {
      stock.potable += liters(item);
    } else {
      stock.other += liters(item);
    }
  }
  return stock;
}

export function computeWater(input: WaterInput, potable: number): WaterResult {
  const perPerson = input.drinking + input.cooking + input.hygiene;
  const dailyNeed = input.people * perPerson;
  const totalNeed = dailyNeed * input.days;
  return {
    dailyNeed,
    totalNeed,
    deficit: Math.max(0, totalNeed - potable),
    massKg: totalNeed,
    // Marge flottante : 6 L pour 2 L par jour donnent bien 3 jours.
    days: dailyNeed > 0 ? Math.floor(potable / dailyNeed + 1e-9) : null,
  };
}

// --- Électricité ------------------------------------------------------------------

export interface Device {
  name: string;
  watts: number;
  hoursPerDay: number;
  quantity: number;
}

export const MARGIN_CHOICES = [0, 10, 20, 30] as const;
export const EFFICIENCY_CHOICES = [70, 80, 90] as const;
export const MARGIN_DEFAULT = 20;
export const EFFICIENCY_DEFAULT = 80;

export interface ElectricResult {
  /** Énergie consommée par jour (Wh). */
  dailyWh: number;
  /** Capacité de batterie à prévoir par jour, marge et pertes comprises. */
  capacityPerDay: number;
  /** Puissance si tous les appareils fonctionnent ensemble (W). */
  simultaneousWatts: number;
  /** Jours entiers couverts par l'énergie stockée, ou null. */
  days: number | null;
}

export function computeElectric(
  devices: readonly Device[],
  marginPct: number,
  efficiencyPct: number,
  storedWh: number,
): ElectricResult {
  let dailyWh = 0;
  let simultaneousWatts = 0;
  for (const d of devices) {
    dailyWh += d.watts * d.hoursPerDay * d.quantity;
    simultaneousWatts += d.watts * d.quantity;
  }
  const capacityPerDay =
    efficiencyPct > 0
      ? (dailyWh * (1 + marginPct / 100)) / (efficiencyPct / 100)
      : 0;
  return {
    dailyWh,
    capacityPerDay,
    simultaneousWatts,
    days:
      capacityPerDay > 0 && storedWh > 0
        ? Math.floor(storedWh / capacityPerDay + 1e-9)
        : null,
  };
}

/** Lit un nombre saisi (virgule ou point) ; null si invalide ou négatif. */
export function parseAmount(raw: string): number | null {
  const cleaned = raw.replace(/\s/g, '').replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(cleaned)) {
    return null;
  }
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}

// --- Persistance des appareils et réglages -------------------------------------

const DEVICES_KEY = 'energy_devices';

export interface ElectricSettings {
  devices: Device[];
  marginPct: number;
  efficiencyPct: number;
}

function validDevice(value: unknown): value is Device {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const d = value as Record<string, unknown>;
  return (
    typeof d.name === 'string' &&
    typeof d.watts === 'number' &&
    d.watts >= 0 &&
    typeof d.hoursPerDay === 'number' &&
    d.hoursPerDay >= 0 &&
    d.hoursPerDay <= 24 &&
    typeof d.quantity === 'number' &&
    Number.isInteger(d.quantity) &&
    d.quantity >= 1
  );
}

export async function loadElectricSettings(
  db: SqlDatabase,
): Promise<ElectricSettings> {
  const fallback: ElectricSettings = {
    devices: [],
    marginPct: MARGIN_DEFAULT,
    efficiencyPct: EFFICIENCY_DEFAULT,
  };
  const { rows } = await db.execute(
    'SELECT value FROM settings WHERE key = ?',
    [DEVICES_KEY],
  );
  if (rows.length === 0) {
    return fallback;
  }
  try {
    const raw = JSON.parse(String(rows[0].value)) as Record<string, unknown>;
    const margin = Number(raw.marginPct);
    const efficiency = Number(raw.efficiencyPct);
    return {
      devices: Array.isArray(raw.devices)
        ? raw.devices.filter(validDevice)
        : [],
      marginPct: (MARGIN_CHOICES as readonly number[]).includes(margin)
        ? margin
        : MARGIN_DEFAULT,
      efficiencyPct: (EFFICIENCY_CHOICES as readonly number[]).includes(
        efficiency,
      )
        ? efficiency
        : EFFICIENCY_DEFAULT,
    };
  } catch {
    return fallback;
  }
}

export async function saveElectricSettings(
  db: SqlDatabase,
  settings: ElectricSettings,
): Promise<void> {
  await db.execute(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
    [DEVICES_KEY, JSON.stringify(settings)],
  );
}
