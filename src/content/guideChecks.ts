/**
 * Listes de contrôle des fiches du guide (lignes « ☐ ») : cases cochées et
 * date de chaque coche, conservées dans le coffre avec les marques de la
 * préparation par paliers (portée « guide:<fiche> »).
 */
import type { SqlDatabase } from '../db/types';

export const CHECK_PREFIX = '☐ ';

const scopeOf = (slug: string) => `guide:${slug}`.slice(0, 64);

/** Identifiant stable d'une ligne : son texte simplifié, 40 caractères au plus. */
export function checkId(label: string): string {
  return (
    label
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40) || 'case'
  );
}

/** Cases cochées d'une fiche, avec la date de la coche (ISO). */
export async function loadGuideChecks(
  db: SqlDatabase,
  slug: string,
): Promise<Map<string, string>> {
  const { rows } = await db.execute(
    'SELECT item, checked_at FROM preparation_marks WHERE scope = ?',
    [scopeOf(slug)],
  );
  return new Map(rows.map(r => [String(r.item), String(r.checked_at)]));
}

export async function setGuideCheck(
  db: SqlDatabase,
  slug: string,
  id: string,
  checked: boolean,
): Promise<void> {
  if (checked) {
    await db.execute(
      'INSERT OR IGNORE INTO preparation_marks (scope, item) VALUES (?, ?)',
      [scopeOf(slug), id],
    );
  } else {
    await db.execute(
      'DELETE FROM preparation_marks WHERE scope = ? AND item = ?',
      [scopeOf(slug), id],
    );
  }
}

/** Nouveau contrôle : toutes les cases de la fiche sont décochées. */
export async function clearGuideChecks(
  db: SqlDatabase,
  slug: string,
): Promise<void> {
  await db.execute('DELETE FROM preparation_marks WHERE scope = ?', [
    scopeOf(slug),
  ]);
}
