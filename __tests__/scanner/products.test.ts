import { prepareDatabase } from '../../src/db/connection';
import { InventoryRepository } from '../../src/inventory';
import { expandUpcE, normalizeBarcode } from '../../src/scanner/barcode';
import {
  addScans,
  getProduct,
  linkBarcode,
  listBasket,
  loadOnlineLookup,
  lookupPending,
  lookupProduct,
  nameKey,
  offUrl,
  parseOffProduct,
  prefillFor,
  removeFromBasket,
  saveOnlineLookup,
  setBasketCount,
  type ProductFetch,
} from '../../src/scanner/products';
import { NodeSqliteDb } from '../db/sqlite';

async function setup() {
  const db = new NodeSqliteDb();
  await prepareDatabase(db);
  return { db, repo: new InventoryRepository(db) };
}

const NUTELLA = '3017620422003';
const OFF_BODY = {
  status: 1,
  product: {
    product_name_fr: 'Lentilles cuisinées',
    brands: 'Cassegrain, Bonduelle',
    quantity: '400 g',
    product_quantity: '400',
    product_quantity_unit: 'g',
    nutriments: { 'energy-kcal_100g': 98.6 },
    categories_tags: ['en:plant-based-foods', 'en:legumes'],
  },
};

function fakeFetch(
  answers: Record<string, { status: number; body?: unknown } | 'offline'>,
): ProductFetch & { calls: string[] } {
  const calls: string[] = [];
  const fetcher = Object.assign(
    async (url: string) => {
      calls.push(url);
      const code = /product\/(\d+)\.json/.exec(url)?.[1] ?? '';
      const answer = answers[code] ?? { status: 404 };
      if (answer === 'offline') {
        throw new Error('Network request failed');
      }
      return {
        ok: answer.status >= 200 && answer.status < 300,
        status: answer.status,
        json: async () => answer.body,
      };
    },
    { calls },
  );
  return fetcher;
}

describe('codes EAN et UPC', () => {
  it('valide la clé de contrôle et ramène à l’EAN-13', () => {
    expect(normalizeBarcode(NUTELLA)).toBe(NUTELLA);
    expect(normalizeBarcode('3017620422004')).toBeNull();
    // UPC-A (12 chiffres) : préfixé d'un zéro.
    expect(normalizeBarcode('036000291452')).toBe('0036000291452');
    // EAN-8 conservé.
    expect(normalizeBarcode('96385074')).toBe('96385074');
    expect(normalizeBarcode('3017 6204-22003')).toBe(NUTELLA);
    expect(normalizeBarcode('abc')).toBeNull();
    expect(normalizeBarcode('123')).toBeNull();
  });

  it('développe un UPC-E', () => {
    expect(expandUpcE('04252614')).toBe('042100005264');
    expect(normalizeBarcode('04252614', 'UPC_E')).toBe('0042100005264');
    expect(normalizeBarcode('04252615', 'UPC_E')).toBeNull();
  });
});

describe('panier et base locale', () => {
  it('compte les lectures répétées et garde le panier', async () => {
    const { db } = await setup();
    await addScans(db, [NUTELLA, NUTELLA, '96385074']);
    await addScans(db, [NUTELLA]);
    const basket = await listBasket(db);
    expect(basket.map(e => [e.code, e.count, e.product.status])).toEqual([
      [NUTELLA, 3, 'pending'],
      ['96385074', 1, 'pending'],
    ]);
    await setBasketCount(db, NUTELLA, 1);
    await setBasketCount(db, '96385074', 0);
    expect((await listBasket(db)).map(e => [e.code, e.count])).toEqual([
      [NUTELLA, 1],
    ]);
    await removeFromBasket(db, NUTELLA);
    expect(await listBasket(db)).toEqual([]);
    // Le produit reste connu après le panier.
    expect((await getProduct(db, NUTELLA))?.status).toBe('pending');
  });

  it('retrouve la fiche associée et l’oublie si elle est supprimée', async () => {
    const { db, repo } = await setup();
    const item = await repo.createItem({
      name: 'Lentilles',
      category: 'food',
      unit: 'unit',
    });
    await linkBarcode(db, NUTELLA, item.id);
    expect((await getProduct(db, NUTELLA))?.itemId).toBe(item.id);
    await repo.deleteItem(item.id);
    expect((await getProduct(db, NUTELLA))?.itemId).toBeNull();
  });

  it('mémorise l’accord pour la recherche en ligne', async () => {
    const { db } = await setup();
    expect(await loadOnlineLookup(db)).toBeNull();
    await saveOnlineLookup(db, false);
    expect(await loadOnlineLookup(db)).toBe(false);
    await saveOnlineLookup(db, true);
    expect(await loadOnlineLookup(db)).toBe(true);
  });
});

