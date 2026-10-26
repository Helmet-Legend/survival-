import { prepareDatabase } from '../../src/db/connection';
import { InventoryRepository } from '../../src/inventory';
import {
  expandUpcE,
  normalizeBarcode,
  parseGs1,
  readFromScanner,
} from '../../src/scanner/barcode';
import { setMedicineTable } from '../../src/scanner/medicines';
import {
  addScans,
  getProduct,
  linkBarcode,
  listBasket,
  loadOnlineLookup,
  lookupPending,
  lookupProduct,
  nameKey,
  obfUrl,
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
    // Inconnu d'Open Food Facts : Open Beauty Facts est interrogé ensuite.
    expect(fetcher.calls[2]).toBe(obfUrl('96385074'));
    // Plus rien en attente : aucune nouvelle requête.
    await lookupPending(db, fetcher);
    expect(fetcher.calls).toHaveLength(3);
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

const GS = String.fromCharCode(29);
// GTIN-14 d'un médicament (CIP 13 3400930000007 précédé de 0).
const CIP = '3400930000007';

describe('Data Matrix des médicaments', () => {
  it('lit le CIP, la péremption et le lot, dans n’importe quel ordre', () => {
    expect(parseGs1(`010${CIP}17271231103AB45${GS}21XYZ987`)).toEqual({
      code: CIP,
      expiry: '2027-12-31',
      lot: '3AB45',
    });
    expect(parseGs1(`]d2010${CIP}21SER1${GS}10LOT7${GS}17280200`)).toEqual({
      code: CIP,
      expiry: '2028-02-29',
      lot: 'LOT7',
    });
    expect(parseGs1(`${GS}010${CIP}`)).toEqual({ code: CIP });
    // Boîte réelle : série, lot puis péremption (mois seul, jour 00).
    expect(
      parseGs1(`01034009302818572178427771786858${GS}10ABDHD0015${GS}17261100`),
    ).toEqual({
      code: '3400930281857',
      lot: 'ABDHD0015',
      expiry: '2026-11-30',
    });
    // Boîte réelle au code imprimé en blanc sur noir (lu après inversion).
    expect(
      parseGs1(`010340093138414421987808003206${GS}17281231104073`),
    ).toEqual({
      code: '3400931384144',
      expiry: '2028-12-31',
      lot: '4073',
    });
    // Forme lisible renvoyée par certains lecteurs.
    expect(
      parseGs1('(01)03400930281857(21)78427771786858(10)ABDHD0015(17)261130'),
    ).toEqual({
      code: '3400930281857',
      lot: 'ABDHD0015',
      expiry: '2026-11-30',
    });
    expect(parseGs1('texte quelconque')).toBeNull();
    expect(parseGs1('0103400930000001')).toBeNull();
    expect(readFromScanner(`010${CIP}17271231`, 'DATA_MATRIX')).toEqual({
      code: CIP,
      expiry: '2027-12-31',
    });
    expect(readFromScanner('3017620422003', 'EAN_13')).toEqual({
      code: '3017620422003',
    });
    // Étiquette de boîte : reconnue ; autre QR code : ignoré.
    expect(readFromScanner('fenrir:boite:abc-1', 'QR_CODE')).toEqual({
      code: 'fenrir:boite:abc-1',
      box: 'abc-1',
    });
    expect(readFromScanner('https://exemple.fr/promo', 'QR_CODE')).toBeNull();
  });

  it('garde la péremption la plus proche au panier et reconnaît le médicament', async () => {
    setMedicineTable({
      generated: '2026-10-18',
      cip: { [CIP]: 'DOLIPRANE 1000 mg — boîte de 8' },
    });
    try {
      const { db } = await setup();
      await addScans(db, [
        { code: CIP, expiry: '2028-05-31', lot: 'B' },
        { code: CIP, expiry: '2027-03-31', lot: 'A' },
      ]);
      await addScans(db, [{ code: CIP, expiry: '2029-01-31', lot: 'C' }]);
      const [entry] = await listBasket(db);
      expect([entry.count, entry.expiry, entry.lot]).toEqual([
        3,
        '2027-03-31',
        'A',
      ]);
      // Reconnu sans réseau : rien n'est en attente de recherche.
      expect(entry.product).toMatchObject({
        status: 'found',
        data: { name: 'DOLIPRANE 1000 mg — boîte de 8', category: 'medicine' },
      });
      expect(
        prefillFor(entry.product, { expiry: entry.expiry, lot: entry.lot }),
      ).toEqual({
        category: 'medical',
        prefill: {
          subtype: 'medicine',
          name: 'DOLIPRANE 1000 mg — boîte de 8',
          notes: `Code-barres ${CIP} · Lot A`,
          expiry: '31/03/2027',
        },
      });
    } finally {
      setMedicineTable(null);
    }
  });

  it('range l’hygiène trouvée sur Open Beauty Facts dans Santé › Hygiène', async () => {
    const { db } = await setup();
    await addScans(db, ['96385074']);
    const fetcher = fakeFetch({});
    const beauty = async (url: string) =>
      url.includes('openbeautyfacts')
        ? {
            ok: true,
            status: 200,
            json: async () => ({
              status: 1,
              product: { product_name: 'Savon de Marseille' },
            }),
          }
        : fetcher(url, { headers: {} });
    expect(await lookupProduct(db, '96385074', beauty)).toBe('found');
    const product = (await getProduct(db, '96385074'))!;
    expect(product.data.category).toBe('hygiene');
    expect(prefillFor(product)).toMatchObject({
      category: 'medical',
      prefill: { subtype: 'hygiene', name: 'Savon de Marseille' },
    });
    // Choix manuel de la catégorie pour un produit inconnu.
    expect(
      prefillFor({ ...product, data: {} }, { choice: 'tool' }).category,
    ).toBe('tool');
  });
});
