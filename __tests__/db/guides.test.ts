import { prepareDatabase } from '../../src/db/connection';
import {
  searchGuides,
  syncGuides,
  toFtsQuery,
  type BundledGuide,
} from '../../src/db/guides';
import { NodeSqliteDb } from './sqlite';

const GUIDES: BundledGuide[] = [
  {
    slug: 'garrot',
    title: 'Poser un garrot',
    category: 'secourisme',
    body: "En cas d'hémorragie massive d'un membre, poser le garrot 5 à 7 cm au-dessus de la plaie.",
  },
  {
    slug: 'hypothermie',
    title: 'Hypothermie',
    category: 'secourisme',
    body: 'Hypothermie sévère : manipuler la victime avec douceur, isoler du sol.',
  },
  {
    slug: 'filtre-eau',
    title: 'Fabriquer un filtre à eau',
    category: 'eau',
    body: 'Superposer gravier, sable et charbon. Toujours faire bouillir ensuite.',
  },
];

async function seeded() {
  const db = new NodeSqliteDb();
  await prepareDatabase(db);
  await syncGuides(db, GUIDES);
  return db;
}

const slugs = (hits: Array<{ slug: string }>) => hits.map(h => h.slug);

describe('toFtsQuery', () => {
  it('neutralise la syntaxe FTS5', () => {
    expect(toFtsQuery('filtre à eau')).toBe('"filtre"* "à"* "eau"*');
    expect(toFtsQuery('"garrot" OR NEAR(x)')).toBe(
      '"garrot"* "OR"* "NEAR"* "x"*',
    );
    expect(toFtsQuery('  -*:() ')).toBeNull();
  });
});

describe('searchGuides', () => {
  it.each([
    ['garrot', ['garrot']],
    ['GARROT', ['garrot']],
    ['garr', ['garrot']],
    ['hypothermie', ['hypothermie']],
    ['severe', ['hypothermie']],
    ['filtre à eau', ['filtre-eau']],
    ['hemorragie', ['garrot']],
    ['inexistant', []],
  ])('« %s » → %j', async (input, expected) => {
    const db = await seeded();
    expect(slugs(await searchGuides(db, input))).toEqual(expected);
  });

  it('classe les correspondances dans le titre en premier', async () => {
    const db = await seeded();
    await syncGuides(db, [
      ...GUIDES,
      {
        slug: 'trousse',
        title: 'Trousse de secours',
        category: 'secourisme',
        body: 'Contient bandes, compresses, et un garrot tourniquet.',
      },
    ]);
    expect(slugs(await searchGuides(db, 'garrot'))).toEqual([
      'garrot',
      'trousse',
    ]);
  });

  it('renvoie un extrait avec les termes mis en évidence', async () => {
    const db = await seeded();
    const [hit] = await searchGuides(db, 'charbon');
    expect(hit.snippet).toContain('[charbon]');
  });

  it('ne plante pas sur une saisie hostile', async () => {
    const db = await seeded();
    await expect(searchGuides(db, '"; DROP TABLE x; --')).resolves.toEqual([]);
    await expect(searchGuides(db, '')).resolves.toEqual([]);
  });
});

describe('syncGuides', () => {
  it("insère, met à jour et supprime en gardant l'index cohérent", async () => {
    const db = await seeded();

    const report = await syncGuides(db, [
      { ...GUIDES[0], body: 'Nouveau texte : tourniquet serré.' },
      GUIDES[1],
    ]);
    expect(report).toEqual({ inserted: 0, updated: 1, removed: 1 });

    expect(slugs(await searchGuides(db, 'tourniquet'))).toEqual(['garrot']);
    expect(await searchGuides(db, 'hemorragie')).toEqual([]);
    expect(await searchGuides(db, 'charbon')).toEqual([]);

    await db.execute(
      "INSERT INTO survival_guides_fts (survival_guides_fts) VALUES ('integrity-check')",
    );
  });

  it('ne réécrit rien quand le contenu est inchangé', async () => {
    const db = await seeded();
    expect(await syncGuides(db, GUIDES)).toEqual({
      inserted: 0,
      updated: 0,
      removed: 0,
    });
  });

  it('refuse les slugs en double sans rien écrire', async () => {
    const db = new NodeSqliteDb();
    await prepareDatabase(db);
    await expect(syncGuides(db, [GUIDES[0], GUIDES[0]])).rejects.toThrow(
      /double/,
    );
    const { rows } = await db.execute(
      'SELECT count(*) AS n FROM survival_guides',
    );
    expect(rows[0].n).toBe(0);
  });
});
