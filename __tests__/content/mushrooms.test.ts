import {
  isKeyResult,
  KEY_QUESTIONS,
  KEY_RESULTS,
  MUSHROOM_PHOTO_CREDITS,
  MUSHROOMS,
  mushroomById,
  mushroomPhotos,
  searchMushrooms,
  type KeyNode,
  type KeyResultId,
} from '../../src/content/mushrooms';
import { ficheLayout, LINK } from '../../src/content/fiches/fiche';
import { MUSHROOM_IMAGES } from '../../src/ui/mushroomImages';

describe('fiche Champignons', () => {
  it('compte 40 espèces : 10 mortelles, 14 toxiques, 16 comestibles', () => {
    expect(MUSHROOMS).toHaveLength(40);
    const count = (g: string) => MUSHROOMS.filter(x => x.group === g).length;
    expect(count('mortel')).toBe(10);
    expect(count('toxique')).toBe(14);
    expect(count('comestible')).toBe(16);
    expect(new Set(MUSHROOMS.map(x => x.id)).size).toBe(40);
  });

  it('décrit chaque espèce et nomme au moins un sosie', () => {
    for (const x of MUSHROOMS) {
      for (const field of [x.cap, x.under, x.stem, x.where, x.warning]) {
        expect(field.trim()).not.toBe('');
      }
      expect(x.lookalikes.length).toBeGreaterThan(0);
    }
  });

  it('ne présente jamais une espèce comme sûre à consommer', () => {
    const text = JSON.stringify(MUSHROOMS).toLowerCase();
    expect(text).not.toMatch(/sans danger|sans risque|100 ?%/);
  });

  it('donne à chaque espèce une ou deux photos créditées et embarquées', () => {
    for (const x of MUSHROOMS) {
      const photos = mushroomPhotos(x.id);
      expect(photos.length).toBeGreaterThanOrEqual(1);
      for (const key of photos) {
        expect(MUSHROOM_PHOTO_CREDITS[key]).toMatch(/· (CC|Public)/);
        expect(MUSHROOM_IMAGES[key]).toBeDefined();
      }
    }
    expect(Object.keys(MUSHROOM_IMAGES).sort()).toEqual(
      Object.keys(MUSHROOM_PHOTO_CREDITS).sort(),
    );
  });

  it('cherche sans tenir compte des accents ni de la casse', () => {
    expect(searchMushrooms('amanite phallo')[0].id).toBe('amanita-phalloides');
    expect(searchMushrooms('CEPE').map(x => x.id)).toEqual(['boletus-edulis']);
    expect(searchMushrooms('', 'mortel')).toHaveLength(10);
  });
});

describe('caractéristiques', () => {
  /** Tous les chemins possibles, de la première question à un résultat. */
  function paths(
    node: KeyNode | KeyResultId = 'q1',
    depth = 0,
  ): Array<{ result: KeyResultId; depth: number }> {
    if (isKeyResult(node)) {
      return [{ result: node, depth }];
    }
    return KEY_QUESTIONS[node].answers.flatMap(a => paths(a.next, depth + 1));
  }

  it('aboutit toujours à un résultat en trois questions au plus', () => {
    const all = paths();
    expect(all.length).toBeGreaterThan(0);
    for (const p of all) {
      expect(p.depth).toBeLessThanOrEqual(3);
    }
    expect(new Set(all.map(p => p.result))).toEqual(
      new Set(Object.keys(KEY_RESULTS)),
    );
  });

  it('conclut au danger dès qu’une volve est présente ou invérifiable', () => {
    expect(KEY_RESULTS.amanite.danger).toBe(true);
    expect(KEY_RESULTS.doute.danger).toBe(true);
  });

  it('ne propose que des espèces de la base', () => {
    for (const r of Object.values(KEY_RESULTS)) {
      expect(r.species.length).toBeGreaterThan(0);
      for (const id of r.species) {
        expect(mushroomById(id)).toBeDefined();
      }
    }
  });
});

describe('lien depuis la fiche du guide', () => {
  it('ouvre l’écran Champignons', () => {
    expect(ficheLayout(LINK.mushrooms).links).toEqual([{ kind: 'mushrooms' }]);
  });
});
