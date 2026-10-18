/**
 * Produits scannés : base locale (code → fiche du stock, données en cache),
 * panier des articles scannés en attente de confirmation, et recherche en
 * ligne sur Open Food Facts quand l'utilisateur l'a autorisée.
 *
 * Seul le code-barres est envoyé à Open Food Facts : ni le stock, ni les
 * quantités, ni l'identité. Hors ligne, les codes inconnus restent « en
 * attente » et sont recherchés au retour du réseau.
 */
import type { SqlDatabase } from '../db/types';
import type { ItemCategory } from '../inventory';
import { isoToFr } from '../lib/dates';
import type { ScanRead } from './barcode';
import { medicineName } from './medicines';

export type ProductStatus = 'pending' | 'found' | 'not_found' | 'local';

/** Données utiles d'un produit, toutes facultatives. */
export interface ProductData {
  name?: string;
  brand?: string;
  /** Contenance telle qu'affichée sur l'emballage (« 400 g », « 6 x 1,5 l »). */
  quantityLabel?: string;
  /** Contenance unitaire exploitable. */
  netValue?: number;
  netUnit?: 'g' | 'kg' | 'mL' | 'L';
  kcalPer100g?: number;
  /** Nourriture, eau, médicament (base des médicaments) ou hygiène (Open Beauty Facts). */
  category?: 'food' | 'water' | 'medicine' | 'hygiene';
}

export interface BarcodeProduct {
  code: string;
  itemId: string | null;
  status: ProductStatus;
  data: ProductData;
}

export interface BasketEntry {
  code: string;
  count: number;
  product: BarcodeProduct;
  /** Péremption la plus proche lue dans un Data Matrix, `AAAA-MM-JJ`. */
  expiry: string | null;
  lot: string | null;
}

// --- Base locale --------------------------------------------------------------

function toProduct(row: Record<string, unknown>): BarcodeProduct {
  let data: ProductData = {};
  if (row.data !== null && row.data !== undefined) {
    try {
      data = JSON.parse(String(row.data)) as ProductData;
    } catch {
      data = {};
    }
  }
  return {
    code: String(row.code),
    itemId: row.item_id === null ? null : String(row.item_id),
    status: row.status as ProductStatus,
    data,
  };
}

export async function getProduct(
  db: SqlDatabase,
  code: string,
): Promise<BarcodeProduct | null> {
  const { rows } = await db.execute(
    'SELECT code, item_id, status, data FROM barcode_products WHERE code = ?',
    [code],
  );
  return rows.length === 0 ? null : toProduct(rows[0]);
}

/**
 * Ajoute des lectures au panier. Un code jamais vu est enregistré « en
 * attente » de recherche ; un code déjà au panier voit son compte augmenter.
 */
export async function addScans(
  db: SqlDatabase,
  reads: ReadonlyArray<string | ScanRead>,
): Promise<void> {
  // Par code : nombre de lectures et péremption la plus proche (avec son lot).
  const grouped = new Map<
    string,
    { n: number; expiry?: string; lot?: string }
  >();
  for (const read of reads) {
    const r = typeof read === 'string' ? { code: read } : read;
    const g = grouped.get(r.code) ?? { n: 0 };
    g.n++;
    if (r.expiry && (g.expiry === undefined || r.expiry < g.expiry)) {
      g.expiry = r.expiry;
      g.lot = r.lot;
    }
    grouped.set(r.code, g);
  }
  for (const [code, g] of grouped) {
    // Médicament connu de la base embarquée : reconnu sans réseau.
    const medicine = medicineName(code);
    if (medicine !== null) {
      const data = JSON.stringify({ name: medicine, category: 'medicine' });
      await db.execute(
        `INSERT INTO barcode_products (code, status, data) VALUES (?, 'found', ?)
         ON CONFLICT (code) DO UPDATE SET status = 'found', data = excluded.data
           WHERE barcode_products.status = 'pending'`,
        [code, data],
      );
    } else {
      await db.execute(
        `INSERT INTO barcode_products (code, status) VALUES (?, 'pending')
         ON CONFLICT (code) DO NOTHING`,
        [code],
      );
    }
    await db.execute(
      `INSERT INTO barcode_basket (code, count, expiration_date, lot)
       VALUES (?, ?, ?, ?)
       ON CONFLICT (code) DO UPDATE SET
         count = min(999, count + excluded.count),
         expiration_date = CASE
           WHEN excluded.expiration_date IS NOT NULL
            AND (expiration_date IS NULL OR excluded.expiration_date < expiration_date)
           THEN excluded.expiration_date ELSE expiration_date END,
         lot = CASE
           WHEN excluded.expiration_date IS NOT NULL
            AND (expiration_date IS NULL OR excluded.expiration_date < expiration_date)
           THEN excluded.lot ELSE lot END`,
      [code, g.n, g.expiry ?? null, g.lot ?? null],
    );
  }
}

