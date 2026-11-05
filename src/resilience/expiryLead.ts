/**
 * Seuil d'alerte de péremption par défaut : combien de jours avant la date
 * un lot passe « Bientôt périmé » dans les Stocks et déclenche un rappel.
 * Le seuil propre à un article (fiche › alerte) reste prioritaire.
 *
 * Réglage propre au téléphone : il n'est pas partagé avec le foyer.
 */
import type { SqlDatabase } from '../db/types';

/** Valeur historique, gardée par défaut. */
export const DEFAULT_EXPIRY_LEAD_DAYS = 30;
export const EXPIRY_LEAD_CHOICES = [15, 30, 60, 90] as const;

const SETTING_KEY = 'expiry_lead_days';

export async function loadExpiryLead(db: SqlDatabase): Promise<number> {
  const { rows } = await db.execute(
    'SELECT value FROM settings WHERE key = ?',
    [SETTING_KEY],
  );
  const value = Number(rows[0]?.value);
  return (EXPIRY_LEAD_CHOICES as readonly number[]).includes(value)
    ? value
    : DEFAULT_EXPIRY_LEAD_DAYS;
}

export async function saveExpiryLead(
  db: SqlDatabase,
  days: number,
): Promise<void> {
  if (!(EXPIRY_LEAD_CHOICES as readonly number[]).includes(days)) {
    throw new RangeError(`Seuil non proposé : ${days}`);
  }
  await db.execute(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
    [SETTING_KEY, String(days)],
  );
}
