/**
 * Migrations du schéma. Les deux bases (réelle et factice) reçoivent
 * exactement le même schéma : rien dans la structure ne les distingue.
 *
 * Règles :
 * - Ne JAMAIS modifier une migration publiée : en ajouter une nouvelle.
 * - Une instruction SQL par élément de tableau (les triggers contiennent des
 *   `;` et ne peuvent pas être découpés automatiquement).
 * - Tables STRICT : SQLite refuse les valeurs du mauvais type. Les booléens
 *   sont des INTEGER 0/1, les dates des TEXT ISO 8601.
 */

export interface Migration {
  readonly version: number;
  readonly name: string;
  readonly statements: readonly string[];
}

/** Horodatage UTC ISO 8601 avec millisecondes. */
const NOW = "(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))";

/** Une date calendaire `AAAA-MM-JJ` valide (rejette 2025-02-30). */
const isIsoDate = (column: string) => `date(${column}) IS ${column}`;

const isBoolean = (column: string) => `${column} IN (0, 1)`;

const touchTrigger = (table: string) =>
  `CREATE TRIGGER trg_${table}_touch AFTER UPDATE ON ${table}
   FOR EACH ROW WHEN NEW.updated_at IS OLD.updated_at
   BEGIN
     UPDATE ${table} SET updated_at = ${NOW} WHERE rowid = NEW.rowid;
   END`;

