import { prepareDatabase } from '../../src/db/connection';
import {
  computeLine,
  durationDays,
  lineFromCatalog,
  loadPharmacyPlan,
  newPlan,
  PHARMACY_CATALOG,
  PHARMACY_KEY,
  pharmacyAlerts,
  pharmacyCsv,
  planError,
  savePharmacyPlan,
  type PharmacyLine,
  type PharmacyPlan,
} from '../../src/plan/pharmacy';
import { NodeSqliteDb } from '../db/sqlite';

const TODAY = '2026-10-27';
const entry = (id: string) => PHARMACY_CATALOG.find(e => e.id === id)!;
const plan4x6 = (lines: PharmacyLine[] = []): PharmacyPlan => ({
  ...newPlan(4),
  duration: { value: 6, unit: 'months' },
  marginPercent: 10,
  lines,
});

describe('durée', () => {
  it('convertit jours, semaines et mois (30 jours)', () => {
    expect(durationDays({ value: 10, unit: 'days' })).toBe(10);
    expect(durationDays({ value: 2, unit: 'weeks' })).toBe(14);
    expect(durationDays({ value: 6, unit: 'months' })).toBe(180);
  });
});

describe('calcul par type de produit', () => {
  it('consommable : quantité par personne et par mois, marge, arrondi au conditionnement', () => {
    const line: PharmacyLine = {
      ...lineFromCatalog(entry('compresses'), 'c'),
      perPersonPerMonth: 2,
      packSize: 25,
    };
    const r = computeLine(line, plan4x6(), TODAY);
    // 2 × 4 personnes × 180 j ÷ 30 = 48, × 1,1 = 52,8 → 53 unités → 3 boîtes de 25.
    expect(r.units).toBe(53);
    expect(r.targetPacks).toBe(3);
    expect(r.toBuyPacks).toBe(3);
    expect(r.missing).toEqual([]);
    expect(r.formula).toMatch(/2 sachet par personne et par mois × 4 personne/);
  });

  it('arrondit exactement sans gonfler un compte rond', () => {
    const line: PharmacyLine = {
      ...lineFromCatalog(entry('gants'), 'g'),
      perPersonPerMonth: 1,
      packSize: 10,
    };
    const r = computeLine(
      line,
      { persons: 1, duration: { value: 30, unit: 'days' }, marginPercent: 0 },
      TODAY,
    );
    expect(r.units).toBe(1);
    expect(r.targetPacks).toBe(1);
  });

  it('médicament occasionnel : boîtes de précaution, sans durée ni marge', () => {
    const line: PharmacyLine = {
      ...lineFromCatalog(entry('paracetamol'), 'p'),
      precautionPacks: 2,
      lots: [{ id: 'l', packs: 1 }],
    };
    const short = computeLine(
      line,
      { persons: 4, duration: { value: 1, unit: 'weeks' }, marginPercent: 50 },
      TODAY,
    );
    const long = computeLine(line, plan4x6(), TODAY);
    expect(short.targetPacks).toBe(2);
    expect(long.targetPacks).toBe(2);
    expect(long.units).toBeNull();
    expect(long.toBuyPacks).toBe(1);
  });

  it('médicament occasionnel : estimation par épisodes, repères du catalogue', () => {
    const line = lineFromCatalog(entry('paracetamol'), 'p');
    expect(line).toMatchObject({
      episodesPerYear: 3,
      unitsPerEpisode: 18,
      packSize: 16,
    });
    const r = computeLine(line, plan4x6(), TODAY);
    // 3 × 4 personnes × 180 j ÷ 365 = 5,92 épisodes × 18 × 1,1 = 117,2 → 118 → 8 boîtes de 16.
    expect(r.units).toBe(118);
    expect(r.targetPacks).toBe(8);
    expect(r.missing).toEqual([]);
    expect(r.formula).toMatch(
      /3 épisode\(s\) par personne et par an × 4 personne/,
    );
    // La durée compte : une semaine pour une personne, sans marge.
    const week = computeLine(
      line,
      { persons: 1, duration: { value: 1, unit: 'weeks' }, marginPercent: 0 },
      TODAY,
    );
    expect(week.units).toBe(2);
    expect(week.targetPacks).toBe(1);
    // Des boîtes choisies à la main remplacent l'estimation.
    expect(
      computeLine({ ...line, precautionPacks: 2 }, plan4x6(), TODAY)
        .targetPacks,
    ).toBe(2);
  });

  it('gastro-entérite : même fréquence pour lopéramide et diosmectite', () => {
    const lop = computeLine(
      lineFromCatalog(entry('loperamide'), 'l'),
      plan4x6(),
      TODAY,
    );
    // 0,33 × 4 × 180 ÷ 365 = 0,65 épisode × 12 × 1,1 = 8,6 → 9 → 1 boîte de 12.
    expect(lop.units).toBe(9);
    expect(lop.targetPacks).toBe(1);
    const dio = computeLine(
      lineFromCatalog(entry('diosmectite'), 'd'),
      plan4x6(),
      TODAY,
    );
    // 0,65 × 21 × 1,1 = 15,04 → 16 → 1 boîte de 18.
    expect(dio.units).toBe(16);
    expect(dio.targetPacks).toBe(1);
  });

  it('traitement prescrit : quantité de l’ordonnance, validation demandée', () => {
    const line: PharmacyLine = {
      ...lineFromCatalog(entry('traitement'), 't'),
      prescribedPerDay: 1,
      packSize: 30,
    };
    const r = computeLine(line, plan4x6(), TODAY);
    // 1 × 1 personne × 180 j × 1,1 = 198 → 7 boîtes de 30.
    expect(r.units).toBe(198);
    expect(r.targetPacks).toBe(7);
    expect(r.needsValidation).toBe(true);
    expect(
      computeLine({ ...line, validated: true }, plan4x6(), TODAY)
        .needsValidation,
    ).toBe(false);
  });

  it('signale les données manquantes au lieu de les inventer', () => {
    const consumable = computeLine(
      lineFromCatalog(entry('pansements'), 'a'),
      plan4x6(),
      TODAY,
    );
    expect(consumable.targetPacks).toBeNull();
    expect(consumable.toBuyPacks).toBeNull();
    expect(consumable.missing).toEqual(['perPersonPerMonth', 'packSize']);
    const occasional = computeLine(
      lineFromCatalog(entry('cetirizine'), 'b'),
      plan4x6(),
      TODAY,
    );
    expect(occasional.missing).toEqual(['precautionPacks', 'packSize']);
    const prescribed = computeLine(
      { ...lineFromCatalog(entry('insuline'), 'c'), packSize: 5 },
      plan4x6(),
      TODAY,
    );
    expect(prescribed.missing).toEqual(['prescribedPerDay']);
  });
});

