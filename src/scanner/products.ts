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
  category?: 'food' | 'water';
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
  codes: readonly string[],
): Promise<void> {
  const counts = new Map<string, number>();
  for (const code of codes) {
    counts.set(code, (counts.get(code) ?? 0) + 1);
  }
  for (const [code, n] of counts) {
    await db.execute(
      `INSERT INTO barcode_products (code, status) VALUES (?, 'pending')
       ON CONFLICT (code) DO NOTHING`,
      [code],
    );
    await db.execute(
      `INSERT INTO barcode_basket (code, count) VALUES (?, ?)
       ON CONFLICT (code) DO UPDATE SET count = min(999, count + excluded.count)`,
      [code, n],
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
    `SELECT b.code, b.count, p.item_id, p.status, p.data
       FROM barcode_basket AS b
       JOIN barcode_products AS p ON p.code = b.code
      ORDER BY b.scanned_at, b.code`,
  );
  return rows.map(r => ({
    code: String(r.code),
    count: Number(r.count),
    product: toProduct(r),
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

/**
 * Recherche un code sur Open Food Facts et met le résultat en cache. Une
 * erreur réseau laisse le code en attente.
 */
export async function lookupProduct(
  db: SqlDatabase,
  code: string,
  fetcher: ProductFetch,
): Promise<LookupOutcome> {
  let response: Awaited<ReturnType<ProductFetch>>;
  try {
    response = await fetcher(offUrl(code), {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'Fenrir/1.0 (application Android de gestion de stocks)',
      },
    });
  } catch {
    return 'offline';
  }
  if (response.status === 404) {
    await saveLookup(db, code, null);
    return 'not_found';
  }
  if (!response.ok) {
    return 'offline';
  }
  let data: ProductData | null;
  try {
    data = parseOffProduct(await response.json());
  } catch {
    return 'offline';
  }
  await saveLookup(db, code, data);
  return data === null ? 'not_found' : 'found';
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

/** Catégorie et valeurs de la fiche d'ajout habituelle. */
export function prefillFor(product: BarcodeProduct): {
  category: ItemCategory;
  prefill: Record<string, string>;
} {
  const d = product.data;
  const category: ItemCategory = d.category === 'water' ? 'water' : 'food';
  const prefill: Record<string, string> = {};
  if (d.name) {
    prefill.name =
      d.brand && !d.name.includes(d.brand) ? `${d.name} (${d.brand})` : d.name;
  }
  const notes = [`Code-barres ${product.code}`];
  if (d.quantityLabel) {
    notes.push(`Contenance : ${d.quantityLabel}`);
  }
  prefill.notes = notes.join(' · ');
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
