/**
 * Synchronisation dans la base : horodatage des modifications locales,
 * export des lignes à envoyer, application des lignes reçues.
 *
 * Tout se passe dans le téléphone, sans serveur. L'application d'un envoi
 * reçu est une seule transaction : en cas d'erreur, rien n'est modifié.
 * Les requêtes travaillent par paquets pour rester rapides sur des bases de
 * plusieurs milliers de lignes.
 */
import { withTransaction } from '../db/transaction';
import type { SqlDatabase, SqlValue } from '../db/types';
import { GEAR_SCOPE, GEAR_SECTIONS, SHOW_WEAPONS_MARK } from '../plan/baseGear';
import { decodeHlc, encodeHlc, isHlc, receive, tick, type Hlc } from './hlc';
import { mergeSyncData, rowId, type SyncRow } from './merge';
import {
  keyValues,
  SHARED_SETTINGS,
  SHARED_TABLES,
  sharedTable,
  type SharedTable,
} from './tables';

export const SYNC_FORMAT = 1;

/** Options de partage choisies par le foyer. */
export interface SyncOptions {
  weapons: boolean;
  photos: boolean;
}

export interface SyncPayload {
  format: number;
  /** Identifiant du téléphone expéditeur. */
  device: string;
  /** Son horloge au moment de l'export : couvre toutes les lignes envoyées. */
  clock: string;
  rows: SyncRow[];
}

export interface SyncReport {
  received: number;
  written: number;
  removed: number;
  /** Lots consommés des deux côtés : variations additionnées. */
  summed: number;
  /** Lignes écartées (option non partagée, parent supprimé…). */
  skipped: number;
}

export type SyncErrorCode =
  | 'INVALID_PAYLOAD'
  | 'UNSUPPORTED_FORMAT'
  | 'CLOCK_AHEAD'
  | 'SAME_DEVICE';

export class SyncError extends Error {
  constructor(readonly code: SyncErrorCode, message: string) {
    super(message);
    this.name = 'SyncError';
  }
}

/** Paramètres par requête : sous la limite historique de SQLite (999). */
const MAX_PARAMS = 900;
const KEY_CHUNK = 400;
/** Une horloge distante plus d'un jour en avance est refusée. */
const MAX_AHEAD_MS = 24 * 3600 * 1000;
const COLUMN_NAME = /^[a-z_][a-z0-9_]*$/;

const WEAPON_MARKS: ReadonlySet<string> = new Set([
  SHOW_WEAPONS_MARK,
  ...GEAR_SECTIONS.filter(s => s.weapons).flatMap(s => s.items.map(i => i.id)),
]);

function chunks<T>(list: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) {
    out.push(list.slice(i, i + size));
  }
  return out;
}

function placeholders(n: number): string {
  return Array.from({ length: n }, () => '?').join(', ');
}

/** Expression SQL de la clé texte (identique à celle des triggers). */
function keySql(table: SharedTable): string {
  if (table.name === 'family_plan') {
    return 'CAST(id AS TEXT)';
  }
  return table.keys.join(' || char(31) || ');
}

// --- Métadonnées --------------------------------------------------------

async function getMeta(db: SqlDatabase, key: string): Promise<string | null> {
  const { rows } = await db.execute(
    'SELECT value FROM sync_meta WHERE key = ?',
    [key],
  );
  return rows.length > 0 ? String(rows[0].value) : null;
}