describe('Open Food Facts', () => {
  it('extrait nom, marque, contenance, kcal et catégorie', () => {
    expect(parseOffProduct(OFF_BODY)).toEqual({
      name: 'Lentilles cuisinées',
      brand: 'Cassegrain',
      quantityLabel: '400 g',
      netValue: 400,
      netUnit: 'g',
      kcalPer100g: 99,
      category: 'food',
    });
    expect(
      parseOffProduct({
        status: 1,
        product: {
          product_name: 'Eau de source',
          product_quantity: 1.5,
          product_quantity_unit: 'L',
          categories_tags: ['en:beverages', 'en:waters'],
          nutriments: { 'energy-kcal_100g': 5000 },
        },
      }),
    ).toEqual({
      name: 'Eau de source',
      netValue: 1.5,
      netUnit: 'L',
      category: 'water',
    });
    expect(parseOffProduct({ status: 0 })).toBeNull();
    expect(parseOffProduct('n’importe quoi')).toBeNull();
  });

  it('n’envoie que le code-barres et met le résultat en cache', async () => {
    const { db } = await setup();
    await addScans(db, [NUTELLA, '96385074']);
    const fetcher = fakeFetch({ [NUTELLA]: { status: 200, body: OFF_BODY } });
    expect(await lookupPending(db, fetcher)).toEqual({
      looked: 2,
      offline: false,
    });
    expect(fetcher.calls[0]).toBe(offUrl(NUTELLA));
    expect((await getProduct(db, NUTELLA))?.status).toBe('found');
    expect((await getProduct(db, '96385074'))?.status).toBe('not_found');
    // Plus rien en attente : aucune nouvelle requête.
    await lookupPending(db, fetcher);
    expect(fetcher.calls).toHaveLength(2);
  });

  it('garde les codes en attente sans réseau', async () => {
    const { db } = await setup();
    await addScans(db, [NUTELLA]);
    expect(
      await lookupProduct(db, NUTELLA, fakeFetch({ [NUTELLA]: 'offline' })),
    ).toBe('offline');
    expect(
      await lookupProduct(
        db,
        NUTELLA,
        fakeFetch({ [NUTELLA]: { status: 503 } }),
      ),
    ).toBe('offline');
    expect((await getProduct(db, NUTELLA))?.status).toBe('pending');
  });

  it('préremplit la fiche d’ajout habituelle', () => {
    const data = parseOffProduct(OFF_BODY);
    expect(
      prefillFor({ code: NUTELLA, itemId: null, status: 'found', data: data! }),
    ).toEqual({
      category: 'food',
      prefill: {
        name: 'Lentilles cuisinées (Cassegrain)',
        notes: `Code-barres ${NUTELLA} · Contenance : 400 g`,
        unitWeight: '400',
        unitWeightUnit: 'g',
        energyValue: '99',
        energyBasis: 'per100g',
      },
    });
    // Eau : aucune potabilité ni quantité devinée.
    expect(
      prefillFor({
        code: NUTELLA,
        itemId: null,
        status: 'found',
        data: { name: 'Eau', category: 'water', netValue: 1.5, netUnit: 'L' },
      }),
    ).toEqual({
      category: 'water',
      prefill: { name: 'Eau', notes: `Code-barres ${NUTELLA}` },
    });
  });

  it('compare les noms sans accents ni casse', () => {
    expect(nameKey('Pâtes  Complètes !')).toBe(nameKey('pates complètes'));
  });
});
