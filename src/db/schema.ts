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

const migration2: Migration = {
  version: 2,
  name: 'réapprovisionnement et seuils par article',
  statements: [
    // Stock minimal souhaité, dans l'unité de l'article (ex. 2 filtres).
    `ALTER TABLE inventory_items ADD COLUMN min_stock REAL
       CHECK (min_stock IS NULL OR min_stock >= 0)`,
    // Prévenir N jours avant la péremption au lieu des seuils 30/60/90.
    `ALTER TABLE inventory_items ADD COLUMN alert_days INTEGER
       CHECK (alert_days IS NULL OR alert_days BETWEEN 1 AND 3650)`,
    // Objectif d'autonomie du foyer, en jours.
    "INSERT INTO settings (key, value) VALUES ('target_days', '14')",
  ],
};

/**
 * Armes et munitions. Les munitions sont des articles de stock (catégorie
 * `weapon`) portant un calibre ; les armes ont leur propre table et
 * retrouvent leurs munitions par calibre.
 *
 * SQLite ne sait pas modifier une contrainte CHECK : la table des articles
 * est reconstruite. Les lots sont mis de côté avant de supprimer l'ancienne
 * table, sinon `ON DELETE CASCADE` les effacerait (foreign_keys est actif
 * et ne peut pas être désactivé dans une transaction). Index et triggers
 * disparaissent avec leur table et sont recréés à l'identique.
 */
const migration3: Migration = {
  version: 3,
  name: 'catégorie armes et munitions',
  statements: [
    'CREATE TABLE inventory_lots_backup AS SELECT * FROM inventory_lots',
    'DROP TABLE inventory_lots',

    `CREATE TABLE inventory_items_new (
       id                TEXT PRIMARY KEY NOT NULL,
       name              TEXT NOT NULL CHECK (length(trim(name)) > 0),
       category          TEXT NOT NULL
                         CHECK (category IN ('water', 'food', 'medical', 'energy', 'tool', 'weapon')),
       unit              TEXT NOT NULL CHECK (unit IN ('L', 'mL', 'kg', 'g', 'unit')),
       calories_per_unit INTEGER CHECK (calories_per_unit IS NULL OR calories_per_unit >= 0),
       location          TEXT,
       is_critical       INTEGER NOT NULL DEFAULT 0 CHECK (${isBoolean(
         'is_critical',
       )}),
       notes             TEXT,
       created_at        TEXT NOT NULL DEFAULT ${NOW},
       updated_at        TEXT NOT NULL DEFAULT ${NOW},
       min_stock         REAL CHECK (min_stock IS NULL OR min_stock >= 0),
       alert_days        INTEGER CHECK (alert_days IS NULL OR alert_days BETWEEN 1 AND 3650),
       -- Calibre des munitions (ex. « 12/70 »), réservé à la catégorie weapon.
       caliber           TEXT CHECK (caliber IS NULL
                                     OR (category = 'weapon' AND length(trim(caliber)) > 0)),
       CHECK (category <> 'water' OR unit IN ('L', 'mL'))
     ) STRICT`,
    `INSERT INTO inventory_items_new (id, name, category, unit, calories_per_unit,
       location, is_critical, notes, created_at, updated_at, min_stock, alert_days)
     SELECT id, name, category, unit, calories_per_unit, location, is_critical,
       notes, created_at, updated_at, min_stock, alert_days
     FROM inventory_items`,
    'DROP TABLE inventory_items',
    'ALTER TABLE inventory_items_new RENAME TO inventory_items',
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
    `INSERT INTO inventory_lots (id, item_id, quantity, acquired_at,
       expiration_date, created_at, updated_at)
     SELECT id, item_id, quantity, acquired_at, expiration_date, created_at,
       updated_at
     FROM inventory_lots_backup`,
    'DROP TABLE inventory_lots_backup',
    `CREATE INDEX idx_inventory_lots_consumption
       ON inventory_lots (item_id, expiration_date, acquired_at)`,
    `CREATE INDEX idx_inventory_lots_expiration
       ON inventory_lots (expiration_date)
       WHERE expiration_date IS NOT NULL AND quantity > 0`,
    touchTrigger('inventory_lots'),

    `CREATE TABLE weapons (
       id            TEXT PRIMARY KEY NOT NULL,
       model         TEXT NOT NULL CHECK (length(trim(model)) > 0),
       kind          TEXT NOT NULL
                     CHECK (kind IN ('rifle', 'shotgun', 'handgun', 'other')),
       caliber       TEXT NOT NULL CHECK (length(trim(caliber)) > 0),
       serial_number TEXT,
       notes         TEXT,
       created_at    TEXT NOT NULL DEFAULT ${NOW},
       updated_at    TEXT NOT NULL DEFAULT ${NOW}
     ) STRICT`,
    touchTrigger('weapons'),
  ],
};

