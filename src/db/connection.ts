import { migrate, type MigrationReport } from './migrate';
import type { SqlDatabase } from './types';

/**
 * À appeler sur chaque connexion juste après le déverrouillage, avant toute
 * requête métier. Les PRAGMA ci-dessous ne sont pas persistants : ils
 * doivent être réappliqués à chaque ouverture.
 */
export async function prepareDatabase(
  db: SqlDatabase,
): Promise<MigrationReport> {
  // Sans cela, SQLite ignore les REFERENCES et les ON DELETE CASCADE.
  await db.execute('PRAGMA foreign_keys = ON');
  // Les tables temporaires (tris, index transitoires) restent en mémoire et
  // ne sont jamais écrites en clair sur le disque.
  await db.execute('PRAGMA temp_store = MEMORY');
  return migrate(db);
}
