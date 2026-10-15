import type { SqlDatabase } from './types';

/**
 * Exécute `work` dans une transaction : tout est validé, ou rien.
 * `BEGIN IMMEDIATE` prend le verrou d'écriture dès le début, ce qui évite
 * qu'une autre écriture s'intercale entre une lecture et la mise à jour qui
 * en dépend. Les transactions imbriquées ne sont pas prises en charge.
 */
export async function withTransaction<T>(
  db: SqlDatabase,
  work: () => Promise<T>,
): Promise<T> {
  await db.execute('BEGIN IMMEDIATE');
  try {
    const result = await work();
    await db.execute('COMMIT');
    return result;
  } catch (error) {
    await db.execute('ROLLBACK').catch(() => undefined);
    throw error;
  }
}