const migration4: Migration = {
  version: 4,
  name: 'conditionnement des articles',
  statements: [
    // Contenance d'un contenant, dans l'unité de l'article (ex. bidon de
    // 10 L, boîte de 25 cartouches). Sert à la saisie et à l'affichage.
    `ALTER TABLE inventory_items ADD COLUMN package_size REAL
       CHECK (package_size IS NULL OR package_size > 0)`,
  ],
};

/**
 * Documents importants et photos. Les photos (JPEG en base64) sont stockées
 * dans la base chiffrée, jamais dans la galerie du téléphone ; elles sont
 * effacées avec l'arme ou le document auquel elles appartiennent.
 */
const migration5: Migration = {
  version: 5,
  name: 'documents et photos',
  statements: [
    `CREATE TABLE documents (
       id         TEXT PRIMARY KEY NOT NULL,
       kind       TEXT NOT NULL
                  CHECK (kind IN ('id_card', 'passport', 'driving_licence',
                                  'health_card', 'insurance', 'other')),
       title      TEXT NOT NULL CHECK (length(trim(title)) > 0),
       holder     TEXT,
       number     TEXT,
       expires_at TEXT CHECK (expires_at IS NULL OR ${isIsoDate('expires_at')}),
       notes      TEXT,
       created_at TEXT NOT NULL DEFAULT ${NOW},
       updated_at TEXT NOT NULL DEFAULT ${NOW}
     ) STRICT`,
    touchTrigger('documents'),

    `CREATE TABLE photos (
       id          TEXT PRIMARY KEY NOT NULL,
       owner_type  TEXT NOT NULL CHECK (owner_type IN ('weapon', 'document')),
       owner_id    TEXT NOT NULL,
       mime        TEXT NOT NULL DEFAULT 'image/jpeg'
                   CHECK (mime IN ('image/jpeg', 'image/png')),
       data_base64 TEXT NOT NULL CHECK (length(data_base64) > 0),
       created_at  TEXT NOT NULL DEFAULT ${NOW}
     ) STRICT`,
    'CREATE INDEX idx_photos_owner ON photos (owner_type, owner_id, created_at)',
    `CREATE TRIGGER trg_weapons_photos_ad AFTER DELETE ON weapons BEGIN
       DELETE FROM photos WHERE owner_type = 'weapon' AND owner_id = OLD.id;
     END`,
    `CREATE TRIGGER trg_documents_photos_ad AFTER DELETE ON documents BEGIN
       DELETE FROM photos WHERE owner_type = 'document' AND owner_id = OLD.id;
     END`,
  ],
};

const migration6: Migration = {
  version: 6,
  name: 'type d’article',
  statements: [
    // Précise la catégorie : eau en bouteille ou du robinet, conserve,
    // médicament, chevrotine… Sert à la saisie et à l'estimation des kcal.
    `ALTER TABLE inventory_items ADD COLUMN subtype TEXT
       CHECK (subtype IS NULL OR (length(subtype) BETWEEN 1 AND 30))`,
  ],
};

/**
 * Fiches de stock détaillées (pack « fiches ») :
 * - `attributes` (JSON) sur les articles et les armes : champs propres à
 *   chaque catégorie (potabilité, conservation, dosage, état, entretien…),
 *   facultatifs, les anciennes lignes restent valides (NULL) ;
 * - photos possibles pour tout article : la table est reconstruite pour
 *   élargir sa contrainte (SQLite ne modifie pas un CHECK).
 */
