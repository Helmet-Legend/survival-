/**
 * Rappels de péremption sur le téléphone, même application fermée.
 *
 * Le coffre est chiffré et fermé quand l'application ne tourne pas : les
 * rappels sont donc calculés à l'ouverture et à la fermeture du coffre, puis
 * confiés au système sous forme de simples horaires. Le texte affiché est
 * neutre (« Un rappel vous attend »), sans nom d'article ni quantité : rien
 * ne fuit sur l'écran de verrouillage.
 *
 * Pour chaque lot daté : un rappel quand il entre dans son seuil d'alerte
 * (le seuil de l'article, 30 jours par défaut), puis le jour de sa
 * péremption. Sacs d'évacuation compris. S'y ajoute, si un plan d'achats
 * existe, le 1er de chaque mois qui a encore des achats prévus, et un
 * rappel de sauvegarde 30 jours après la dernière (puis chaque semaine tant
 * qu'elle n'est pas refaite).
 */
import { BACKUP_REMIND_DAYS, backupReference } from '../backup/lastBackup';
import type { SqlDatabase } from '../db/types';
import { addDays, daysBetween, localToday } from '../lib/dates';
import { loadPurchasePlan, monthlyReminderDays } from '../plan/purchasePlan';
import { DEFAULT_EXPIRY_LEAD_DAYS, loadExpiryLead } from './expiryLead';

/** Seuil d'alerte par défaut (réglable : voir `expiryLead.ts`). */
export const REMINDER_LEAD_DAYS = DEFAULT_EXPIRY_LEAD_DAYS;
/** Sauvegarde en retard : rappel répété tous les 7 jours. */
export const BACKUP_REPEAT_DAYS = 7;
/** Heure locale des rappels. */
export const REMINDER_HOUR = 9;
/** Le système limite les alarmes par application : on garde les prochaines. */
export const REMINDER_MAX = 30;

const SETTING_KEY = 'reminders_enabled';

/** Service du téléphone qui affiche les rappels (module natif Android). */
export interface ReminderScheduler {
  available: boolean;
  /** Demande l'autorisation d'afficher des notifications ; true si accordée. */
  requestPermission(): Promise<boolean>;
  /** Remplace tous les rappels prévus par ces horaires (ms depuis 1970). */
  schedule(times: readonly number[]): Promise<void>;
  cancelAll(): Promise<void>;
}

export async function loadRemindersEnabled(db: SqlDatabase): Promise<boolean> {
  const { rows } = await db.execute(
    'SELECT value FROM settings WHERE key = ?',
    [SETTING_KEY],
  );
  return rows[0]?.value === '1';
}

export async function saveRemindersEnabled(
  db: SqlDatabase,
  enabled: boolean,
): Promise<void> {
  await db.execute(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
    [SETTING_KEY, enabled ? '1' : '0'],
  );
}

/** `AAAA-MM-JJ` à l'heure des rappels, en heure locale. */
function atReminderHour(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d, REMINDER_HOUR, 0, 0, 0).getTime();
}

/** Horaires des prochains rappels, triés, sans doublon. */
export async function reminderTimes(
  db: SqlDatabase,
  now: Date = new Date(),
): Promise<number[]> {
  const today = localToday(now);
  const { rows } = await db.execute(
    `SELECT l.expiration_date, i.alert_days
       FROM inventory_lots AS l
       JOIN inventory_items AS i ON i.id = l.item_id
      WHERE l.quantity > 0 AND l.expiration_date >= ?`,
    [today],
  );
  const defaultLead = await loadExpiryLead(db);
  const times = new Set<number>();
  for (const r of rows) {
    const expiry = String(r.expiration_date);
    const lead = r.alert_days === null ? defaultLead : Number(r.alert_days);
    for (const day of [addDays(expiry, -lead), expiry]) {
      if (day >= today) {
        times.add(atReminderHour(day));
      }
    }
  }
  const plan = await loadPurchasePlan(db);
  for (const day of plan === null ? [] : monthlyReminderDays(plan)) {
    times.add(atReminderHour(day));
  }
  const backup = await backupReminderDay(db, now);
  if (backup !== null) {
    times.add(atReminderHour(backup));
  }
  return [...times]
    .filter(t => t > now.getTime())
    .sort((a, b) => a - b)
    .slice(0, REMINDER_MAX);
}

/**
 * Jour du prochain rappel de sauvegarde : 30 jours après la dernière (ou
 * après le premier article saisi), puis tous les 7 jours si elle tarde.
 * Null sur un coffre neuf.
 */
export async function backupReminderDay(
  db: SqlDatabase,
  now: Date = new Date(),
): Promise<string | null> {
  const { since } = await backupReference(db);
  if (since === null) {
    return null;
  }
  const today = localToday(now);
  let day = addDays(since, BACKUP_REMIND_DAYS);
  if (day < today) {
    const late = daysBetween(day, today);
    day = addDays(
      day,
      Math.ceil(late / BACKUP_REPEAT_DAYS) * BACKUP_REPEAT_DAYS,
    );
  }
  if (atReminderHour(day) <= now.getTime()) {
    day = addDays(day, BACKUP_REPEAT_DAYS);
  }
  return day;
}

/** Met les rappels du téléphone en accord avec le coffre ouvert. */
export async function syncReminders(
  db: SqlDatabase,
  scheduler: ReminderScheduler,
  now: Date = new Date(),
): Promise<void> {
  if (!scheduler.available) {
    return;
  }
  if (await loadRemindersEnabled(db)) {
    await scheduler.schedule(await reminderTimes(db, now));
  } else {
    await scheduler.cancelAll();
  }
}