export async function setBasketCount(
  db: SqlDatabase,
  code: string,
  count: number,
): Promise<void> {
  if (count < 1) {
    await removeFromBasket(db, code);
    return;
  }
  await db.execute('UPDATE barcode_basket SET count = ? WHERE code = ?', [
    Math.min(999, Math.floor(count)),
    code,
  ]);
}

export async function removeFromBasket(
  db: SqlDatabase,
  code: string,
): Promise<void> {
  await db.execute('DELETE FROM barcode_basket WHERE code = ?', [code]);
}

export async function listBasket(db: SqlDatabase): Promise<BasketEntry[]> {
  const { rows } = await db.execute(
    `SELECT b.code, b.count, b.expiration_date, b.lot, p.item_id, p.status, p.data
       FROM barcode_basket AS b
       JOIN barcode_products AS p ON p.code = b.code
      ORDER BY b.scanned_at, b.code`,
  );
  return rows.map(r => ({
    code: String(r.code),
    count: Number(r.count),
    product: toProduct(r),
    expiry: r.expiration_date === null ? null : String(r.expiration_date),
    lot: r.lot === null ? null : String(r.lot),
  }));
}

/** Associe un code à une fiche du stock : les prochains scans la retrouvent. */
export async function linkBarcode(
  db: SqlDatabase,
  code: string,
  itemId: string,
): Promise<void> {
  await db.execute(
    `INSERT INTO barcode_products (code, item_id, status) VALUES (?, ?, 'local')
     ON CONFLICT (code) DO UPDATE SET item_id = excluded.item_id,
       updated_at = (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`,
    [code, itemId],
  );
}

/** Codes encore à rechercher (scannés hors ligne ou avant l'accord). */
export async function pendingCodes(db: SqlDatabase): Promise<string[]> {
  const { rows } = await db.execute(
    "SELECT code FROM barcode_products WHERE status = 'pending' AND item_id IS NULL ORDER BY updated_at",
  );
  return rows.map(r => String(r.code));
}

async function saveLookup(
  db: SqlDatabase,
  code: string,
  data: ProductData | null,
): Promise<void> {
  await db.execute(
    `UPDATE barcode_products SET status = ?, data = ?,
       updated_at = (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
     WHERE code = ?`,
    [
      data === null ? 'not_found' : 'found',
      data === null ? null : JSON.stringify(data),
      code,
    ],
  );
}

// --- Accord pour la recherche en ligne -------------------------------------------

const ONLINE_KEY = 'barcode_online';

/** null : pas encore demandé. */
export async function loadOnlineLookup(
  db: SqlDatabase,
): Promise<boolean | null> {
  const { rows } = await db.execute(
    'SELECT value FROM settings WHERE key = ?',
    [ONLINE_KEY],
  );
  if (rows.length === 0) {
    return null;
  }
  return String(rows[0].value) === 'on';
}

export async function saveOnlineLookup(
  db: SqlDatabase,
  allowed: boolean,
): Promise<void> {
  await db.execute(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
    [ONLINE_KEY, allowed ? 'on' : 'off'],
  );
}

// --- Open Food Facts -------------------------------------------------------------

