/**
 * Dates calendaires `AAAA-MM-JJ`, sans heure ni fuseau : les écarts en jours
 * ne dépendent ni de l'heure d'été ni du fuseau de l'appareil.
 */

export class DateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DateError';
  }
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 86_400_000;

/** Numéro de jour (entier) d'une date `AAAA-MM-JJ` ; lève si la date est invalide. */
export function dayNumber(date: string): number {
  const match = ISO_DATE.exec(date);
  if (match === null) {
    throw new DateError(`Date invalide : ${date}`);
  }
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const ms = Date.UTC(y, m - 1, d);
  const check = new Date(ms);
  if (check.getUTCMonth() !== m - 1 || check.getUTCDate() !== d) {
    throw new DateError(`Date inexistante : ${date}`);
  }
  return ms / DAY_MS;
}

export function assertIsoDate(date: string): void {
  dayNumber(date);
}

export function isIsoDate(date: string): boolean {
  try {
    dayNumber(date);
    return true;
  } catch {
    return false;
  }
}

function fromDayNumber(day: number): string {
  return new Date(day * DAY_MS).toISOString().slice(0, 10);
}

export function addDays(date: string, days: number): string {
  return fromDayNumber(dayNumber(date) + days);
}

export function daysBetween(from: string, to: string): number {
  return dayNumber(to) - dayNumber(from);
}

/** Date locale du jour au format `AAAA-MM-JJ`. */
export function localToday(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(
    now.getDate(),
  )}`;
}

const FR_DATE = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;

/** `JJ/MM/AAAA` → `AAAA-MM-JJ`, ou null si la saisie n'est pas une date. */
export function frToIso(text: string): string | null {
  const match = FR_DATE.exec(text.trim());
  if (match === null) {
    return null;
  }
  const iso = `${match[3]}-${match[2].padStart(2, '0')}-${match[1].padStart(
    2,
    '0',
  )}`;
  return isIsoDate(iso) ? iso : null;
}

/** `AAAA-MM-JJ` → `JJ/MM/AAAA`. */
export function isoToFr(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}
