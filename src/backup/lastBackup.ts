/**
 * Date de la dernière sauvegarde faite sur ce téléphone, pour la rappeler
 * dans Réglages et sur l'Accueil. Propre à l'appareil : elle n'est pas
 * partagée avec le second téléphone du foyer.
 */
import type { SqlDatabase } from '../db/types';
import { daysBetween, localToday } from '../lib/dates';

const SETTING_KEY = 'last_backup_date';

/** Au-delà, l'Accueil rappelle de sauvegarder. */
export const BACKUP_REMIND_DAYS = 30;

export interface BackupStatus {
  /** Date `AAAA-MM-JJ` de la dernière sauvegarde, ou null. */
  last: string | null;
  /** Jours depuis la dernière sauvegarde, ou null s'il n'y en a pas. */
  daysSince: number | null;
  /**
   * Rappel à afficher : plus de 30 jours depuis la dernière sauvegarde,
   * ou, sans sauvegarde, depuis le premier article saisi (rien à
   * rappeler sur un coffre neuf).
   */
  due: boolean;
}

export async function loadLastBackup(db: SqlDatabase): Promise<string | null> {
  const { rows } = await db.execute(
    'SELECT value FROM settings WHERE key = ?',
    [SETTING_KEY],
  );
  const value = rows[0]?.value;
  return typeof value === 'string' && value !== '' ? value : null;
}

export async function saveLastBackup(
  db: SqlDatabase,
  date: string = localToday(),
): Promise<void> {
  await db.execute(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
    [SETTING_KEY, date],
  );
}

export async function getBackupStatus(
  db: SqlDatabase,
  today: string = localToday(),
): Promise<BackupStatus> {
  const last = await loadLastBackup(db);
  let since = last;
  if (since === null) {
    const { rows } = await db.execute(
      'SELECT MIN(substr(created_at, 1, 10)) AS first FROM inventory_items',
    );
    const first = rows[0]?.first;
    since = typeof first === 'string' ? first : null;
  }
  const age = since === null ? null : daysBetween(since, today);
  return {
    last,
    daysSince: last === null ? null : daysBetween(last, today),
    due: age !== null && age >= BACKUP_REMIND_DAYS,
  };
}

/** « aujourd'hui », « hier », « il y a 47 jours ». */
export function backupAge(days: number): string {
  if (days <= 0) {
    return 'aujourd’hui';
  }
  return days === 1 ? 'hier' : `il y a ${days} jours`;
}
