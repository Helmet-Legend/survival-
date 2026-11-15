/**
 * Animaux du foyer (Mon foyer › Animaux) : nom, espèce, poids, rations de
 * croquettes et de pâtée, eau par jour et source de cette eau.
 *
 * Les rations sont saisies par l'utilisateur (paquet ou vétérinaire) :
 * aucune n'est supposée. Seule l'eau peut être estimée d'après le poids,
 * repère non sourcé et modifiable (`WATER_ML_PER_KG`).
 *
 * La nourriture des animaux reste hors de l'autonomie du foyer. L'eau d'un
 * animal qui boit l'eau potable s'ajoute au besoin en eau du foyer ; celle
 * d'un animal qui boit l'eau de pluie ou de cuve est prise sur les réserves
 * non potables, ou sur l'eau potable s'il n'y en a pas.
 */
import type { SqlDatabase } from '../db/types';

export const PET_SPECIES = ['dog', 'cat', 'other'] as const;
export type PetSpecies = (typeof PET_SPECIES)[number];

export const PET_SPECIES_LABELS: Record<PetSpecies, string> = {
  dog: 'Chien',
  cat: 'Chat',
  other: 'Autre',
};

export type PetWaterSource = 'potable' | 'raw';

export interface Pet {
  id: string;
  name: string;
  species: PetSpecies;
  /** kg, facultatif : sert seulement à estimer l'eau. */
  weightKg: number | null;
  /** Croquettes par jour (g), 0 si aucune. */
  kibbleG: number;
  /** Pâtée par jour (g), 0 si aucune. */
  wetG: number;
  /** Eau par jour (L) saisie ; null : estimation d'après le poids. */
  waterL: number | null;
  waterSource: PetWaterSource;
}

/**
 * Eau par kg et par jour (mL) pour l'estimation. Repère non sourcé, à
 * valider ; toujours modifiable par l'utilisateur.
 */
export const WATER_ML_PER_KG: Record<PetSpecies, number | null> = {
  dog: 60,
  cat: 50,
  other: null,
};

export const PET_WATER_NOTE =
  'Repère non sourcé, à valider. Davantage par forte chaleur ou effort.';

const SETTING_KEY = 'household_pets';

/** Estimation d'après le poids (L / jour), ou null sans poids ni repère. */
export function estimatedWater(pet: Pet): number | null {
  const perKg = WATER_ML_PER_KG[pet.species];
  return pet.weightKg === null || perKg === null
    ? null
    : Math.round(pet.weightKg * perKg) / 1000;
}

/** Eau par jour retenue (L) : saisie, sinon estimée, sinon inconnue. */
export function petWater(pet: Pet): number | null {
  return pet.waterL ?? estimatedWater(pet);
}

/** Ration du jour pour un type d'aliment (`food` : croquettes, `wet` : pâtée). */
export function petRation(pet: Pet, subtype: string | null): number {
  return subtype === 'wet' ? pet.wetG : pet.kibbleG;
}

/** Animal sans aucune ration : « ration à renseigner ». */
export function rationMissing(pet: Pet): boolean {
  return pet.kibbleG <= 0 && pet.wetG <= 0;
}

/** `all` ou absent : tous les animaux ; sinon les identifiants listés. */
export function eatersOf(pets: readonly Pet[], forPets?: string): Pet[] {
  if (forPets === undefined || forPets === 'all' || forPets === '') {
    return [...pets];
  }
  const ids = forPets.split(',');
  return pets.filter(p => ids.includes(p.id));
}

/**
 * Eau potable bue par les animaux (L / jour) : ceux qui boivent l'eau
 * potable, et ceux de l'eau de pluie ou de cuve s'il n'y a pas de réserve
 * non potable.
 */
export function petsPotableWater(
  pets: readonly Pet[],
  hasRawWater: boolean,
): number {
  return pets
    .filter(p => p.waterSource === 'potable' || !hasRawWater)
    .reduce((sum, p) => sum + (petWater(p) ?? 0), 0);
}

/** Eau non potable bue par les animaux (L / jour). */
export function petsRawWater(
  pets: readonly Pet[],
  hasRawWater: boolean,
): number {
  return hasRawWater
    ? pets
        .filter(p => p.waterSource === 'raw')
        .reduce((sum, p) => sum + (petWater(p) ?? 0), 0)
    : 0;
}

const positive = (n: unknown, max: number): number | null =>
  typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= max ? n : null;

/** Lecture tolérante : un animal illisible est ignoré. */
export function parsePets(raw: unknown): Pet[] {
  if (typeof raw !== 'string' || raw === '') {
    return [];
  }
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((p: Record<string, unknown>): Pet[] => {
    if (
      typeof p !== 'object' ||
      p === null ||
      typeof p.id !== 'string' ||
      typeof p.name !== 'string' ||
      !PET_SPECIES.includes(p.species as PetSpecies)
    ) {
      return [];
    }
    return [
      {
        id: p.id,
        name: p.name.slice(0, 40),
        species: p.species as PetSpecies,
        weightKg: positive(p.weightKg, 200),
        kibbleG: positive(p.kibbleG, 10000) ?? 0,
        wetG: positive(p.wetG, 10000) ?? 0,
        waterL: positive(p.waterL, 50),
        waterSource: p.waterSource === 'raw' ? 'raw' : 'potable',
      },
    ];
  });
}

// Copie en mémoire, pour les écrans qui affichent des jours de nourriture
// sans relire la base (lignes de stock).
let current: Pet[] = [];

/** Derniers animaux lus ou enregistrés. */
export function knownPets(): readonly Pet[] {
  return current;
}

export async function loadPets(db: SqlDatabase): Promise<Pet[]> {
  const { rows } = await db.execute(
    'SELECT value FROM settings WHERE key = ?',
    [SETTING_KEY],
  );
  current = parsePets(rows[0]?.value);
  return current;
}

export async function savePets(
  db: SqlDatabase,
  pets: readonly Pet[],
): Promise<void> {
  const clean = parsePets(JSON.stringify(pets));
  await db.execute(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
    [SETTING_KEY, JSON.stringify(clean)],
  );
  current = clean;
}

/** Nouvel animal, sans ration (à renseigner). */
export function newPet(id: string, index: number): Pet {
  return {
    id,
    name: `Animal ${index}`,
    species: 'dog',
    weightKg: null,
    kibbleG: 0,
    wetG: 0,
    waterL: null,
    waterSource: 'potable',
  };
}

// « + Ajouter un animal » depuis une fiche de stock : Mon foyer s'ouvre sur
// la fiche d'un nouvel animal.
let addRequested = false;

export function requestNewPet(): void {
  addRequested = true;
}

/** Vrai une seule fois après `requestNewPet`. */
export function takeNewPetRequest(): boolean {
  const requested = addRequested;
  addRequested = false;
  return requested;
}