describe('stock et péremptions', () => {
  const line: PharmacyLine = {
    ...lineFromCatalog(entry('sro'), 's'),
    precautionPacks: 2,
    lots: [
      { id: 'a', packs: 1, expiry: '2026-01-01' },
      { id: 'b', packs: 3, expiry: '2027-03-15' },
    ],
  };

  it('ne compte pas les lots périmés et calcule l’excédent', () => {
    const r = computeLine(line, plan4x6(), TODAY);
    expect(r.availablePacks).toBe(3);
    expect(r.expiredPacks).toBe(1);
    expect(r.toBuyPacks).toBe(0);
    expect(r.surplusPacks).toBe(1);
  });

  it('alerte : périmé, bientôt périmé, périmé avant la fin de la durée', () => {
    const plan = plan4x6([
      line,
      {
        ...lineFromCatalog(entry('macrogol'), 'm'),
        lots: [{ id: 'c', packs: 1, expiry: '2026-12-01' }],
      },
    ]);
    const kinds = pharmacyAlerts(plan, TODAY).map(a => a.kind);
    expect(kinds).toEqual(['expired', 'expiresDuring', 'expiresSoon']);
  });
});

describe('alertes de conservation et de doublons', () => {
  it('signale la chaîne du froid et le même principe actif', () => {
    const plan = plan4x6([
      lineFromCatalog(entry('insuline'), 'i'),
      lineFromCatalog(entry('paracetamol'), 'p1'),
      { ...lineFromCatalog(entry('paracetamol'), 'p2'), name: 'Doliprane' },
    ]);
    const alerts = pharmacyAlerts(plan, TODAY);
    expect(alerts.find(a => a.kind === 'cold')?.lineIds).toEqual(['i']);
    const dup = alerts.find(a => a.kind === 'duplicate');
    expect(dup?.lineIds).toEqual(['p1', 'p2']);
    expect(dup?.message).toMatch(/même principe actif \(paracétamol\)/);
  });

  it('reconnaît un doublon malgré les accents et la casse', () => {
    const plan = plan4x6([
      {
        ...lineFromCatalog(entry('paracetamol'), 'a'),
        ingredient: 'Paracetamol',
      },
      {
        ...lineFromCatalog(entry('paracetamol'), 'b'),
        ingredient: 'paracétamol ',
      },
    ]);
    expect(pharmacyAlerts(plan, TODAY).some(a => a.kind === 'duplicate')).toBe(
      true,
    );
  });
});