const migration7: Migration = {
  version: 7,
  name: 'fiches de stock détaillées',
  statements: [
    `ALTER TABLE inventory_items ADD COLUMN attributes TEXT
       CHECK (attributes IS NULL OR json_valid(attributes))`,
    `ALTER TABLE weapons ADD COLUMN attributes TEXT
       CHECK (attributes IS NULL OR json_valid(attributes))`,
    // Les triggers qui visent `photos` empêcheraient le renommage : ils
    // sont supprimés puis recréés à l'identique.
    'DROP TRIGGER trg_weapons_photos_ad',
    'DROP TRIGGER trg_documents_photos_ad',
    `CREATE TABLE photos_new (
       id          TEXT PRIMARY KEY NOT NULL,
       owner_type  TEXT NOT NULL
                   CHECK (owner_type IN ('weapon', 'document', 'item')),
       owner_id    TEXT NOT NULL,
       mime        TEXT NOT NULL DEFAULT 'image/jpeg'
                   CHECK (mime IN ('image/jpeg', 'image/png')),
       data_base64 TEXT NOT NULL CHECK (length(data_base64) > 0),
       created_at  TEXT NOT NULL DEFAULT ${NOW}
     ) STRICT`,
    `INSERT INTO photos_new (id, owner_type, owner_id, mime, data_base64, created_at)
     SELECT id, owner_type, owner_id, mime, data_base64, created_at FROM photos`,
    'DROP TABLE photos',
    'ALTER TABLE photos_new RENAME TO photos',
    'CREATE INDEX idx_photos_owner ON photos (owner_type, owner_id, created_at)',
    `CREATE TRIGGER trg_weapons_photos_ad AFTER DELETE ON weapons BEGIN
       DELETE FROM photos WHERE owner_type = 'weapon' AND owner_id = OLD.id;
     END`,
    `CREATE TRIGGER trg_documents_photos_ad AFTER DELETE ON documents BEGIN
       DELETE FROM photos WHERE owner_type = 'document' AND owner_id = OLD.id;
     END`,
    `CREATE TRIGGER trg_items_photos_ad AFTER DELETE ON inventory_items BEGIN
       DELETE FROM photos WHERE owner_type = 'item' AND owner_id = OLD.id;
     END`,
  ],
};

/**
 * Catégorie « Énergie » (`power`) distincte du matériel (`energy`, affiché
 * « Matériel & équipements ») : piles, batteries, carburant, gaz, bougies…
 *
 * SQLite ne modifie pas un CHECK : `inventory_items` est reconstruite à
 * l'identique, catégorie `power` en plus. Les lots sont mis de côté avant :
 * supprimer les articles avec les clés étrangères actives effacerait leurs
 * lots en cascade.
 *
 * Les articles de matériel de type énergie (y compris les anciens types
 * piles, carburant, gaz) passent dans la nouvelle catégorie ; leur type est
 * déduit du nom quand il est clair, « Autre » sinon.
 */
