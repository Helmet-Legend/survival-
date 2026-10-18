import { prepareDatabase } from '../../src/db/connection';
import { searchGuides, syncGuides } from '../../src/db/guides';
import { NodeSqliteDb } from '../db/sqlite';
import { BUNDLED_GUIDES } from '../../src/content/guides';
import {
  F,
  GUIDE_FOLDERS,
  GUIDE_UPDATED,
  readMeta,
} from '../../src/content/fiches/fiche';

const REFLEXES = [
  'alerter-secours',
  'rcp-arret-cardiaque',
  'hemorragie-compression',
  'pls',
  'etouffement',
];

describe('guide embarqué', () => {
  it('a des identifiants uniques et une famille connue pour chaque fiche', () => {
    const slugs = BUNDLED_GUIDES.map(g => g.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const guide of BUNDLED_GUIDES) {
      expect(GUIDE_FOLDERS).toContain(guide.category);
    }
    // Chaque famille a des fiches.
    for (const family of GUIDE_FOLDERS) {
      expect(BUNDLED_GUIDES.some(g => g.category === family)).toBe(true);
    }
  });

  it('donne à chaque fiche sa priorité et sa date, et la relecture en santé', () => {
    for (const guide of BUNDLED_GUIDES) {
      const meta = new Map(readMeta(guide.body).entries);
      expect(['vitale', 'importante', 'utile']).toContain(meta.get('Priorité'));
      expect(meta.get('Mise à jour')).toBe(GUIDE_UPDATED);
      if (guide.category === F.sante && meta.get('Priorité') === 'vitale') {
        expect(meta.get('Relecture')).toMatch(/non relue/);
      }
    }
  });

  it('ne renvoie qu’à des fiches qui existent', () => {
    const titles = new Set(BUNDLED_GUIDES.map(g => g.title));
    for (const guide of BUNDLED_GUIDES) {
      for (const m of guide.body.matchAll(/(?:fiches?|tableau) « ([^»]+) »/g)) {
        expect([guide.slug, titles.has(m[1].trim())]).toEqual([
          guide.slug,
          true,
        ]);
      }
    }
  });

  it('contient les fiches réflexes de l’écran Urgence', () => {
    const slugs = new Set(BUNDLED_GUIDES.map(g => g.slug));
    for (const slug of REFLEXES) {
      expect(slugs.has(slug)).toBe(true);
    }
  });
});

describe('fiche protections balistiques', () => {
  it('se trouve par ses mots-clés et rappelle les limites', async () => {
    const db = new NodeSqliteDb();
    await prepareDatabase(db);
    await syncGuides(db, BUNDLED_GUIDES);
    for (const query of [
      'casque FAST',
      'gilet pare-balles',
      'NIJ',
      'plaque balistique',
    ]) {
      const hits = await searchGuides(db, query);
      expect([query, hits[0]?.slug]).toEqual([
        query,
        'protections-balistiques',
      ]);
    }
    const guide = BUNDLED_GUIDES.find(
      g => g.slug === 'protections-balistiques',
    )!;
    expect(guide.category).toBe('Équipement et protection');
    expect(guide.body).toMatch(/HG1 et HG2.*RF1, RF2 et RF3/);
    expect(guide.body).toMatch(/n’arrête pas tous les calibres/);
    expect(guide.body).toMatch(/§ Mots-clés : balistique/);
  });
});
