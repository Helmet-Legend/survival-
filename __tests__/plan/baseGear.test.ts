import { prepareDatabase } from '../../src/db/connection';
import { BagRepository, InventoryRepository } from '../../src/inventory';
import {
  gearCsv,
  gearHtml,
  GEAR_REFS,
  GEAR_SECTIONS,
  gearRefsLabel,
  SHOW_WEAPONS_MARK,
  getBaseGear,
  setGearMark,
} from '../../src/plan/baseGear';
import { loadMarks } from '../../src/plan/preparation';
import { NodeSqliteDb } from '../db/sqlite';

const TODAY = '2026-10-15';

async function setup() {
  const db = new NodeSqliteDb();
  await prepareDatabase(db);
  const repo = new InventoryRepository(db, { today: () => TODAY });
  const bags = new BagRepository(db, { today: () => TODAY });
  return { db, repo, bags };
}

describe('matériel de base', () => {
  it('reconnaît le stock (maison et sacs) et les coches à la main', async () => {
    const { db, repo, bags } = await setup();
    await repo.createItem(
      { name: 'Eau', category: 'water', unit: 'L' },
      { quantity: 12 },
    );
    await repo.createItem(
      {
        name: 'Paille filtrante',
        category: 'tool',
        unit: 'unit',
      },
      { quantity: 1 },
    );
    const bag = await bags.create({ name: 'Sac de Paul' });
    await repo.createItem(
      { name: 'Couteau suisse', category: 'tool', unit: 'unit', bagId: bag.id },
      { quantity: 1 },
    );
    // Périmé : ne compte pas.
    await repo.createItem(
      { name: 'Piles AA', category: 'power', unit: 'unit', subtype: 'battery' },
      { quantity: 4, expirationDate: '2026-01-01', acquiredAt: '2025-01-01' },
    );
    // Une arme ne compte jamais comme outil.
    await repo.createItem(
      { name: 'Couteau de chasse', category: 'weapon', unit: 'unit' },
      { quantity: 1 },
    );
    await setGearMark(db, 'cash', true);

    const report = await getBaseGear(db, {
      items: await repo.listItems(),
      documentCount: 0,
      bagNames: ['Sac de Paul'],
      weaponCount: 0,
    });
    const by = Object.fromEntries(
      report.results.map(r => [r.definition.id, r]),
    );
    expect(by.water_reserve.status).toBe('stock');
    expect(by.water_reserve.detail).toBe('Eau');
    expect(by.water_filter.detail).toBe('Paille filtrante');
    expect(by.knife.detail).toBe('Couteau suisse');
    expect(by.batteries.status).toBe('missing');
    expect(by.cash.status).toBe('checked');
    expect(by.bag.detail).toBe('Sac de Paul');
    expect(by.documents.status).toBe('missing');
    expect(report.have).toBe(
      report.results.filter(r => r.status !== 'missing').length,
    );
    // Argent liquide et double des clés : coches communes avec le kit 72 h
    // de la maison, que lit l’indice de préparation.
    expect([...(await loadMarks(db, 'home'))]).toEqual(['cash']);
    expect((await loadMarks(db, 'gear')).size).toBe(0);

    const csv = gearCsv(report);
    expect(
      csv.startsWith(
        '﻿Famille;Matériel;Statut;Dans le stock;Conseil;Source\r\n',
      ),
    ).toBe(true);
    expect(csv).toContain(
      'Eau;Filtre à eau;Dans le stock;Paille filtrante;;Conseil courant, hors listes officielles',
    );
    expect(csv).toContain(
      'Argent liquide;Je l’ai;;Les paiements par carte peuvent être coupés.;SGDSN, Géorisques, Canada, Belgique',
    );
    expect(csv).toContain(
      'Éclairage et énergie;Piles de rechange;À prévoir;;;SGDSN, Géorisques, Ready.gov, Canada, Belgique',
    );

    const html = gearHtml(report, '15/10/2026');
    expect(html).toContain('<h2>Outils</h2>');
    expect(html).toContain('Dans le stock : Couteau suisse');
    expect(html).not.toContain('Couteau de chasse');
    expect(html).toContain('<td class="src">Conseil courant</td>');
    expect(html).toContain('Sources : Guide « Tous responsables');
  });

  it('échappe les noms dans la page imprimable', async () => {
    const { db, repo } = await setup();
    await repo.createItem(
      {
        name: 'Lampe <b>"X"</b> & co',
        category: 'energy',
        unit: 'unit',
        subtype: 'lighting',
      },
      { quantity: 1 },
    );
    const report = await getBaseGear(db, {
      items: await repo.listItems(),
      documentCount: 2,
      bagNames: [],
      weaponCount: 0,
    });
    const html = gearHtml(report, '15/10/2026');
    expect(html).toContain('Lampe &lt;b&gt;&quot;X&quot;&lt;/b&gt; &amp; co');
    expect(html).toContain('2 dans le dossier Documents');
  });

  it('cite une liste officielle pour chaque élément, sauf les conseils courants', () => {
    const all = GEAR_SECTIONS.flatMap(section => section.items);
    const ids = all.map(g => g.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const gear of all) {
      expect(gear.refs.every(ref => ref in GEAR_REFS)).toBe(true);
    }
    expect(all.filter(g => g.refs.length === 0).map(g => g.id)).toEqual([
      'water_filter',
      'cookware',
      'compass',
      'rope',
      'weapon_lock',
      'ammo',
      'magazines',
      'cleaning',
      'weapon_case',
      'shooting_protection',
      'weapon_papers',
      'tourniquet',
    ]);
    expect(gearRefsLabel(all.find(g => g.id === 'keys')!)).toBe(
      'SGDSN, Géorisques, Canada',
    );
  });

  it('ajoute le volet armes sans rien en citer dans les exports', async () => {
    const { db, repo } = await setup();
    await repo.createItem(
      {
        name: 'Federal 9 mm',
        category: 'weapon',
        unit: 'unit',
        caliber: '9x19',
        attributes: { recordType: 'ammo' },
      },
      { quantity: 50 },
    );
    await repo.createItem(
      {
        name: 'Kit Otis',
        category: 'weapon',
        unit: 'unit',
        subtype: 'cleaning',
        attributes: { recordType: 'accessory' },
      },
      { quantity: 1 },
    );
    // Faux amis : rien de tout cela ne coche un autre élément.
    for (const name of [
      'Huile d’olive',
      'Lentilles vertes',
      'Sac de couchage',
    ]) {
      await repo.createItem(
        { name, category: 'food', unit: 'kg' },
        { quantity: 1 },
      );
    }
    const items = await repo.listItems();
    const base = { items, documentCount: 0, bagNames: [] };

    const without = await getBaseGear(db, { ...base, weaponCount: 0 });
    expect(without.weapons).toBe(false);
    expect(without.weaponsOptional).toBe(true);
    expect(without.results.some(r => r.section.weapons)).toBe(false);
    expect(gearHtml(without, '15/10/2026')).not.toContain(
      'sécurité intérieure',
    );

    // Sur demande, sans arme enregistrée.
    await setGearMark(db, SHOW_WEAPONS_MARK, true);
    expect((await getBaseGear(db, { ...base, weaponCount: 0 })).weapons).toBe(
      true,
    );
    await setGearMark(db, SHOW_WEAPONS_MARK, false);

    const report = await getBaseGear(db, { ...base, weaponCount: 1 });
    expect(report.weaponsOptional).toBe(false);
    const by = Object.fromEntries(
      report.results.map(r => [r.definition.id, r]),
    );
    expect(by.ammo.detail).toBe('Federal 9 mm');
    expect(by.cleaning.detail).toBe('Kit Otis');
    expect(by.magazines.status).toBe('missing');
    expect(by.weapon_safe.status).toBe('missing');
    expect(by.powerbank.status).toBe('missing');
    expect(by.glasses.status).toBe('missing');
    expect(by.baby.status).toBe('missing');

    const csv = gearCsv(report);
    expect(csv).toContain(
      'Armes (si vous en détenez);Munitions adaptées à vos armes;Dans le stock;;',
    );
    expect(csv).not.toContain('Federal');
    expect(csv).not.toContain('Otis');
    const html = gearHtml(report, '15/10/2026');
    expect(html).not.toContain('Federal');
    expect(html).toContain('Code de la sécurité intérieure');
  });

  it('compte l’eau et les vivres en jours selon le palier', async () => {
    const { db, repo } = await setup();
    const report = await getBaseGear(db, {
      items: await repo.listItems(),
      documentCount: 0,
      bagNames: [],
      weaponCount: 0,
      autonomy: { days: 7, water: 10, food: 4 },
    });
    const by = Object.fromEntries(
      report.results.map(r => [r.definition.id, r]),
    );
    expect(by.water_reserve).toMatchObject({
      status: 'stock',
      detail: '10 j sur 7',
      counted: true,
    });
    expect(by.food).toMatchObject({ status: 'missing', detail: '4 j sur 7' });
    expect(report.essentialTotal).toBe(
      report.results.filter(r => r.definition.refs.includes('sgdsn')).length,
    );
    expect(report.essentialHave).toBe(1);
    expect(gearCsv(report)).toContain(
      'Alimentation;Vivres non périssables;À prévoir;4 j sur 7;',
    );
  });
});
