/**
 * Fusion des lignes reçues d'un autre téléphone. Fonction pure : elle
 * décide, `store.ts` écrit dans la base (dans une seule transaction).
 *
 * Règles :
 * - Une ligne est identifiée par sa table et son UUID (ou sa clé) : jamais
 *   de doublon, la ligne existante est mise à jour.
 * - La version la plus récente gagne, selon l'horloge logique hybride
 *   (`hlc`), suppressions comprises (pierre tombale).
 * - Exception pour la quantité des lots : si les deux téléphones partent de
 *   la même base, les variations s'additionnent (2 L bus ici + 3 L là-bas =
 *   5 L de moins). Un lot supprimé compte pour 0 ; à 0 ou moins, il est
 *   supprimé.
 *
 * Les deux téléphones appliquent les mêmes règles aux mêmes données : ils
 * aboutissent au même résultat sans avoir à se renvoyer la fusion.
 */
import type { SqlValue } from '../db/types';

export interface SyncRow {
  table: string;
  key: string;
  hlc: string;
  deleted: boolean;
  /** Ligne du volet armes. */
  weapon: boolean;
  /** Lots : quantité au dernier échange (null : jamais échangée). */
  base: number | null;
  /** Contenu de la ligne ; null pour une suppression. */
  data: Record<string, SqlValue> | null;
}

export interface MergePlan {
  /** Lignes à créer ou mettre à jour, avec leur version finale. */
  write: SyncRow[];
  /** Lignes à supprimer (et pierres tombales à garder). */
  remove: SyncRow[];
  /** Lots inchangés dont seule la base d'échange est à mettre à jour. */
  settle: SyncRow[];
  /** Lots modifiés des deux côtés : variations additionnées. */
  summed: number;
}

const LOTS = 'inventory_lots';
const EPSILON = 1e-9;

export function rowId(table: string, key: string): string {
  return `${table}\u0000${key}`;
}

function quantityOf(row: SyncRow): number {
  if (row.deleted || row.data === null) {
    return 0;
  }
  const q = row.data.quantity;
  return typeof q === 'number' && Number.isFinite(q) ? q : 0;
}

/** Arrondi au millionième : évite 0,30000000000000004 L. */
function round(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

function sameBase(a: number | null, b: number | null): a is number {
  return a !== null && b !== null && Math.abs(a - b) < EPSILON;
}

export function mergeSyncData(
  local: ReadonlyMap<string, SyncRow>,
  remote: readonly SyncRow[],
): MergePlan {
  const plan: MergePlan = { write: [], remove: [], settle: [], summed: 0 };

  // Une seule entrée par ligne distante : la plus récente.
  const incoming = new Map<string, SyncRow>();
  for (const r of remote) {
    const id = rowId(r.table, r.key);
    const seen = incoming.get(id);
    if (!seen || r.hlc > seen.hlc) {
      incoming.set(id, r);
    }
  }

  for (const [id, r] of incoming) {
    const l = local.get(id);
    const isLot = r.table === LOTS;

    if (!l) {
      if (r.deleted) {
        plan.remove.push({ ...r, data: null });
      } else {
        plan.write.push({ ...r, base: isLot ? quantityOf(r) : null });
      }
      continue;
    }

    if (l.hlc === r.hlc) {
      if (isLot && !l.deleted && !sameBase(l.base, quantityOf(l))) {
        plan.settle.push({ ...l, base: quantityOf(l) });
      }
      continue;
    }

    const remoteWins = r.hlc > l.hlc;
    const winner = remoteWins ? r : l;
    const hlc = winner.hlc;
    const weapon = l.weapon || r.weapon;

    if (isLot && sameBase(l.base, r.base)) {
      const base = l.base as number;
      const localQ = quantityOf(l);
      const remoteQ = quantityOf(r);
      const q = round(localQ + remoteQ - base);
      if (
        Math.abs(localQ - base) > EPSILON &&
        Math.abs(remoteQ - base) > EPSILON
      ) {
        plan.summed += 1;
      }
      if (q <= EPSILON) {
        plan.remove.push({
          ...winner,
          hlc,
          weapon,
          deleted: true,
          data: null,
          base: 0,
        });
      } else {
        const data = winner.data ?? (remoteWins ? l.data : r.data);
        if (data) {
          plan.write.push({
            ...winner,
            hlc,
            weapon,
            deleted: false,
            base: q,
            data: { ...data, quantity: q },
          });
        }
      }
      continue;
    }

    if (!remoteWins) {
      // La version locale est plus récente : l'autre téléphone l'adoptera.
      continue;
    }
    if (r.deleted || r.data === null) {
      plan.remove.push({ ...r, weapon, deleted: true, data: null });
    } else {
      plan.write.push({ ...r, weapon, base: isLot ? quantityOf(r) : null });
    }
  }
  return plan;
}
