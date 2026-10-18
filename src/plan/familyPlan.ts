/**
 * Plan familial de mise en sûreté (recommandé par Géorisques et le guide
 * « Tous responsables ») : qui appeler, où se retrouver, par où partir,
 * comment couper l'eau, le gaz et l'électricité, qui fait quoi.
 *
 * Gardé dans le coffre chiffré, consultable hors ligne et depuis l'écran
 * Urgence. Tous les champs sont facultatifs.
 */
import type { SqlDatabase } from '../db/types';
import { isIsoDate } from '../lib/dates';

export interface PlanContact {
  name: string;
  phone: string;
  /** Lien ou rôle (« voisine », « oncle à Lyon »…). */
  relation: string;
  /** Contact hors de la zone touchée, que chacun appelle pour donner des nouvelles. */
  outOfArea: boolean;
}

export interface MeetingPoint {
  /** Lieu (« parking de l'école », « chez Paul, 12 rue… »). */
  place: string;
  /** Position MGRS ou repère, facultatif. */
  position: string;
}

export interface FamilyPlan {
  contacts: PlanContact[];
  /** Point de regroupement près du domicile. */
  meetingNear: MeetingPoint;
  /** Point de regroupement hors du quartier. */
  meetingFar: MeetingPoint;
  /** Itinéraires d'évacuation. */
  routes: string;
  /** Emplacement des coupures. */
  shutoffWater: string;
  shutoffGas: string;
  shutoffPower: string;
  /** Qui récupère les enfants, les personnes âgées, les animaux… */
  roles: string;
  /** Dernier exercice, `AAAA-MM-JJ`. */
  lastDrill: string | null;
  notes: string;
}

export const CONTACTS_MAX = 12;
const TEXT_MAX = 500;
const SHORT_MAX = 120;

export function emptyPlan(): FamilyPlan {
  return {
    contacts: [],
    meetingNear: { place: '', position: '' },
    meetingFar: { place: '', position: '' },
    routes: '',
    shutoffWater: '',
    shutoffGas: '',
    shutoffPower: '',
    roles: '',
    lastDrill: null,
    notes: '',
  };
}

export class PlanError extends Error {
  readonly field: string;
  constructor(field: string, message: string) {
    super(message);
    this.name = 'PlanError';
    this.field = field;
  }
}

function clean(value: unknown, field: string, max: number): string {
  const text = typeof value === 'string' ? value.trim() : '';
  if (text.length > max) {
    throw new PlanError(field, `${max} caractères au maximum`);
  }
  return text;
}

function point(value: unknown, field: string): MeetingPoint {
  const v = (value ?? {}) as Partial<MeetingPoint>;
  return {
    place: clean(v.place, `${field}.place`, SHORT_MAX),
    position: clean(v.position, `${field}.position`, 60),
  };
}

/** Valide et nettoie un plan (textes coupés, contacts vides retirés). */
export function validatePlan(input: FamilyPlan): FamilyPlan {
  const contacts = (input.contacts ?? [])
    .map((c, i) => ({
      name: clean(c.name, `contacts.${i}.name`, 80),
      phone: clean(c.phone, `contacts.${i}.phone`, 30),
      relation: clean(c.relation, `contacts.${i}.relation`, 80),
      outOfArea: c.outOfArea === true,
    }))
    .filter(c => c.name !== '' || c.phone !== '');
  if (contacts.length > CONTACTS_MAX) {
    throw new PlanError('contacts', `${CONTACTS_MAX} contacts au maximum`);
  }
  contacts.forEach((c, i) => {
    if (c.phone !== '' && !/^[+0-9 ().-]{2,30}$/.test(c.phone)) {
      throw new PlanError(`contacts.${i}.phone`, 'Numéro invalide');
    }
  });
  const lastDrill =
    input.lastDrill === null || input.lastDrill === '' ? null : input.lastDrill;
  if (lastDrill !== null && !isIsoDate(lastDrill)) {
    throw new PlanError('lastDrill', 'Date invalide');
  }
  return {
    contacts,
    meetingNear: point(input.meetingNear, 'meetingNear'),
    meetingFar: point(input.meetingFar, 'meetingFar'),
    routes: clean(input.routes, 'routes', TEXT_MAX),
    shutoffWater: clean(input.shutoffWater, 'shutoffWater', SHORT_MAX),
    shutoffGas: clean(input.shutoffGas, 'shutoffGas', SHORT_MAX),
    shutoffPower: clean(input.shutoffPower, 'shutoffPower', SHORT_MAX),
    roles: clean(input.roles, 'roles', TEXT_MAX),
    lastDrill,
    notes: clean(input.notes, 'notes', TEXT_MAX),
  };
}

export async function loadFamilyPlan(db: SqlDatabase): Promise<FamilyPlan> {
  const { rows } = await db.execute(
    'SELECT data FROM family_plan WHERE id = 1',
  );
  if (rows.length === 0) {
    return emptyPlan();
  }
  try {
    return { ...emptyPlan(), ...JSON.parse(String(rows[0].data)) };
  } catch {
    return emptyPlan();
  }
}

export async function saveFamilyPlan(
  db: SqlDatabase,
  plan: FamilyPlan,
): Promise<FamilyPlan> {
  const valid = validatePlan(plan);
  await db.execute(
    `INSERT INTO family_plan (id, data) VALUES (1, ?)
     ON CONFLICT (id) DO UPDATE SET data = excluded.data,
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
    [JSON.stringify(valid)],
  );
  return valid;
}

/** Le plan contient-il quelque chose d'utile ? */
export function isPlanEmpty(plan: FamilyPlan): boolean {
  return (
    plan.contacts.length === 0 &&
    plan.meetingNear.place === '' &&
    plan.meetingFar.place === '' &&
    plan.routes === '' &&
    plan.shutoffWater === '' &&
    plan.shutoffGas === '' &&
    plan.shutoffPower === '' &&
    plan.roles === ''
  );
}