const migration8: Migration = {
  version: 8,
  name: 'catégorie énergie',
  statements: [
    'CREATE TABLE inventory_lots_backup AS SELECT * FROM inventory_lots',
    'DROP TABLE inventory_lots',
    'DROP TRIGGER trg_items_photos_ad',

    `CREATE TABLE inventory_items_new (
       id                TEXT PRIMARY KEY NOT NULL,
       name              TEXT NOT NULL CHECK (length(trim(name)) > 0),
       category          TEXT NOT NULL
                         CHECK (category IN ('water', 'food', 'medical', 'energy', 'tool', 'weapon', 'power')),
       unit              TEXT NOT NULL CHECK (unit IN ('L', 'mL', 'kg', 'g', 'unit')),
       calories_per_unit INTEGER CHECK (calories_per_unit IS NULL OR calories_per_unit >= 0),
       location          TEXT,
       is_critical       INTEGER NOT NULL DEFAULT 0 CHECK (${isBoolean(
         'is_critical',
       )}),
       notes             TEXT,
       created_at        TEXT NOT NULL DEFAULT ${NOW},
       updated_at        TEXT NOT NULL DEFAULT ${NOW},
       min_stock         REAL CHECK (min_stock IS NULL OR min_stock >= 0),
       alert_days        INTEGER CHECK (alert_days IS NULL OR alert_days BETWEEN 1 AND 3650),
       -- Calibre des munitions (ex. « 12/70 »), réservé à la catégorie weapon.
       caliber           TEXT CHECK (caliber IS NULL
                                     OR (category = 'weapon' AND length(trim(caliber)) > 0)),
       package_size      REAL CHECK (package_size IS NULL OR package_size > 0),
       subtype           TEXT CHECK (subtype IS NULL OR (length(subtype) BETWEEN 1 AND 30)),
       attributes        TEXT CHECK (attributes IS NULL OR json_valid(attributes)),
       CHECK (category <> 'water' OR unit IN ('L', 'mL'))
     ) STRICT`,
    `INSERT INTO inventory_items_new (id, name, category, unit, calories_per_unit,
       location, is_critical, notes, created_at, updated_at, min_stock, alert_days,
       caliber, package_size, subtype, attributes)
     SELECT id, name, category, unit, calories_per_unit, location, is_critical,
       notes, created_at, updated_at, min_stock, alert_days, caliber,
       package_size, subtype, attributes
     FROM inventory_items`,
    'DROP TABLE inventory_items',
    'ALTER TABLE inventory_items_new RENAME TO inventory_items',
    'CREATE INDEX idx_inventory_items_category ON inventory_items (category)',
    touchTrigger('inventory_items'),
    `CREATE TRIGGER trg_items_photos_ad AFTER DELETE ON inventory_items BEGIN
       DELETE FROM photos WHERE owner_type = 'item' AND owner_id = OLD.id;
     END`,

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
    `INSERT INTO inventory_lots (id, item_id, quantity, acquired_at,
       expiration_date, created_at, updated_at)
     SELECT id, item_id, quantity, acquired_at, expiration_date, created_at,
       updated_at
     FROM inventory_lots_backup`,
    'DROP TABLE inventory_lots_backup',
    `CREATE INDEX idx_inventory_lots_consumption
       ON inventory_lots (item_id, expiration_date, acquired_at)`,
    `CREATE INDEX idx_inventory_lots_expiration
       ON inventory_lots (expiration_date)
       WHERE expiration_date IS NOT NULL AND quantity > 0`,
    touchTrigger('inventory_lots'),

    // Le type « Énergie » du matériel devient la catégorie Énergie.
    `UPDATE inventory_items
     SET category = 'power',
         subtype = CASE
           WHEN subtype IN ('fuel', 'gas') THEN subtype
           WHEN name LIKE '%powerbank%' OR name LIKE '%batterie externe%'
             THEN 'powerbank'
           WHEN name LIKE '%pile%' OR name LIKE '%accu%'
             OR name LIKE '%batterie%' OR subtype = 'battery' THEN 'battery'
           WHEN name LIKE '%gaz%' OR name LIKE '%butane%'
             OR name LIKE '%propane%' THEN 'gas'
           WHEN name LIKE '%essence%' OR name LIKE '%gazole%'
             OR name LIKE '%gasoil%' OR name LIKE '%carburant%'
             OR name LIKE '%fioul%' OR name LIKE '%alcool%' THEN 'fuel'
           WHEN name LIKE '%bougie%' THEN 'candle'
           WHEN name LIKE '%solaire%' THEN 'solar'
           WHEN name LIKE '%groupe%' THEN 'generator'
           WHEN name LIKE '%bois%' OR name LIKE '%charbon%' THEN 'wood'
           ELSE 'other'
         END
     WHERE category = 'energy'
       AND subtype IN ('energy', 'battery', 'fuel', 'gas')`,
  ],
};

/**
 * Sacs d'évacuation : chaque sac a son propre contenu (articles et lots
 * habituels, avec leurs péremptions). Un article rangé dans un sac a un
 * `bag_id` ; supprimer le sac remet son contenu dans le stock général.
 */
const migration9: Migration = {
  version: 9,
  name: 'sacs d’évacuation',
  statements: [
    `CREATE TABLE bags (
       id         TEXT PRIMARY KEY NOT NULL,
       name       TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 60),
       owner      TEXT CHECK (owner IS NULL OR length(owner) <= 60),
       notes      TEXT CHECK (notes IS NULL OR length(notes) <= 500),
       created_at TEXT NOT NULL DEFAULT ${NOW},
       updated_at TEXT NOT NULL DEFAULT ${NOW}
     ) STRICT`,
    touchTrigger('bags'),
    `ALTER TABLE inventory_items ADD COLUMN bag_id TEXT
       REFERENCES bags (id) ON DELETE SET NULL`,
    'CREATE INDEX idx_inventory_items_bag ON inventory_items (bag_id)',
  ],
};