describe('données invalides', () => {
  const base = lineFromCatalog(entry('compresses'), 'x');
  it.each([
    [{ ...plan4x6(), persons: 0 }, /personnes/],
    [{ ...plan4x6(), persons: 2.5 }, /personnes/],
    [{ ...plan4x6(), duration: { value: 0, unit: 'days' as const } }, /durée/],
    [
      {
        ...plan4x6(),
        duration: { value: 11, unit: 'months' as const },
        persons: 1,
      },
      null,
    ],
    [{ ...plan4x6(), duration: { value: 40, unit: 'months' as const } }, null],
    [
      { ...plan4x6(), duration: { value: 200, unit: 'months' as const } },
      /durée/,
    ],
    [{ ...plan4x6(), marginPercent: -5 }, /marge/],
    [plan4x6([{ ...base, packSize: 0 }]), /conditionnement/],
    [plan4x6([{ ...base, packSize: 2.5 }]), /conditionnement/],
    [plan4x6([{ ...base, perPersonPerMonth: -1 }]), /par personne/],
    [plan4x6([{ ...base, lots: [{ id: 'l', packs: -2 }] }]), /stock/],
    [
      plan4x6([
        { ...base, lots: [{ id: 'l', packs: 1, expiry: '2026-13-40' }] },
      ]),
      /péremption/,
    ],
    [plan4x6([{ ...base, name: '  ' }]), /nom/],
    [plan4x6([{ ...base, episodesPerYear: -1 }]), /épisodes/],
    [plan4x6([{ ...base, unitsPerEpisode: -3 }]), /par épisode/],
  ])('refuse ou accepte %#', (plan, expected) => {
    const error = planError(plan as PharmacyPlan);
    if (expected === null) {
      expect(error).toBeNull();
    } else {
      expect(error).toMatch(expected);
    }
  });
});

describe('enregistrement', () => {
  it('garde le plan après fermeture du coffre et refuse un plan invalide', async () => {
    const db = new NodeSqliteDb();
    await prepareDatabase(db);
    expect(await loadPharmacyPlan(db)).toBeNull();
    const plan = plan4x6([
      {
        ...lineFromCatalog(entry('compresses'), 'c'),
        perPersonPerMonth: 2,
        packSize: 25,
        lots: [{ id: 'l', packs: 1, expiry: '2028-03-01' }],
      },
    ]);
    await savePharmacyPlan(db, plan);
    expect(await loadPharmacyPlan(db)).toEqual(plan);
    await expect(
      savePharmacyPlan(db, { ...plan, persons: -1 }),
    ).rejects.toThrow(/personnes/);
    // Valeur abîmée : ignorée plutôt que de faire planter l'écran.
    await db.execute('UPDATE settings SET value = ? WHERE key = ?', [
      '{"version":1,"lines":"x"}',
      PHARMACY_KEY,
    ]);
    expect(await loadPharmacyPlan(db)).toBeNull();
  });
});

describe('export tableur', () => {
  it('écrit les hypothèses puis une ligne par produit', () => {
    const csv = pharmacyCsv(
      plan4x6([
        {
          ...lineFromCatalog(entry('paracetamol'), 'p'),
          precautionPacks: 2,
          lots: [{ id: 'l', packs: 1, expiry: '2027-05-01' }],
        },
        lineFromCatalog(entry('pansements'), 'q'),
      ]),
      TODAY,
    );
    expect(csv.startsWith('﻿')).toBe(true);
    const lines = csv.trim().split('\r\n');
    expect(lines[1]).toMatch(/4 personne\(s\), 6 mois \(180 j\), marge 10 %/);
    expect(lines[4]).toMatch(
      /^Paracétamol 500 mg;paracétamol;Douleur, fièvre;Médicament occasionnel;comprimé;16;2;1;0;1;2027-05-01;/,
    );
    expect(lines[4]).toMatch(/Sans ordonnance;ANSM/);
    expect(lines[5]).toMatch(
      /Quantité par personne et par mois à indiquer · Nombre d’unités par conditionnement à indiquer$/,
    );
  });
});
