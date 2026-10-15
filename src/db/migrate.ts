/**
 * Application des migrations au démarrage, après déverrouillage.
 *
 * La version du schéma est stockée dans `PRAGMA user_version` (en-tête du
 * fichier, chiffré par SQLCipher). Chaque migration s'exécute dans sa propre
 * transaction avec la mise à jour de `user_version` : une migration
 * interrompue est entièrement annulée.
 */
import { MIGRATIONS, type Migration } from './schema';
import type { SqlDatabase } from './types';

export type MigrationErrorCode =
  /** La base a été créée par une version plus récente de l'application. */
  | 'DATABASE_TOO_NEW'
  /** Une instruction a échoué ; la migration a été annulée. */
  | 'MIGRATION_FAILED'
  /** La liste des migrations est incohérente (erreur de développement). */
  | 'INVALID_MIGRATIONS';

export class MigrationError extends Error {
  readonly code: MigrationErrorCode;
  readonly version?: number;

  constructor(
    code: MigrationErrorCode,
    message: string,
    options?: { version?: number; cause?: unknown },
  ) {
    super(message);
    this.name = 'MigrationError';
    this.code = code;
    this.version = options?.version;
    if (options?.cause !== undefined) {
      (this as { cause?: unknown }).cause = options.cause;
    }
  }
}

export interface MigrationReport {
  from: number;
  to: number;
}

function assertWellFormed(migrations: readonly Migration[]): void {
  migrations.forEach((migration, index) => {
    if (migration.version !== index + 1) {
      throw new MigrationError(
        'INVALID_MIGRATIONS',
        `Migration en position ${index} : version ${
          migration.version
        } au lieu de ${index + 1}`,
      );
    }
  });
}

export async function getSchemaVersion(db: SqlDatabase): Promise<number> {
  const { rows } = await db.execute('PRAGMA user_version');
  const version = rows[0]?.user_version;
  if (typeof version !== 'number' || !Number.isInteger(version)) {
    throw new MigrationError('MIGRATION_FAILED', 'Version du schéma illisible');
  }
  return version;
}

export async function migrate(
  db: SqlDatabase,
  migrations: readonly Migration[] = MIGRATIONS,
): Promise<MigrationReport> {
  assertWellFormed(migrations);
  const latest = migrations.length;
  const from = await getSchemaVersion(db);

  if (from > latest) {
    throw new MigrationError(
      'DATABASE_TOO_NEW',
      `Base en version ${from}, application en version ${latest} : mettre à jour l'application`,
      { version: from },
    );
  }

  for (const migration of migrations.slice(from)) {
    await db.execute('BEGIN IMMEDIATE');
    try {
      for (const statement of migration.statements) {
        await db.execute(statement);
      }
      // PRAGMA n'accepte pas de paramètre lié ; la valeur est un entier contrôlé.
      await db.execute(`PRAGMA user_version = ${migration.version}`);
      await db.execute('COMMIT');
    } catch (cause) {
      await db.execute('ROLLBACK').catch(() => undefined);
      throw new MigrationError(
        'MIGRATION_FAILED',
        `Échec de la migration ${migration.version} (${migration.name})`,
        { version: migration.version, cause },
      );
    }
  }

  return { from, to: latest };
}