/**
 * Plan familial de mise en sûreté : contacts (dont un hors zone), points de
 * regroupement, itinéraires, coupures, rôles, dernier exercice. Un seul
 * document JSON, validé par l'application.
 */
const migration10: Migration = {
  version: 10,
  name: 'plan familial',
  statements: [
    `CREATE TABLE family_plan (
       id         INTEGER PRIMARY KEY CHECK (id = 1),
       data       TEXT NOT NULL CHECK (json_valid(data)),
       updated_at TEXT NOT NULL DEFAULT ${NOW}
     ) STRICT`,
  ],
};

/**
 * Préparation par paliers : éléments du kit cochés à la main parce que le
 * stock ne les suit pas (argent liquide, double des clés…), pour la maison
 * (`home`) ou pour un sac (son identifiant).
 */
const migration11: Migration = {
  version: 11,
  name: 'préparation par paliers',
  statements: [
    `CREATE TABLE preparation_marks (
       scope      TEXT NOT NULL CHECK (length(scope) BETWEEN 1 AND 64),
       item       TEXT NOT NULL CHECK (length(item) BETWEEN 1 AND 40),
       checked_at TEXT NOT NULL DEFAULT ${NOW},
       PRIMARY KEY (scope, item)
     ) STRICT`,
  ],
};

/**
 * Codes-barres : base locale des produits reconnus (fiche liée, données
 * Open Food Facts mises en cache) et panier des articles scannés en attente
 * de confirmation, conservé hors ligne.
 */
const migration12: Migration = {
  version: 12,
  name: 'codes-barres',
  statements: [
    `CREATE TABLE barcode_products (
       code       TEXT PRIMARY KEY NOT NULL CHECK (code GLOB '[0-9]*' AND length(code) BETWEEN 8 AND 14),
       item_id    TEXT REFERENCES inventory_items (id) ON DELETE SET NULL,
       status     TEXT NOT NULL CHECK (status IN ('pending', 'found', 'not_found', 'local')),
       data       TEXT CHECK (data IS NULL OR json_valid(data)),
       updated_at TEXT NOT NULL DEFAULT ${NOW}
     ) STRICT`,
    'CREATE INDEX barcode_products_item ON barcode_products (item_id)',
    `CREATE TABLE barcode_basket (
       code       TEXT PRIMARY KEY NOT NULL REFERENCES barcode_products (code) ON DELETE CASCADE,
       count      INTEGER NOT NULL CHECK (count BETWEEN 1 AND 999),
       scanned_at TEXT NOT NULL DEFAULT ${NOW}
     ) STRICT`,
  ],
};

/**
 * Historique des mouvements de stock : entrées, retraits, corrections,
 * périmés jetés et articles supprimés. Le nom et l'unité sont copiés pour
 * que l'historique reste lisible après la suppression d'un article.
 */
const migration13: Migration = {
  version: 13,
  name: 'historique des mouvements',
  statements: [
    `CREATE TABLE stock_movements (
       id         TEXT PRIMARY KEY NOT NULL,
       item_id    TEXT REFERENCES inventory_items (id) ON DELETE SET NULL,
       item_name  TEXT NOT NULL,
       unit       TEXT NOT NULL,
       kind       TEXT NOT NULL CHECK (kind IN ('in', 'out', 'discard', 'correct', 'deleted')),
       quantity   REAL NOT NULL CHECK (quantity <> 0),
       origin     TEXT NOT NULL DEFAULT 'manual' CHECK (origin IN ('manual', 'scan', 'form')),
       created_at TEXT NOT NULL DEFAULT ${NOW}
     ) STRICT`,
    'CREATE INDEX stock_movements_date ON stock_movements (created_at)',
    'CREATE INDEX stock_movements_item ON stock_movements (item_id, created_at)',
  ],
};

/**
 * Data Matrix des médicaments : la péremption et le lot lus dans le code
 * sont gardés avec l'article du panier, pour préremplir le lot ajouté.
 */
const migration14: Migration = {
  version: 14,
  name: 'péremption et lot scannés',
  statements: [
    'ALTER TABLE barcode_basket ADD COLUMN expiration_date TEXT',
    'ALTER TABLE barcode_basket ADD COLUMN lot TEXT',
  ],
};

