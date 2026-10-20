import { prepareDatabase } from '../../src/db/connection';
import { BagRepository, InventoryRepository } from '../../src/inventory';
import {
  gearCsv,
  gearHtml,
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
    // Les coches de cette liste ne touchent pas celles des check-lists.
    expect((await loadMarks(db, 'home')).size).toBe(0);

    const csv = gearCsv(report);
    expect(
      csv.startsWith('﻿Famille;Matériel;Statut;Dans le stock;Conseil\r\n'),
    ).toBe(true);
    expect(csv).toContain('Eau;Filtre à eau;Dans le stock;Paille filtrante;');
    expect(csv).toContain('Argent liquide;Je l’ai;');
    expect(csv).toContain('Éclairage et énergie;Piles de rechange;À prévoir;;');

    const html = gearHtml(report, '15/10/2026');
    expect(html).toContain('<h2>Outils</h2>');
    expect(html).toContain('Dans le stock : Couteau suisse');
    expect(html).not.toContain('Couteau de chasse');
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
    });
    const html = gearHtml(report, '15/10/2026');
    expect(html).toContain('Lampe &lt;b&gt;&quot;X&quot;&lt;/b&gt; &amp; co');
    expect(html).toContain('2 dans le dossier Documents');
  });
});
