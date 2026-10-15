/**
 * Base documentaire : synchronisation des fiches Markdown embarquées dans
 * l'application et recherche plein texte (FTS5).
 */
import { sha256 } from '@noble/hashes/sha2';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils';

import type { SqlDatabase } from './types';

export interface BundledGuide {
  slug: string;
  title: string;
  category: string;
  /** Contenu Markdown. */
  body: string;
}

export interface GuideSearchHit {
  id: number;
  slug: string;
  title: string;
  category: string;
  /** Extrait autour des termes trouvés, termes encadrés par [ et ]. */
  snippet: string;
}

export interface GuideSyncReport {
  inserted: number;
  updated: number;
  removed: number;
}

function hashGuide(guide: BundledGuide): string {
  return bytesToHex(
    sha256(
      utf8ToBytes(`${guide.title}\u0000${guide.category}\u0000${guide.body}`),
    ),
  );
}

/**
 * Aligne la table `survival_guides` sur les fiches embarquées : insère les
 * nouvelles, met à jour celles dont le contenu a changé, supprime celles qui
 * ont disparu. Les index FTS5 suivent via les triggers.
 */
export async function syncGuides(
  db: SqlDatabase,
  guides: readonly BundledGuide[],
): Promise<GuideSyncReport> {
  const slugs = new Set<string>();
  for (const guide of guides) {
    if (slugs.has(guide.slug)) {
      throw new Error(`Fiche en double : ${guide.slug}`);
    }
    slugs.add(guide.slug);
  }

  const { rows } = await db.execute(
    'SELECT slug, content_hash FROM survival_guides',
  );
  const existing = new Map(
    rows.map(row => [String(row.slug), String(row.content_hash)]),
  );
  const report: GuideSyncReport = { inserted: 0, updated: 0, removed: 0 };

  await db.execute('BEGIN IMMEDIATE');
  try {
    for (const guide of guides) {
      const hash = hashGuide(guide);
      const current = existing.get(guide.slug);
      if (current === hash) {
        continue;
      }
      if (current === undefined) {
        await db.execute(
          `INSERT INTO survival_guides (slug, title, category, body, content_hash)
           VALUES (?, ?, ?, ?, ?)`,
          [guide.slug, guide.title, guide.category, guide.body, hash],
        );
        report.inserted++;
      } else {
        await db.execute(
          `UPDATE survival_guides
              SET title = ?, category = ?, body = ?, content_hash = ?,
                  updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
            WHERE slug = ?`,
          [guide.title, guide.category, guide.body, hash, guide.slug],
        );
        report.updated++;
      }
    }
    for (const slug of existing.keys()) {
      if (!slugs.has(slug)) {
        await db.execute('DELETE FROM survival_guides WHERE slug = ?', [slug]);
        report.removed++;
      }
    }
    await db.execute('COMMIT');
  } catch (error) {
    await db.execute('ROLLBACK').catch(() => undefined);
    throw error;
  }
  return report;
}

/**
 * Transforme une saisie libre en requête FTS5 sûre. La syntaxe FTS5
 * (guillemets, NEAR, AND, -, *, :) provoquerait sinon des erreurs ou des
 * résultats inattendus. Chaque mot devient un préfixe entre guillemets, et
 * les mots sont combinés en ET implicite.
 *
 * « filtre à eau » → "filtre"* "à"* "eau"*
 */
export function toFtsQuery(input: string): string | null {
  const terms = input.normalize('NFC').match(/[\p{L}\p{N}]+/gu) ?? [];
  if (terms.length === 0) {
    return null;
  }
  return terms
    .slice(0, 16)
    .map(term => `"${term}"*`)
    .join(' ');
}

export async function searchGuides(
  db: SqlDatabase,
  input: string,
  limit = 20,
): Promise<GuideSearchHit[]> {
  const query = toFtsQuery(input);
  if (query === null) {
    return [];
  }
  // bm25 : le titre pèse 5 fois plus que le corps.
  const { rows } = await db.execute(
    `SELECT g.id, g.slug, g.title, g.category,
            snippet(survival_guides_fts, 1, '[', ']', '…', 12) AS snippet
       FROM survival_guides_fts
       JOIN survival_guides AS g ON g.id = survival_guides_fts.rowid
      WHERE survival_guides_fts MATCH ?
      ORDER BY bm25(survival_guides_fts, 5.0, 1.0)
      LIMIT ?`,
    [query, limit],
  );
  return rows.map(row => ({
    id: Number(row.id),
    slug: String(row.slug),
    title: String(row.title),
    category: String(row.category),
    snippet: String(row.snippet),
  }));
}