/**
 * Cartographie hors ligne : les points enregistrés gagnent des types
 * (domicile, regroupement, ravitaillement, autre) ; les tuiles de carte
 * téléchargées et leurs zones sont gardées dans le coffre, pour que la
 * région consultée reste chiffrée. Elles ne vont pas dans les sauvegardes
 * (re-téléchargeables, trop lourdes).
 */
const migration15: Migration = {
  version: 15,
  name: 'cartographie hors ligne',
  statements: [
    `CREATE TABLE poi_locations_new (
       id         TEXT PRIMARY KEY NOT NULL,
       label      TEXT NOT NULL CHECK (length(trim(label)) > 0),
       latitude   REAL NOT NULL CHECK (latitude BETWEEN -90 AND 90),
       longitude  REAL NOT NULL CHECK (longitude BETWEEN -180 AND 180),
       mgrs       TEXT,
       type       TEXT NOT NULL
                  CHECK (type IN ('home', 'meeting', 'water_source', 'shelter',
                                  'resource', 'cache', 'danger', 'other')),
       notes      TEXT,
       created_at TEXT NOT NULL DEFAULT ${NOW},
       updated_at TEXT NOT NULL DEFAULT ${NOW}
     ) STRICT`,
    `INSERT INTO poi_locations_new (id, label, latitude, longitude, mgrs, type,
       notes, created_at, updated_at)
     SELECT id, label, latitude, longitude, mgrs, type, notes, created_at,
       updated_at
     FROM poi_locations`,
    'DROP TABLE poi_locations',
    'ALTER TABLE poi_locations_new RENAME TO poi_locations',
    'CREATE INDEX idx_poi_locations_type ON poi_locations (type)',
    touchTrigger('poi_locations'),

    `CREATE TABLE map_areas (
       id         TEXT PRIMARY KEY NOT NULL,
       label      TEXT NOT NULL CHECK (length(trim(label)) > 0),
       latitude   REAL NOT NULL CHECK (latitude BETWEEN -85.06 AND 85.06),
       longitude  REAL NOT NULL CHECK (longitude BETWEEN -180 AND 180),
       radius_km  REAL NOT NULL CHECK (radius_km > 0 AND radius_km <= 100),
       min_zoom   INTEGER NOT NULL CHECK (min_zoom BETWEEN 0 AND 19),
       max_zoom   INTEGER NOT NULL CHECK (max_zoom BETWEEN min_zoom AND 19),
       source     TEXT NOT NULL CHECK (length(source) BETWEEN 1 AND 30),
       tiles      INTEGER NOT NULL DEFAULT 0 CHECK (tiles >= 0),
       complete   INTEGER NOT NULL DEFAULT 0 CHECK (${isBoolean('complete')}),
       created_at TEXT NOT NULL DEFAULT ${NOW}
     ) STRICT`,
    `CREATE TABLE map_tiles (
       z    INTEGER NOT NULL CHECK (z BETWEEN 0 AND 19),
       x    INTEGER NOT NULL CHECK (x >= 0),
       y    INTEGER NOT NULL CHECK (y >= 0),
       data TEXT NOT NULL CHECK (length(data) > 0),
       PRIMARY KEY (z, x, y)
     ) STRICT`,
  ],
};

/**
 * Synchronisation entre deux téléphones : journal des lignes modifiées.
 *
 * Plutôt qu'un `deleted_at` dans chaque table (qui obligerait à filtrer les
 * lignes supprimées dans toutes les requêtes, fiches et listes), les
 * suppressions restent réelles et laissent une « pierre tombale » dans
 * `sync_rows`. Des triggers notent chaque ajout, modification et
 * suppression des tables partagées ; le code de l'application ne change pas.
 *
 * - `hlc` : horodatage logique hybride attribué à la synchronisation
 *   (NULL = modifié ici, pas encore horodaté).
 * - `dirty_at` : heure de la modification locale.
 * - `is_weapon` : ligne du volet armes (partagée seulement sur option).
 * - `base` : quantité d'un lot au dernier échange, pour additionner les
 *   consommations faites des deux côtés.
 *
 * Pendant l'application d'un lot reçu, `sync_meta.applying` désactive les
 * triggers pour ne pas renvoyer à l'autre téléphone ce qu'il vient d'envoyer.
 *
 * ATTENTION : une migration qui reconstruit une de ces tables (CREATE
 * nouvelle, copie, DROP, RENAME) supprime ses triggers ; il faut les recréer
 * (test « chaque table partagée a ses triggers de synchronisation »).
 */
