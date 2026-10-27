import { RESUMES } from '../../src/content/fiches/resumes';
import {
  ficheInfo,
  GUIDE_CHECKED,
  needsReview,
  RELIABILITY_LABELS,
} from '../../src/content/fiches/fiche';
import { prepareDatabase } from '../../src/db/connection';
import { searchGuides, syncGuides } from '../../src/db/guides';
import { NodeSqliteDb } from '../db/sqlite';
import { BUNDLED_GUIDES } from '../../src/content/guides';
import {
  F,
  ficheLayout,
  ficheSources,
  GUIDE_FOLDERS,
  GUIDE_UPDATED,
  imageCard,
  readMeta,
  WEB,
} from '../../src/content/fiches/fiche';
import { GUIDE_IMAGES } from '../../src/ui/guideImages';
import { CRISES } from '../../src/plan/crisis';

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

describe('fiches harmonisées', () => {
  it('donne à chaque fiche un résumé rédigé, une durée et une fiabilité', () => {
    const slugs = new Set(BUNDLED_GUIDES.map(g => g.slug));
    expect(Object.keys(RESUMES).filter(s => !slugs.has(s))).toEqual([]);
    for (const guide of BUNDLED_GUIDES) {
      const info = ficheInfo(guide.body);
      expect([guide.slug, info.summary]).toEqual([
        guide.slug,
        RESUMES[guide.slug],
      ]);
      expect([guide.slug, info.summary!.length <= 200]).toEqual([
        guide.slug,
        true,
      ]);
      expect(info.minutes).toBeGreaterThanOrEqual(1);
      expect(info.reliability).toBeTruthy();
      expect(info.checked).toBe(GUIDE_CHECKED);
    }
    const sante = BUNDLED_GUIDES.find(g => g.slug === 'garrot')!;
    expect(ficheInfo(sante.body).reliability).toBe(RELIABILITY_LABELS.sante);
  });

  it('signale une fiche à revoir après douze mois', () => {
    expect(needsReview('2026-10', '2026-10-18')).toBe(false);
    expect(needsReview('2026-10', '2027-09-30')).toBe(false);
    expect(needsReview('2026-10', '2027-10-01')).toBe(true);
    expect(needsReview(null, '2026-10-18')).toBe(true);
  });
});

describe('lecteur en blocs', () => {
  const crisisIds = new Set(CRISES.map(c => c.id));

  it('répartit priorités, onglets, interdits et liens', () => {
    const guide = BUNDLED_GUIDES.find(g => g.slug === 'coupure-eau')!;
    const layout = ficheLayout(guide.body);
    expect(layout.priorities).toHaveLength(3);
    expect(layout.phases.map(p => p.phase)).toEqual([
      'Avant',
      'Pendant',
      'Après',
    ]);
    expect(layout.donts).toHaveLength(3);
    expect(layout.links).toEqual([
      { kind: 'waterStock' },
      { kind: 'crisis', scenario: 'waterCut' },
      { kind: 'localRisks' },
    ]);
    // Aucun repère ni métadonnée ne reste dans le texte affiché.
    const shown = [...layout.intro, ...layout.phases.flatMap(p => p.lines)];
    expect(shown.filter(l => /^(★|✕|→|§|# )/.test(l))).toEqual([]);
    expect(ficheSources(guide.body).map(s => s.url)).toEqual([
      WEB.ars.url,
      WEB.tousResponsables.url,
    ]);
  });

  it('laisse les fiches sans repères d’un seul tenant', () => {
    const guide = BUNDLED_GUIDES.find(g => g.slug === 'morse')!;
    const layout = ficheLayout(guide.body);
    expect(layout.phases).toEqual([]);
    expect(layout.priorities).toEqual([]);
    expect(layout.intro.length).toBeGreaterThan(0);
  });

  it('ne cite que des scénarios, des adresses et des mois valides', () => {
    for (const guide of BUNDLED_GUIDES) {
      for (const link of ficheLayout(guide.body).links) {
        if (link.kind === 'crisis') {
          expect([guide.slug, crisisIds.has(link.scenario)]).toEqual([
            guide.slug,
            true,
          ]);
        }
      }
      for (const source of ficheSources(guide.body)) {
        expect(source.url).toMatch(/^https:\/\/[a-z0-9.-]+\.[a-z]{2,}/);
        expect(source.consulted).toMatch(/^\d{4}-(0[1-9]|1[0-2])$/);
      }
      expect(guide.body.split('\n').filter(l => /^→ /.test(l))).toHaveLength(
        ficheLayout(guide.body).links.length,
      );
    }
  });
});

describe('fiches santé illustrées', () => {
  it('n’appelle que des illustrations embarquées', () => {
    const used = new Set<string>();
    for (const guide of BUNDLED_GUIDES) {
      for (const line of guide.body.split('\n')) {
        const card = imageCard(line);
        if (line.startsWith('▣ ')) {
          expect([guide.slug, card !== null]).toEqual([guide.slug, true]);
          expect([card!.image, card!.image in GUIDE_IMAGES]).toEqual([
            card!.image,
            true,
          ]);
          used.add(card!.image);
        }
      }
    }
    // Aucune image embarquée pour rien.
    expect(Object.keys(GUIDE_IMAGES).filter(k => !used.has(k))).toEqual([]);
  });

  it('garde les deux fiches de fermeture, chacune renvoyant à l’autre', () => {
    const plaies = BUNDLED_GUIDES.find(g => g.slug === 'plaies-fermeture')!;
    const suture = BUNDLED_GUIDES.find(g => g.slug === 'suture')!;
    expect(plaies.body).toMatch(/« Fermer une plaie : strips et suture »/);
    expect(suture.body).toMatch(/« Plaies : quand et comment les fermer »/);
    const meds = BUNDLED_GUIDES.find(g => g.slug === 'medicaments-courants')!;
    // Aucune dose chiffrée dans la fiche médicaments.
    expect(meds.body).not.toMatch(/\d\s?(mg|g|ml|mL)\b/);
    expect(ficheLayout(meds.body).links).toEqual([{ kind: 'healthStock' }]);
  });
});
