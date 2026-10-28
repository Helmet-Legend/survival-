import { prepareDatabase } from '../../src/db/connection';
import {
  buildPharmacyList,
  LIST_KEY,
  listSettingsError,
  loadListSettings,
  medInfo,
  newListSettings,
  pharmacyListCsv,
  saveListSettings,
  stockSummary,
  stockTable,
  type ListSettings,
} from '../../src/plan/pharmacyList';
import { catalogueMedicaments } from '../../src/plan/pharmacyEngine';
import { NodeSqliteDb } from '../db/sqlite';

const settings = (patch: Partial<ListSettings> = {}): ListSettings => ({
  ...newListSettings(2, 2),
  ...patch,
});

describe('pharmacie familiale', () => {
  it('crée des réglages avec un poids à indiquer par enfant, 30 jours', () => {
    expect(newListSettings(2, 3)).toEqual({
      version: 4,
      adults: 2,
      childWeights: [null, null, null],
      days: 30,
      generated: false,
      have: {},
      checked: [],
    });
  });

  it('chiffre chaque produit et dit ce qui manque', () => {
    const s = settings({
      childWeights: [],
      have: { para_1000: 1, thermometre: 9 },
    });
    const { rows } = stockTable(s);
    const refs = rows.map(r => r.ref);
    for (const ref of [
      'para_1000',
      'ibuprofene_400',
      'racecadotril_adulte',
      'loperamide',
      'diosmectite',
      'antiemetique',
      'cetirizine',
      'garrot',
      'pansement_compressif',
      'compresses',
      'bandes',
      'sutures',
      'serum',
      'gants',
      'savon',
      'thermometre',
      'trousse',
      'couverture',
    ]) {
      expect(refs).toContain(ref);
    }
    // Sans enfant : ni sirop, ni SRO pédiatrique, ni kit nourrisson.
    for (const ref of ['para_ped', 'sro', 'racecadotril_ped', 'mouche_bebe']) {
      expect(refs).not.toContain(ref);
    }
    const para = rows.find(r => r.ref === 'para_1000')!;
    // 8 + 6 × 2 = 20 → 3 boîtes ; 1 en stock → 2 à acheter.
    expect(para.boxes).toBe(3);
    expect(para.missing).toBe(2);
    expect(rows.find(r => r.ref === 'thermometre')!.missing).toBe(0);
    const summary = stockSummary(rows);
    expect(summary.total).toBe(rows.length);
    expect(summary.complete).toBe(1);
    expect(summary.have).toBe(2);
    expect(summary.missing).toBe(summary.boxes - 2);
  });

  it('donne précautions et délivrance tirées du catalogue', () => {
    const info = medInfo(catalogueMedicaments.ibuprofene_400);
    expect(info.caution).toMatch(/privilégier le paracétamol/);
    expect(info.practical).toMatch(/^Sans ordonnance/);
    expect(medInfo(catalogueMedicaments.savon)).toEqual({});
  });

  it('liste à part ce qui se décide avec le pharmacien', () => {
    const ids = (s: ListSettings) => buildPharmacyList(s).map(i => i.id);
    expect(ids(settings())).toEqual(['traitements', 'couches', 'antifongique']);
    expect(ids(settings({ childWeights: [] }))).toEqual([
      'traitements',
      'antifongique',
    ]);
    expect(buildPharmacyList(settings())[0].quantity).toBe(
      '30 jours à prévoir',
    );
    expect(
      buildPharmacyList(settings({ adults: 0, childWeights: [] })),
    ).toEqual([]);
  });

  it.each([
    [{ adults: -1 }, /adultes/],
    [{ childWeights: [1] }, /poids/],
    [{ adults: 0, childWeights: [] }, /au moins une personne/],
    [{ days: 60 }, /Durée/],
    [{ have: { para_1000: -1 } }, /Stock déclaré/],
    [{ have: { para_1000: 1.5 } }, /Stock déclaré/],
    [{ checked: [3] as never }, /cochée/],
  ])('refuse des réglages invalides %#', (patch, expected) => {
    expect(listSettingsError(settings(patch))).toMatch(expected);
  });

  it('garde réglages et stock, reprend les versions précédentes, ignore une valeur abîmée', async () => {
    const db = new NodeSqliteDb();
    await prepareDatabase(db);
    expect(await loadListSettings(db)).toBeNull();
    const s = settings({
      childWeights: [12.5, null],
      days: 45,
      generated: true,
      have: { sro: 2 },
      checked: ['traitements'],
    });
    await saveListSettings(db, s);
    expect(await loadListSettings(db)).toEqual(s);
    await expect(saveListSettings(db, { ...s, adults: 99 })).rejects.toThrow(
      /adultes/,
    );
    const store = (value: unknown) =>
      db.execute('UPDATE settings SET value = ? WHERE key = ?', [
        JSON.stringify(value),
        LIST_KEY,
      ]);
    // Version 1 : nombre d'enfants, durée en mois.
    await store({
      version: 1,
      adults: 2,
      children: 1,
      months: 1,
      generated: true,
      checked: ['gants'],
    });
    expect(await loadListSettings(db)).toEqual({
      version: 4,
      adults: 2,
      childWeights: [null],
      days: 30,
      generated: true,
      have: {},
      checked: ['gants'],
    });
    // Version 3 : mois et marge ; la durée la plus proche est retenue.
    await store({
      version: 3,
      adults: 1,
      childWeights: [20],
      months: 6,
      marginPercent: 25,
      generated: false,
      have: { sro: 1 },
      checked: [],
    });
    expect(await loadListSettings(db)).toMatchObject({
      days: 90,
      have: { sro: 1 },
    });
    await store({ version: 4 });
    expect(await loadListSettings(db)).toBeNull();
  });

  it('exporte le stock, la progression et la liste à décider', () => {
    const csv = pharmacyListCsv(
      settings({
        childWeights: [10, null],
        generated: true,
        have: { para_1000: 1 },
        checked: ['traitements'],
      }),
      '2026-10-27',
    );
    const lines = csv.trim().split('\r\n');
    expect(csv.startsWith('﻿')).toBe(true);
    expect(lines[1]).toBe('2 adulte(s), 2 enfant(s), 30 jours, au 2026-10-27');
    // 20 comprimés pour 30 jours → 3 boîtes ; 1 en stock → 2.
    expect(csv).toMatch(
      /Douleur, fièvre, inflammation;Paracétamol 1000 mg;20 comprimés;3 boîtes;1;2;/,
    );
    expect(csv).toMatch(/Boîtes selon le nombre d’adultes \(30 jours\)/);
    expect(csv).toMatch(/Paracétamol 1000 mg;2;3;4;4;5;6\r\n/);
    expect(csv).toMatch(/Boîtes selon le nombre d’enfants de 10 kg/);
    expect(csv).toMatch(/Traitements habituels;30 jours à prévoir;.*;oui\r\n/);
  });
});