const SYNC_ITEM_IS_WEAPON = (itemId: string) =>
  `coalesce((SELECT category = 'weapon' FROM inventory_items WHERE id = ${itemId}), 0)`;

const SYNC_SHARED: readonly {
  table: string;
  key: (row: string) => string;
  weapon: (row: string) => string;
  time: string;
  when?: (row: string) => string;
}[] = [
  {
    table: 'settings',
    key: r => `${r}.key`,
    weapon: () => '0',
    time: NOW,
    when: r =>
      `${r}.key IN ('household_members', 'water_liters_per_person_day',
        'kcal_per_person_day', 'target_days', 'wh_per_person_day',
        'energy_devices', 'purchase_plan')`,
  },
  {
    table: 'family_plan',
    key: r => `CAST(${r}.id AS TEXT)`,
    weapon: () => '0',
    time: 'updated_at',
  },
  {
    table: 'preparation_marks',
    key: r => `${r}.scope || char(31) || ${r}.item`,
    weapon: () => '0',
    time: 'checked_at',
  },
  { table: 'bags', key: r => `${r}.id`, weapon: () => '0', time: 'updated_at' },
  {
    table: 'inventory_items',
    key: r => `${r}.id`,
    weapon: r => `(${r}.category = 'weapon')`,
    time: 'updated_at',
  },
  {
    table: 'inventory_lots',
    key: r => `${r}.id`,
    weapon: r => SYNC_ITEM_IS_WEAPON(`${r}.item_id`),
    time: 'updated_at',
  },
  {
    table: 'weapons',
    key: r => `${r}.id`,
    weapon: () => '1',
    time: 'updated_at',
  },
  {
    table: 'documents',
    key: r => `${r}.id`,
    weapon: () => '0',
    time: 'updated_at',
  },
  {
    table: 'photos',
    key: r => `${r}.id`,
    weapon: r =>
      `(${r}.owner_type = 'weapon' OR (${r}.owner_type = 'item' AND ${SYNC_ITEM_IS_WEAPON(
        `${r}.owner_id`,
      )}))`,
    time: 'created_at',
  },
  {
    table: 'barcode_products',
    key: r => `${r}.code`,
    weapon: r => SYNC_ITEM_IS_WEAPON(`${r}.item_id`),
    time: 'updated_at',
  },
  {
    table: 'stock_movements',
    key: r => `${r}.id`,
    weapon: r => SYNC_ITEM_IS_WEAPON(`${r}.item_id`),
    time: 'created_at',
  },
  {
    table: 'poi_locations',
    key: r => `${r}.id`,
    weapon: () => '0',
    time: 'updated_at',
  },
];

const SYNC_NOT_APPLYING =
  "NOT EXISTS (SELECT 1 FROM sync_meta WHERE key = 'applying')";

const syncTriggers = (t: (typeof SYNC_SHARED)[number]): string[] =>
  (
    [
      ['ai', 'INSERT', 'NEW', 0],
      ['au', 'UPDATE', 'NEW', 0],
      ['ad', 'DELETE', 'OLD', 1],
    ] as const
  ).map(
    ([suffix, event, row, deleted]) =>
      `CREATE TRIGGER trg_sync_${t.table}_${suffix} AFTER ${event} ON ${t.table}
       FOR EACH ROW${t.when ? ` WHEN ${t.when(row)}` : ''}
       BEGIN
         INSERT INTO sync_rows (tbl, key, hlc, dirty_at, deleted, is_weapon)
         SELECT '${t.table}', ${t.key(row)}, NULL, ${NOW}, ${deleted},
                ${t.weapon(row)}
          WHERE ${SYNC_NOT_APPLYING}
         ON CONFLICT (tbl, key) DO UPDATE
            SET hlc = NULL, dirty_at = excluded.dirty_at,
                deleted = excluded.deleted,
                is_weapon = max(is_weapon, excluded.is_weapon);
       END`,
  );