async function setMeta(db: SqlDatabase, key: string, value: string) {
  await db.execute(
    `INSERT INTO sync_meta (key, value) VALUES (?, ?)
     ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
    [key, value],
  );
}

export async function getDeviceId(db: SqlDatabase): Promise<string> {
  const id = await getMeta(db, 'device_id');
  if (id === null) {
    throw new Error('Identifiant de synchronisation absent');
  }
  return id;
}

async function getClock(db: SqlDatabase): Promise<Hlc | null> {
  const text = await getMeta(db, 'clock');
  return text === null ? null : decodeHlc(text);
}

/** Horloge reçue du téléphone `device` lors du dernier échange réussi. */
export async function getPeerClock(
  db: SqlDatabase,
  device: string,
): Promise<string | null> {
  return getMeta(db, `peer_clock:${device}`);
}

/** Nombre de modifications locales pas encore envoyées. */
export async function countPendingChanges(db: SqlDatabase): Promise<number> {
  const { rows } = await db.execute(
    'SELECT count(*) AS n FROM sync_rows WHERE hlc IS NULL',
  );
  return Number(rows[0]?.n ?? 0);
}

// --- Horodatage ---------------------------------------------------------

/**
 * Attribue un horodatage aux lignes modifiées ici depuis le dernier échange,
 * dans l'ordre des modifications. À appeler dans une transaction.
 */
async function stamp(db: SqlDatabase, now: number): Promise<number> {
  const node = await getDeviceId(db);
  const { rows } = await db.execute(
    `SELECT tbl, key, dirty_at FROM sync_rows
      WHERE hlc IS NULL ORDER BY dirty_at, tbl, key`,
  );
  if (rows.length === 0) {
    return 0;
  }
  let clock = await getClock(db);
  const stamped: SqlValue[][] = [];
  for (const row of rows) {
    const parsed = Date.parse(String(row.dirty_at ?? ''));
    clock = tick(clock, Number.isFinite(parsed) ? parsed : now, node);
    const table = String(row.tbl);
    const key = String(row.key);
    const weapon = table === 'preparation_marks' && isWeaponMark(key) ? 1 : 0;
    stamped.push([table, key, encodeHlc(clock), weapon]);
  }
  for (const part of chunks(stamped, Math.floor(MAX_PARAMS / 4))) {
    await db.execute(
      `INSERT INTO sync_rows (tbl, key, hlc, is_weapon)
       VALUES ${part.map(() => '(?, ?, ?, ?)').join(', ')}
       ON CONFLICT (tbl, key) DO UPDATE
          SET hlc = excluded.hlc, dirty_at = NULL,
              is_weapon = max(is_weapon, excluded.is_weapon)`,
      part.flat(),
    );
  }
  if (clock) {
    await setMeta(db, 'clock', encodeHlc(clock));
  }
  return rows.length;
}

function isWeaponMark(key: string): boolean {
  const [scope, item] = key.split('\u001f');
  return (
    (scope === GEAR_SCOPE || scope === 'home') &&
    item !== undefined &&
    WEAPON_MARKS.has(item)
  );
}

export async function stampLocalChanges(
  db: SqlDatabase,
  now: number = Date.now(),
): Promise<number> {
  return withTransaction(db, () => stamp(db, now));
}

// --- Lecture des lignes ---------------------------------------------------

function toSqlValue(value: unknown): SqlValue {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === 'number' || typeof value === 'string') {
    return value;
  }
  if (typeof value === 'bigint') {
    return Number(value);
  }
  return String(value);
}

/** Contenu des lignes `keys` de `table`, par clé texte. */
async function loadRows(
  db: SqlDatabase,
  table: SharedTable,
  keys: readonly string[],
): Promise<Map<string, Record<string, SqlValue>>> {
  const out = new Map<string, Record<string, SqlValue>>();
  for (const part of chunks(keys, KEY_CHUNK)) {
    const { rows } = await db.execute(
      `SELECT ${keySql(table)} AS sync_key, * FROM ${table.name}
        WHERE ${keySql(table)} IN (${placeholders(part.length)})`,
      part,
    );
    for (const row of rows) {
      const data: Record<string, SqlValue> = {};
      for (const [column, value] of Object.entries(row)) {
        if (column !== 'sync_key') {
          data[column] = toSqlValue(value);
        }
      }
      out.set(String(row.sync_key), data);
    }
  }
  return out;
}

interface MetaRow {
  tbl: string;
  key: string;
  hlc: string | null;
  deleted: boolean;
  weapon: boolean;
  base: number | null;
}

function toMeta(row: Record<string, unknown>): MetaRow {
  return {
    tbl: String(row.tbl),
    key: String(row.key),
    hlc: row.hlc === null || row.hlc === undefined ? null : String(row.hlc),
    deleted: row.deleted === 1,
    weapon: row.is_weapon === 1,
    base: typeof row.base === 'number' ? row.base : null,
  };
}

function allowed(
  table: string,
  weapon: boolean,
  options: SyncOptions,
): boolean {
  return (
    sharedTable(table) !== undefined &&
    (options.weapons || !weapon) &&
    (options.photos || table !== 'photos')
  );
}

/** Complète des métadonnées avec le contenu des lignes. */
async function withData(
  db: SqlDatabase,
  metas: readonly MetaRow[],
  tables: (table: string) => boolean = () => true,
): Promise<SyncRow[]> {
  const byTable = new Map<string, MetaRow[]>();
  for (const m of metas) {
    const list = byTable.get(m.tbl);
    if (list) {
      list.push(m);
    } else {
      byTable.set(m.tbl, [m]);
    }
  }
  const out: SyncRow[] = [];
  for (const table of SHARED_TABLES) {
    const list = byTable.get(table.name);
    if (!list) {
      continue;
    }
    const data = tables(table.name)
      ? await loadRows(
          db,
          table,
          list.filter(m => !m.deleted).map(m => m.key),
        )
      : new Map<string, Record<string, SqlValue>>();
    for (const m of list) {
      if (m.hlc === null) {
        continue;
      }
      const row = m.deleted ? null : data.get(m.key) ?? null;
      out.push({
        table: m.tbl,
        key: m.key,
        hlc: m.hlc,
        // Ligne absente alors que non supprimée : traitée comme supprimée.
        deleted: m.deleted || (tables(table.name) && row === null),
        weapon: m.weapon,
        base: m.base,
        data: row,
      });
    }
  }
  return out;
}

// --- Export ---------------------------------------------------------------

/**
 * Lignes à envoyer à l'autre téléphone : celles modifiées après `since`
 * (son dernier relevé de notre horloge ; null = tout), selon les options.
 */
export async function exportChanges(
  db: SqlDatabase,
  options: SyncOptions,
  since: string | null = null,
  now: number = Date.now(),
): Promise<SyncPayload> {
  return withTransaction(db, async () => {
    await stamp(db, now);
    const device = await getDeviceId(db);
    const { rows } = await db.execute(
      since === null
        ? 'SELECT * FROM sync_rows WHERE hlc IS NOT NULL'
        : 'SELECT * FROM sync_rows WHERE hlc > ?',
      since === null ? [] : [since],
    );
    const metas = rows
      .map(toMeta)
      .filter(m => allowed(m.tbl, m.weapon, options));
    const clock = (await getClock(db)) ?? tick(null, now, device);
    return {
      format: SYNC_FORMAT,
      device,
      clock: encodeHlc(clock),
      rows: await withData(db, metas),
    };
  });
}

// --- Validation d'un envoi reçu -------------------------------------------

function fail(message: string): never {
  throw new SyncError('INVALID_PAYLOAD', message);
}

function validRow(value: unknown): SyncRow {
  if (typeof value !== 'object' || value === null) {
    fail('Ligne illisible');
  }
  const r = value as Record<string, unknown>;
  const table = sharedTable(String(r.table));
  if (!table) {
    fail('Table inconnue');
  }
  if (typeof r.key !== 'string' || r.key.length === 0 || r.key.length > 300) {
    fail('Clé invalide');
  }
  try {
    keyValues(table, r.key);
  } catch {
    fail('Clé invalide');
  }
  if (!isHlc(r.hlc)) {
    fail('Horodatage invalide');
  }
  if (typeof r.deleted !== 'boolean' || typeof r.weapon !== 'boolean') {
    fail('Indicateurs invalides');
  }
  if (
    r.base !== null &&
    (typeof r.base !== 'number' || !Number.isFinite(r.base))
  ) {
    fail('Base invalide');
  }
  let data: Record<string, SqlValue> | null = null;
  if (r.data !== null) {
    if (typeof r.data !== 'object' || Array.isArray(r.data)) {
      fail('Contenu invalide');
    }
    data = {};
    for (const [column, v] of Object.entries(r.data as object)) {
      if (!COLUMN_NAME.test(column)) {
        fail('Colonne invalide');
      }
      if (
        v !== null &&
        typeof v !== 'string' &&
        !(typeof v === 'number' && Number.isFinite(v))
      ) {
        fail('Valeur invalide');
      }
      data[column] = v as SqlValue;
    }
  } else if (!r.deleted) {
    fail('Contenu manquant');
  }
  return {
    table: table.name,
    key: r.key,
    hlc: r.hlc,
    deleted: r.deleted,
    weapon: r.weapon,
    base: r.base as number | null,
    data,
  };
}

export function validatePayload(value: unknown, now: number): SyncPayload {
  if (typeof value !== 'object' || value === null) {
    fail('Envoi illisible');
  }
  const p = value as Record<string, unknown>;
  if (p.format !== SYNC_FORMAT) {
    throw new SyncError(
      'UNSUPPORTED_FORMAT',
      'Versions de Fenrir différentes : mettez les deux téléphones à jour.',
    );
  }
  if (typeof p.device !== 'string' || !/^[0-9a-f]{1,32}$/.test(p.device)) {
    fail('Appareil invalide');
  }
  if (!isHlc(p.clock) || !Array.isArray(p.rows)) {
    fail('Envoi incomplet');
  }
  const rows = p.rows.map(validRow);
  const latest = [p.clock, ...rows.map(r => r.hlc)].reduce((a, b) =>
    b > a ? b : a,
  );
  if ((decodeHlc(latest)?.wall ?? 0) > now + MAX_AHEAD_MS) {
    throw new SyncError(
      'CLOCK_AHEAD',
      'L’horloge de l’autre téléphone est en avance de plus d’un jour : corrigez sa date et son heure.',
    );
  }
  return { format: SYNC_FORMAT, device: p.device, clock: p.clock, rows };
}

// --- Application ----------------------------------------------------------

/** Colonnes de la table (liste blanche des noms reçus). */
async function columnsOf(db: SqlDatabase, table: string): Promise<Set<string>> {
  const { rows } = await db.execute(`PRAGMA table_info(${table})`);
  return new Set(rows.map(r => String(r.name)));
}

async function existing(
  db: SqlDatabase,
  table: string,
  column: string,
  ids: readonly string[],
): Promise<Set<string>> {
  const found = new Set<string>();
  const unique = [...new Set(ids)];
  for (const part of chunks(unique, KEY_CHUNK)) {
    const { rows } = await db.execute(
      `SELECT ${column} AS id FROM ${table}
        WHERE ${column} IN (${placeholders(part.length)})`,
      part,
    );
    rows.forEach(r => found.add(String(r.id)));
  }
  return found;
}

const asId = (v: SqlValue | undefined) => (typeof v === 'string' ? v : null);

/**
 * Références vers des lignes absentes (supprimées ici, ou non partagées) :
 * remises à vide quand la colonne le permet, ligne écartée sinon.
 */
async function resolveReferences(
  db: SqlDatabase,
  table: string,
  rows: SyncRow[],
): Promise<SyncRow[]> {
  const refs = async (parent: string, column: string) =>
    existing(
      db,
      parent,
      'id',
      rows.map(r => asId(r.data?.[column])).filter((x): x is string => !!x),
    );
  const clear = (row: SyncRow, column: string, ok: Set<string>): SyncRow => {
    const id = asId(row.data?.[column]);
    return id && !ok.has(id) && row.data
      ? { ...row, data: { ...row.data, [column]: null } }
      : row;
  };
  switch (table) {
    case 'inventory_lots': {
      const ok = await refs('inventory_items', 'item_id');
      const boxes = await refs('boxes', 'box_id');
      return rows
        .filter(r => ok.has(asId(r.data?.item_id) ?? ''))
        .map(r => clear(r, 'box_id', boxes));
    }
    case 'inventory_items': {
      const ok = await refs('bags', 'bag_id');
      return rows.map(r => clear(r, 'bag_id', ok));
    }
    case 'barcode_products':
    case 'stock_movements': {
      const ok = await refs('inventory_items', 'item_id');
      return rows.map(r => clear(r, 'item_id', ok));
    }
    case 'photos': {
      const owners: Record<string, string> = {
        item: 'inventory_items',
        weapon: 'weapons',
        document: 'documents',
      };
      const kept: SyncRow[] = [];
      for (const [type, parent] of Object.entries(owners)) {
        const list = rows.filter(r => r.data?.owner_type === type);
        const ok = await refs(parent, 'owner_id');
        kept.push(...list.filter(r => ok.has(asId(r.data?.owner_id) ?? '')));
      }
      return kept;
    }
    default:
      return rows;
  }
}

async function upsertRows(
  db: SqlDatabase,
  table: SharedTable,
  rows: readonly SyncRow[],
): Promise<void> {
  const known = await columnsOf(db, table.name);
  // Les lignes d'un même paquet partagent les mêmes colonnes.
  const groups = new Map<string, { cols: string[]; rows: SyncRow[] }>();
  for (const row of rows) {
    const cols = Object.keys(row.data ?? {})
      .filter(c => known.has(c))
      .sort();
    const sig = cols.join(',');
    const g = groups.get(sig) ?? { cols, rows: [] };
    g.rows.push(row);
    groups.set(sig, g);
  }
  for (const { cols, rows: list } of groups.values()) {
    const updates = cols.filter(c => !table.keys.includes(c));
    const perRow = Math.max(1, Math.floor(MAX_PARAMS / cols.length));
    for (const part of chunks(list, perRow)) {
      await db.execute(
        `INSERT INTO ${table.name} (${cols.join(', ')})
         VALUES ${part.map(() => `(${placeholders(cols.length)})`).join(', ')}
         ON CONFLICT (${table.keys.join(', ')}) DO ${
          updates.length === 0
            ? 'NOTHING'
            : `UPDATE SET ${updates
                .map(c => `${c} = excluded.${c}`)
                .join(', ')}`
        }`,
        part.flatMap(r => cols.map(c => r.data?.[c] ?? null)),
      );
    }
  }
}

async function deleteRows(
  db: SqlDatabase,
  table: SharedTable,
  keys: readonly string[],
): Promise<void> {
  for (const part of chunks(keys, KEY_CHUNK)) {
    await db.execute(
      `DELETE FROM ${table.name}
        WHERE ${keySql(table)} IN (${placeholders(part.length)})`,
      part,
    );
  }
}

/** Version et base finales de chaque ligne traitée. */
async function recordVersions(
  db: SqlDatabase,
  rows: readonly SyncRow[],
): Promise<void> {
  for (const part of chunks(rows, Math.floor(MAX_PARAMS / 6))) {
    await db.execute(
      `INSERT INTO sync_rows (tbl, key, hlc, deleted, is_weapon, base)
       VALUES ${part.map(() => '(?, ?, ?, ?, ?, ?)').join(', ')}
       ON CONFLICT (tbl, key) DO UPDATE
          SET hlc = excluded.hlc, dirty_at = NULL,
              deleted = excluded.deleted,
              is_weapon = max(is_weapon, excluded.is_weapon),
              base = excluded.base`,
      part.flatMap(r => [
        r.table,
        r.key,
        r.hlc,
        r.deleted ? 1 : 0,
        r.weapon ? 1 : 0,
        r.base,
      ]),
    );
  }
}

/** État local des lignes reçues (contenu chargé pour les lots). */
async function loadLocal(
  db: SqlDatabase,
  incoming: readonly SyncRow[],
): Promise<Map<string, SyncRow>> {
  const metas: MetaRow[] = [];
  const byTable = new Map<string, string[]>();
  for (const r of incoming) {
    const list = byTable.get(r.table);
    if (list) {
      list.push(r.key);
    } else {
      byTable.set(r.table, [r.key]);
    }
  }
  for (const [table, keys] of byTable) {
    for (const part of chunks([...new Set(keys)], KEY_CHUNK)) {
      const { rows } = await db.execute(
        `SELECT * FROM sync_rows
          WHERE tbl = ? AND key IN (${placeholders(part.length)})`,
        [table, ...part],
      );
      metas.push(...rows.map(toMeta));
    }
  }
  const rows = await withData(db, metas, t => t === 'inventory_lots');
  return new Map(rows.map(r => [rowId(r.table, r.key), r]));
}

/**
 * Applique un envoi reçu de l'autre téléphone. Tout ou rien : une erreur
 * annule l'ensemble. `sent` est ce que nous lui avons envoyé dans le même
 * échange : ses lots servent de base au prochain calcul.
 */
export async function applyRemoteChanges(
  db: SqlDatabase,
  input: unknown,
  options: SyncOptions & { sent?: SyncPayload | null; now?: number },
): Promise<SyncReport> {
  const now = options.now ?? Date.now();
  const payload = validatePayload(input, now);
  const shared = new Set(SHARED_SETTINGS);
  const incoming = payload.rows.filter(
    r =>
      allowed(r.table, r.weapon, options) &&
      (r.table !== 'settings' || shared.has(r.key)) &&
      (r.data === null || keyMatches(r)),
  );
  return withTransaction(db, async () => {
    const node = await getDeviceId(db);
    if (payload.device === node) {
      throw new SyncError('SAME_DEVICE', 'Envoi venant de ce téléphone');
    }
    await db.execute(
      "INSERT OR REPLACE INTO sync_meta (key, value) VALUES ('applying', '1')",
    );
    await stamp(db, now);

    const plan = mergeSyncData(await loadLocal(db, incoming), incoming);
    const report: SyncReport = {
      received: payload.rows.length,
      written: 0,
      removed: 0,
      summed: plan.summed,
      skipped: payload.rows.length - incoming.length,
    };

    for (const table of [...SHARED_TABLES].reverse()) {
      const keys = plan.remove.filter(r => r.table === table.name);
      await deleteRows(
        db,
        table,
        keys.map(r => r.key),
      );
      report.removed += keys.length;
    }
    const applied: SyncRow[] = [...plan.remove, ...plan.settle];
    for (const table of SHARED_TABLES) {
      const rows = plan.write.filter(r => r.table === table.name);
      if (rows.length === 0) {
        continue;
      }
      const kept = await resolveReferences(db, table.name, rows);
      await upsertRows(db, table, kept);
      applied.push(...kept);
      report.written += kept.length;
      report.skipped += rows.length - kept.length;
    }
    await recordVersions(db, applied);
    if (options.sent) {
      await settleSentLots(db, options.sent, incoming);
    }

    const latest = [payload.clock, ...incoming.map(r => r.hlc)].reduce((a, b) =>
      b > a ? b : a,
    );
    const remoteClock = decodeHlc(latest);
    if (remoteClock) {
      const clock = receive(await getClock(db), remoteClock, node);
      await setMeta(db, 'clock', encodeHlc(clock));
    }
    await setMeta(db, `peer_clock:${payload.device}`, payload.clock);
    await db.execute("DELETE FROM sync_meta WHERE key = 'applying'");
    return report;
  });
}

/** La clé annoncée correspond bien au contenu de la ligne. */
function keyMatches(row: SyncRow): boolean {
  const table = sharedTable(row.table);
  if (!table || !row.data) {
    return false;
  }
  const values = keyValues(table, row.key);
  return table.keys.every((k, i) => row.data?.[k] === values[i]);
}

/**
 * Lots envoyés que l'autre téléphone n'a pas modifiés : il adopte notre
 * quantité, qui devient la base commune du prochain échange.
 */
async function settleSentLots(
  db: SqlDatabase,
  sent: SyncPayload,
  incoming: readonly SyncRow[],
): Promise<void> {
  const received = new Set(
    incoming.filter(r => r.table === 'inventory_lots').map(r => r.key),
  );
  const lots = sent.rows.filter(
    r => r.table === 'inventory_lots' && !received.has(r.key),
  );
  for (const r of lots) {
    const q = r.deleted ? 0 : Number(r.data?.quantity ?? 0);
    await db.execute(
      'UPDATE sync_rows SET base = ? WHERE tbl = ? AND key = ? AND hlc = ?',
      [q, r.table, r.key, r.hlc],
    );
  }
}