/** Requête HTTP injectable (tests, aperçu). */
export type ProductFetch = (
  url: string,
  init: { headers: Record<string, string> },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

const OFF_FIELDS = [
  'product_name',
  'product_name_fr',
  'brands',
  'quantity',
  'product_quantity',
  'product_quantity_unit',
  'nutriments',
  'categories_tags',
].join(',');

export function offUrl(code: string): string {
  return `https://world.openfoodfacts.org/api/v2/product/${code}.json?fields=${OFF_FIELDS}`;
}

/** Base sœur pour les cosmétiques et produits d'hygiène. */
export function obfUrl(code: string): string {
  return `https://world.openbeautyfacts.org/api/v2/product/${code}.json?fields=${OFF_FIELDS}`;
}

const WATER_TAGS = ['en:waters', 'en:mineral-waters', 'en:spring-waters'];

function positive(value: unknown): number | undefined {
  const n = typeof value === 'string' ? Number(value) : value;
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : undefined;
}

function cleanText(value: unknown, max = 120): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const text = value.replace(/\s+/g, ' ').trim();
  return text === '' ? undefined : text.slice(0, max);
}

/** Extrait d'une réponse Open Food Facts ce que Fenrir sait utiliser. */
export function parseOffProduct(body: unknown): ProductData | null {
  if (typeof body !== 'object' || body === null) {
    return null;
  }
  const { status, product } = body as { status?: unknown; product?: unknown };
  if (status !== 1 || typeof product !== 'object' || product === null) {
    return null;
  }
  const p = product as Record<string, unknown>;
  const data: ProductData = {};
  const name = cleanText(p.product_name_fr) ?? cleanText(p.product_name);
  if (name !== undefined) {
    data.name = name;
  }
  const brand = cleanText(p.brands)?.split(',')[0].trim();
  if (brand) {
    data.brand = brand;
  }
  const quantityLabel = cleanText(p.quantity, 40);
  if (quantityLabel !== undefined) {
    data.quantityLabel = quantityLabel;
  }
  const net = positive(p.product_quantity);
  const unit =
    typeof p.product_quantity_unit === 'string'
      ? p.product_quantity_unit.toLowerCase()
      : 'g';
  if (net !== undefined) {
    if (unit === 'g' || unit === 'kg') {
      data.netValue = net;
      data.netUnit = unit;
    } else if (unit === 'ml') {
      data.netValue = net;
      data.netUnit = 'mL';
    } else if (unit === 'l') {
      data.netValue = net;
      data.netUnit = 'L';
    }
  }
  const nutriments = p.nutriments as Record<string, unknown> | undefined;
  const kcal = positive(nutriments?.['energy-kcal_100g']);
  if (kcal !== undefined && kcal <= 950) {
    data.kcalPer100g = Math.round(kcal);
  }
  const tags = Array.isArray(p.categories_tags) ? p.categories_tags : [];
  data.category = tags.some(t => WATER_TAGS.includes(String(t)))
    ? 'water'
    : 'food';
  return data;
}

export type LookupOutcome = 'found' | 'not_found' | 'offline';

type Answer = ProductData | 'not_found' | 'offline';

async function ask(url: string, fetcher: ProductFetch): Promise<Answer> {
  let response: Awaited<ReturnType<ProductFetch>>;
  try {
    response = await fetcher(url, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'Fenrir/1.0 (application Android de gestion de stocks)',
      },
    });
  } catch {
    return 'offline';
  }
  if (response.status === 404) {
    return 'not_found';
  }
  if (!response.ok) {
    return 'offline';
  }
  try {
    return parseOffProduct(await response.json()) ?? 'not_found';
  } catch {
    return 'offline';
  }
}

/**
 * Recherche un code sur Open Food Facts, puis sur Open Beauty Facts pour
 * l'hygiène, et met le résultat en cache. Une erreur réseau laisse le code
 * en attente.
 */
export async function lookupProduct(
  db: SqlDatabase,
  code: string,
  fetcher: ProductFetch,
): Promise<LookupOutcome> {
  const food = await ask(offUrl(code), fetcher);
  if (food === 'offline') {
    return 'offline';
  }
  if (food !== 'not_found') {
    await saveLookup(db, code, food);
    return 'found';
  }
  const beauty = await ask(obfUrl(code), fetcher);
  if (beauty === 'offline') {
    return 'offline';
  }
  if (beauty === 'not_found') {
    await saveLookup(db, code, null);
    return 'not_found';
  }
  await saveLookup(db, code, {
    ...beauty,
    category: 'hygiene',
    kcalPer100g: undefined,
  });
  return 'found';
}