const migration16: Migration = {
  version: 16,
  name: 'synchronisation entre téléphones',
  statements: [
    `CREATE TABLE sync_meta (
       key   TEXT PRIMARY KEY NOT NULL,
       value TEXT NOT NULL
     ) STRICT`,
    // Identifiant aléatoire de ce téléphone (départage des horodatages).
    `INSERT INTO sync_meta (key, value)
     VALUES ('device_id', lower(hex(randomblob(8))))`,
    `CREATE TABLE sync_rows (
       tbl       TEXT NOT NULL,
       key       TEXT NOT NULL,
       hlc       TEXT,
       dirty_at  TEXT,
       deleted   INTEGER NOT NULL DEFAULT 0 CHECK (${isBoolean('deleted')}),
       is_weapon INTEGER NOT NULL DEFAULT 0 CHECK (${isBoolean('is_weapon')}),
       base      REAL,
       PRIMARY KEY (tbl, key)
     ) STRICT, WITHOUT ROWID`,
    'CREATE INDEX sync_rows_hlc ON sync_rows (hlc)',
    // Les données déjà présentes partiront à la première synchronisation.
    ...SYNC_SHARED.map(
      t =>
        `INSERT INTO sync_rows (tbl, key, dirty_at, is_weapon)
         SELECT '${t.table}', ${t.key(t.table)}, ${
          t.time === NOW ? NOW : `${t.table}.${t.time}`
        }, ${t.weapon(t.table)}
           FROM ${t.table}${t.when ? ` WHERE ${t.when(t.table)}` : ''}`,
    ),
    ...SYNC_SHARED.flatMap(syncTriggers),
  ],
};

/**
 * Composition du foyer (adultes, enfants, bébés) : les deux nouveaux
 * réglages sont partagés entre les téléphones comme le nombre de personnes.
 */
const SYNC_SETTINGS_17 = {
  ...SYNC_SHARED[0],
  when: (r: string) =>
    `${r}.key IN ('household_members', 'household_children',
      'household_babies', 'water_liters_per_person_day',
      'kcal_per_person_day', 'target_days', 'wh_per_person_day',
      'energy_devices', 'purchase_plan')`,
};

const migration17: Migration = {
  version: 17,
  name: 'composition du foyer',
  statements: [
    'DROP TRIGGER trg_sync_settings_ai',
    'DROP TRIGGER trg_sync_settings_au',
    'DROP TRIGGER trg_sync_settings_ad',
    ...syncTriggers(SYNC_SETTINGS_17),
  ],
};

/**
 * Suivi de synchronisation recréé d'après les données présentes, une ligne
 * par ligne partagée, toutes à la version passée en paramètre (restauration
 * d'une sauvegarde : voir `forgetVersionsAfterRestore`).
 */
export const SYNC_RESEED: readonly string[] = [
  SYNC_SETTINGS_17,
  ...SYNC_SHARED.slice(1),
].map(
  t =>
    `INSERT INTO sync_rows (tbl, key, hlc, is_weapon)
     SELECT '${t.table}', ${t.key(t.table)}, ?, ${t.weapon(t.table)}
       FROM ${t.table}${t.when ? ` WHERE ${t.when(t.table)}` : ''}`,
);

/**
 * Boîtes de rangement étiquetées (QR + numéro, rien d'autre). Une boîte contient des lots :
 * une partie d'un article peut être dans une boîte, le reste ailleurs, sans
 * changer la fiche ni le total du stock.
 */
const migration18: Migration = {
  version: 18,
  name: 'boîtes étiquetées',
  statements: [
    `CREATE TABLE boxes (
       id         TEXT PRIMARY KEY NOT NULL,
       label_no   INTEGER NOT NULL CHECK (label_no > 0),
       created_at TEXT NOT NULL DEFAULT ${NOW},
       updated_at TEXT NOT NULL DEFAULT ${NOW}
     ) STRICT`,
    touchTrigger('boxes'),
    `ALTER TABLE inventory_lots ADD COLUMN box_id TEXT
       REFERENCES boxes (id) ON DELETE SET NULL`,
    'CREATE INDEX idx_inventory_lots_box ON inventory_lots (box_id)',
    ...syncTriggers({
      table: 'boxes',
      key: r => `${r}.id`,
      weapon: () => '0',
      time: 'updated_at',
    }),
  ],
};

export const MIGRATIONS: readonly Migration[] = [
  migration1,
  migration2,
  migration3,
  migration4,
  migration5,
  migration6,
  migration7,
  migration8,
  migration9,
  migration10,
  migration11,
  migration12,
  migration13,
  migration14,
  migration15,
  migration16,
  migration17,
  migration18,
];

export const SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version;