const migration1: Migration = {
  version: 1,
  name: 'schéma initial',
  statements: [
    // --- Réglages du foyer -------------------------------------------------
    `CREATE TABLE settings (
       key   TEXT PRIMARY KEY NOT NULL,
       value TEXT NOT NULL
     ) STRICT`,
    `INSERT INTO settings (key, value) VALUES
       ('household_members', '1'),
       ('water_liters_per_person_day', '3'),
       ('kcal_per_person_day', '2000')`,

    // --- Inventaire : un article, plusieurs lots --------------------------
    `CREATE TABLE inventory_items (
       id                TEXT PRIMARY KEY NOT NULL,
       name              TEXT NOT NULL CHECK (length(trim(name)) > 0),
       category          TEXT NOT NULL
                         CHECK (category IN ('water', 'food', 'medical', 'energy', 'tool')),
       unit              TEXT NOT NULL CHECK (unit IN ('L', 'mL', 'kg', 'g', 'unit')),
       calories_per_unit INTEGER CHECK (calories_per_unit IS NULL OR calories_per_unit >= 0),
       location          TEXT,
       is_critical       INTEGER NOT NULL DEFAULT 0 CHECK (${isBoolean(
         'is_critical',
       )}),
       notes             TEXT,
       created_at        TEXT NOT NULL DEFAULT ${NOW},
       updated_at        TEXT NOT NULL DEFAULT ${NOW},
       -- L'eau doit être exprimée en volume pour le calcul d'autonomie.
       CHECK (category <> 'water' OR unit IN ('L', 'mL'))
     ) STRICT`,
    'CREATE INDEX idx_inventory_items_category ON inventory_items (category)',
    touchTrigger('inventory_items'),

    `CREATE TABLE inventory_lots (
       id              TEXT PRIMARY KEY NOT NULL,
       item_id         TEXT NOT NULL REFERENCES inventory_items (id) ON DELETE CASCADE,
       quantity        REAL NOT NULL CHECK (quantity >= 0),
       acquired_at     TEXT NOT NULL CHECK (${isIsoDate('acquired_at')}),
       expiration_date TEXT CHECK (expiration_date IS NULL OR ${isIsoDate(
         'expiration_date',
       )}),
       created_at      TEXT NOT NULL DEFAULT ${NOW},
       updated_at      TEXT NOT NULL DEFAULT ${NOW}
     ) STRICT`,
    // Ordre de consommation d'un article : péremption la plus proche, puis
    // le lot le plus ancien (FEFO puis FIFO).
    `CREATE INDEX idx_inventory_lots_consumption
       ON inventory_lots (item_id, expiration_date, acquired_at)`,
    // Alertes de péremption à 30/60/90 jours : index partiel sur les seuls
    // lots non vides et datés.
    `CREATE INDEX idx_inventory_lots_expiration
       ON inventory_lots (expiration_date)
       WHERE expiration_date IS NOT NULL AND quantity > 0`,
    touchTrigger('inventory_lots'),

    // --- Cartographie ------------------------------------------------------
    `CREATE TABLE poi_locations (
       id         TEXT PRIMARY KEY NOT NULL,
       label      TEXT NOT NULL CHECK (length(trim(label)) > 0),
       latitude   REAL NOT NULL CHECK (latitude BETWEEN -90 AND 90),
       longitude  REAL NOT NULL CHECK (longitude BETWEEN -180 AND 180),
       mgrs       TEXT,
       type       TEXT NOT NULL
                  CHECK (type IN ('water_source', 'cache', 'shelter', 'danger')),
       notes      TEXT,
       created_at TEXT NOT NULL DEFAULT ${NOW},
       updated_at TEXT NOT NULL DEFAULT ${NOW}
     ) STRICT`,
    'CREATE INDEX idx_poi_locations_type ON poi_locations (type)',
    touchTrigger('poi_locations'),

    // --- Checklists de crise ----------------------------------------------
    `CREATE TABLE crisis_checklists (
       id           TEXT PRIMARY KEY NOT NULL,
       title        TEXT NOT NULL CHECK (length(trim(title)) > 0),
       scenario     TEXT NOT NULL,
       is_completed INTEGER NOT NULL DEFAULT 0 CHECK (${isBoolean(
         'is_completed',
       )}),
       created_at   TEXT NOT NULL DEFAULT ${NOW},
       updated_at   TEXT NOT NULL DEFAULT ${NOW}
     ) STRICT`,
    touchTrigger('crisis_checklists'),
    // Une ligne par élément (au lieu de items_json) : cocher un élément est
    // une simple mise à jour, sans réécrire tout le document.
    `CREATE TABLE crisis_checklist_items (
       id           TEXT PRIMARY KEY NOT NULL,
       checklist_id TEXT NOT NULL REFERENCES crisis_checklists (id) ON DELETE CASCADE,
       position     INTEGER NOT NULL CHECK (position >= 0),
       label        TEXT NOT NULL CHECK (length(trim(label)) > 0),
       is_done      INTEGER NOT NULL DEFAULT 0 CHECK (${isBoolean('is_done')}),
       UNIQUE (checklist_id, position)
     ) STRICT`,

    // --- Base documentaire + recherche plein texte ------------------------
    // Clé INTEGER explicite : l'index FTS5 « external content » référence
    // le rowid, qui doit rester stable (un VACUUM peut renuméroter un rowid
    // implicite).
    `CREATE TABLE survival_guides (
       id           INTEGER PRIMARY KEY,
       slug         TEXT NOT NULL UNIQUE CHECK (length(slug) > 0),
       title        TEXT NOT NULL,
       category     TEXT NOT NULL,
       body         TEXT NOT NULL,
       content_hash TEXT NOT NULL,
       updated_at   TEXT NOT NULL DEFAULT ${NOW}
     ) STRICT`,
    // remove_diacritics 2 : « hypothermie » trouve « Hypothermie », « severe »
    // trouve « sévère ». prefix : recherche instantanée pendant la frappe.
    `CREATE VIRTUAL TABLE survival_guides_fts USING fts5 (
       title,
       body,
       content = 'survival_guides',
       content_rowid = 'id',
       tokenize = 'unicode61 remove_diacritics 2',
       prefix = '2 3'
     )`,
    `CREATE TRIGGER trg_survival_guides_ai AFTER INSERT ON survival_guides BEGIN
       INSERT INTO survival_guides_fts (rowid, title, body)
       VALUES (NEW.id, NEW.title, NEW.body);
     END`,
    `CREATE TRIGGER trg_survival_guides_ad AFTER DELETE ON survival_guides BEGIN
       INSERT INTO survival_guides_fts (survival_guides_fts, rowid, title, body)
       VALUES ('delete', OLD.id, OLD.title, OLD.body);
     END`,
    `CREATE TRIGGER trg_survival_guides_au AFTER UPDATE OF title, body ON survival_guides BEGIN
       INSERT INTO survival_guides_fts (survival_guides_fts, rowid, title, body)
       VALUES ('delete', OLD.id, OLD.title, OLD.body);
       INSERT INTO survival_guides_fts (rowid, title, body)
       VALUES (NEW.id, NEW.title, NEW.body);
     END`,
  ],
};

export const MIGRATIONS: readonly Migration[] = [migration1];

export const SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version;
