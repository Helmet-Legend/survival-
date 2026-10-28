import {
  boxesByAdults,
  boxesByChildren,
  calculerDotationRealiste,
  catalogueMedicaments,
  computeStock,
  formatBoxes,
  formatQuantity,
  householdError,
  profile,
  TIME_COEFF,
  type Household,
} from '../../src/plan/pharmacyEngine';

/** Foyer test : 2 adultes, enfants de 20 et 30 kg, nourrisson de 10 kg. */
const test5 = (patch: Partial<Household> = {}): Household => ({
  adults: 2,
  childWeights: [20, 30, 10],
  days: 30,
  ...patch,
});
const boxes = (h: Household, ref: string) =>
  computeStock(h).meds.find(m => m.ref === ref)?.boxes;

describe('dotation médicale du foyer (modèle de mutualisation)', () => {
  it('applique la formule réaliste du correctif', () => {
    // Paracétamol 1000 mg : socle 8 + 6 par adulte, boîte de 8, 2 adultes.
    const para = (days: number) =>
      calculerDotationRealiste(8, 6, 2, days, false, 8);
    expect([15, 30, 45, 90].map(para)).toEqual([2, 3, 3, 4]);
    expect(calculerDotationRealiste(8, 6, 0, 30, false, 8)).toBe(0);
    // Invariant : la durée ne compte pas.
    expect(calculerDotationRealiste(1, 0.4, 5, 90, true, 1)).toBe(3);
    expect(TIME_COEFF).toEqual({ 15: 0.8, 30: 1, 45: 1.15, 90: 1.5 });
  });

  it('donne les mêmes chiffres dans le moteur pour 2 adultes', () => {
    for (const [days, n] of [
      [15, 2],
      [30, 3],
      [45, 3],
      [90, 4],
    ]) {
      expect(boxes({ adults: 2, childWeights: [], days }, 'para_1000')).toBe(n);
    }
  });

  it('reclasse par le poids : 40 kg et plus → formes adultes, moins de 15 kg → bas âge', () => {
    const p = profile(test5({ childWeights: [20, 30, 10, 45, null] }));
    expect(p).toMatchObject({
      A: 3,
      E: 3,
      B: 1,
      N: 7,
      enfantsSirop: 2,
      enfants500: 1,
      missingWeights: 1,
    });
  });

  it('calcule la dotation de 30 jours du foyer test', () => {
    const h = test5();
    // Socle 8 + 6 × 2 = 20 comprimés → 3 boîtes de 8.
    expect(boxes(h, 'para_1000')).toBe(3);
    // 0,8 flacon × 2 enfants de moins de 25 kg = 1,6 → 2 flacons.
    expect(boxes(h, 'para_ped')).toBe(2);
    // 10 gélules par enfant de 25 à 40 kg → 1 boîte de 16.
    expect(boxes(h, 'para_500')).toBe(1);
    // SRO pédiatrique : 10 × 1 + 3 × 2 = 16 → 2 boîtes de 10.
    expect(boxes(h, 'sro')).toBe(2);
    expect(boxes({ adults: 2, childWeights: [], days: 30 }, 'sro')).toBe(
      undefined,
    );
    // Sérum : 15 × 5 + 60 × 1 = 135 → 4 boîtes de 40.
    expect(boxes(h, 'serum')).toBe(4);
    // 1 + 0,25 × 5 = 2,25 → 3 garrots, quelle que soit la durée.
    expect(boxes(h, 'garrot')).toBe(3);
    expect(boxes(test5({ days: 90 }), 'garrot')).toBe(3);
    // 20 + 8 × 5 = 60 compresses → 2 boîtes de 50.
    expect(boxes(h, 'compresses')).toBe(2);
    // Sutures invariantes : 2 + 0,5 × 5 = 4,5 → 5.
    expect(boxes(test5({ days: 90 }), 'sutures')).toBe(5);
    expect(computeStock(h).pharmacyVisits).toBe(3);
  });

  it('amortit la durée : 90 jours ≈ 1,5 fois 30 jours', () => {
    // Sérum : 135 × 1,5 = 202,5 → 6 boîtes ; 15 jours : 108 → 3.
    expect(boxes(test5({ days: 90 }), 'serum')).toBe(6);
    expect(boxes(test5({ days: 15 }), 'serum')).toBe(3);
  });

  it('paracétamol enfant : sirop sous 25 kg, 500 mg de 25 à 40 kg', () => {
    const kids = (days: number) =>
      test5({ adults: 0, childWeights: [10, 18, 30], days });
    // 0,8 × 2 = 1,6 → 2 flacons ; × 1,5 = 2,4 → 3.
    expect(boxes(kids(30), 'para_ped')).toBe(2);
    expect(boxes(kids(90), 'para_ped')).toBe(3);
    // 10 gélules ; × 1,5 = 15 → 1 boîte de 16.
    expect(boxes(kids(30), 'para_500')).toBe(1);
    expect(boxes(kids(90), 'para_500')).toBe(1);
    // Pas d'enfant de 25 à 40 kg : pas de 500 mg.
    expect(boxes(test5({ childWeights: [20] }), 'para_500')).toBeUndefined();
  });

  it('verrous nourrisson : kit ajouté, lopéramide et diosmectite jamais pour lui', () => {
    expect(computeStock(test5()).infant).toBe(true);
    for (const ref of ['thermometre_rectal', 'mouche_bebe', 'pince_fine']) {
      expect(boxes(test5(), ref)).toBe(1);
      expect(boxes(test5({ childWeights: [20] }), ref)).toBeUndefined();
    }
    const baby = test5({ adults: 0, childWeights: [8] });
    expect(boxes(baby, 'loperamide')).toBeUndefined();
    expect(boxes(baby, 'diosmectite')).toBeUndefined();
    expect(boxes(baby, 'racecadotril_ped')).toBe(1);
  });

  it('garde le matériel fixe et une couverture par personne', () => {
    const big = test5({ adults: 6, days: 90 });
    expect(boxes(big, 'thermometre')).toBe(1);
    expect(boxes(big, 'trousse')).toBe(1);
    expect(boxes(big, 'couverture')).toBe(9);
  });

  it('donne la progression selon le nombre d’adultes et d’enfants', () => {
    const adults = boxesByAdults({ days: 30 });
    // ⌈(8 + 6 n) ÷ 8⌉.
    expect(adults.find(r => r.ref === 'para_1000')!.boxes).toEqual([
      2, 3, 4, 4, 5, 6,
    ]);
    // ⌈1 + 0,25 n⌉.
    expect(adults.find(r => r.ref === 'garrot')!.boxes).toEqual([
      2, 2, 2, 2, 3, 3,
    ]);
    const kids = boxesByChildren({ days: 30 }, 20);
    // 0,8 flacon par enfant de moins de 25 kg.
    expect(kids.find(r => r.ref === 'para_ped')!.boxes).toEqual([
      1, 2, 3, 4, 4, 5,
    ]);
    expect(kids.find(r => r.ref === 'para_1000')).toBeUndefined();
  });

  it('marque les repères non sourcés et les formes sur ordonnance', () => {
    const para = computeStock(test5()).meds.find(m => m.ref === 'para_1000')!;
    expect(para.sourced).toBe(false);
    expect(para.sources[0]).toMatch(/non sourcé/);
    expect(para.from[0]).toBe(
      '8 comprimés pour le foyer + 6 par adulte pour 30 jours',
    );
    expect(catalogueMedicaments.racecadotril_ped.note).toMatch(/ordonnance/);
  });

  it.each([
    [{ adults: -1 }, /adultes/],
    [{ adults: 0, childWeights: [] }, /au moins une personne/],
    [{ childWeights: [1] }, /poids/],
    [{ days: 60 }, /Durée/],
  ])('refuse des réglages invalides %#', (patch, expected) => {
    expect(householdError(test5(patch))).toMatch(expected);
  });

  it('formate quantités et conditionnements en français', () => {
    expect(formatQuantity(5400, ['mg', 'mg'])).toMatch(/^5\s400 mg$/u);
    expect(formatBoxes(1, catalogueMedicaments.para_ped)).toBe(
      '1 flacon de 100 ml',
    );
    expect(formatQuantity(1, ['sachet', 'sachets'])).toBe('1 sachet');
    expect(formatBoxes(2, catalogueMedicaments.para_ped)).toBe(
      '2 flacons de 100 ml',
    );
    expect(formatBoxes(1, catalogueMedicaments.para_1000)).toBe('1 boîte');
  });
});