/** Recherche les codes en attente ; s'arrête à la première panne réseau. */
export async function lookupPending(
  db: SqlDatabase,
  fetcher: ProductFetch,
): Promise<{ looked: number; offline: boolean }> {
  let looked = 0;
  for (const code of await pendingCodes(db)) {
    const outcome = await lookupProduct(db, code, fetcher);
    if (outcome === 'offline') {
      return { looked, offline: true };
    }
    looked++;
  }
  return { looked, offline: false };
}

// --- Préremplissage de la fiche d'ajout ------------------------------------------

function decimal(value: number): string {
  return String(Math.round(value * 1000) / 1000).replace('.', ',');
}

/** Catégories proposées pour un code inconnu, vers les fiches existantes. */
export const CATEGORY_CHOICES = [
  { id: 'food', label: 'Nourriture', category: 'food' },
  { id: 'water', label: 'Eau', category: 'water' },
  {
    id: 'medicine',
    label: 'Médicament',
    category: 'medical',
    subtype: 'medicine',
  },
  { id: 'hygiene', label: 'Hygiène', category: 'medical', subtype: 'hygiene' },
  { id: 'power', label: 'Énergie', category: 'power' },
  { id: 'energy', label: 'Matériel', category: 'energy' },
  { id: 'tool', label: 'Outil', category: 'tool' },
] as const satisfies ReadonlyArray<{
  id: string;
  label: string;
  category: ItemCategory;
  subtype?: string;
}>;
export type CategoryChoice = (typeof CATEGORY_CHOICES)[number]['id'];

/** Choix proposé par défaut pour un produit, d'après ce que l'on en sait. */
export function defaultChoice(product: BarcodeProduct): CategoryChoice {
  const c = product.data.category;
  if (c === 'water' || c === 'medicine' || c === 'hygiene') {
    return c;
  }
  // Code CIP (3400…) : une boîte de médicament.
  return product.code.startsWith('340') ? 'medicine' : 'food';
}

/**
 * Catégorie et valeurs de la fiche d'ajout habituelle. Le nom, la contenance
 * et les calories viennent des données trouvées ; la péremption et le lot,
 * d'un Data Matrix lu au scanner.
 */
export function prefillFor(
  product: BarcodeProduct,
  options: {
    choice?: CategoryChoice;
    expiry?: string | null;
    lot?: string | null;
  } = {},
): {
  category: ItemCategory;
  prefill: Record<string, string>;
} {
  const d = product.data;
  const choiceId = options.choice ?? defaultChoice(product);
  const choice =
    CATEGORY_CHOICES.find(c => c.id === choiceId) ?? CATEGORY_CHOICES[0];
  const category: ItemCategory = choice.category;
  const prefill: Record<string, string> = {};
  if ('subtype' in choice) {
    prefill.subtype = choice.subtype;
  }
  if (d.name) {
    prefill.name =
      d.brand && !d.name.includes(d.brand) ? `${d.name} (${d.brand})` : d.name;
  }
  const notes = [`Code-barres ${product.code}`];
  if (options.lot) {
    notes.push(`Lot ${options.lot}`);
  }
  if (d.quantityLabel) {
    notes.push(`Contenance : ${d.quantityLabel}`);
  }
  prefill.notes = notes.join(' · ');
  if (options.expiry) {
    prefill.expiry = isoToFr(options.expiry);
  }
  if (category === 'food') {
    if (d.netValue !== undefined && (d.netUnit === 'g' || d.netUnit === 'kg')) {
      prefill.unitWeight = decimal(d.netValue);
      prefill.unitWeightUnit = d.netUnit;
    }
    if (d.kcalPer100g !== undefined) {
      prefill.energyValue = String(d.kcalPer100g);
      prefill.energyBasis = 'per100g';
    }
  }
  return { category, prefill };
}

/** Normalise un nom pour repérer un article déjà présent. */
export function nameKey(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}
