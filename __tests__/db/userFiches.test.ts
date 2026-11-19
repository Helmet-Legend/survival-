import { prepareDatabase } from '../../src/db/connection';
import {
  isRiskyFamily,
  USER_FICHE_PDF_PAGES_MAX,
  USER_FICHE_PDFS_MAX,
  USER_FICHE_PHOTOS_MAX,
  UserFicheRepository,
} from '../../src/db/userFiches';
import { NodeSqliteDb } from './sqlite';

const IMG = 'QUJD';

async function repo() {
  const db = new NodeSqliteDb();
  await prepareDatabase(db);
  return { db, fiches: new UserFicheRepository(db) };
}

describe('Mes fiches', () => {
  it('crée, relit, modifie et supprime une fiche', async () => {
    const { db, fiches } = await repo();
    const id = await fiches.create({
      title: '  Source du Pré-Haut ',
      family: 'Eau potable',
      body: 'À filtrer puis faire bouillir.',
    });
    let fiche = await fiches.get(id);
    expect(fiche).toMatchObject({
      title: 'Source du Pré-Haut',
      family: 'Eau potable',
      photoCount: 0,
      pdfCount: 0,
      photos: [],
      pdfs: [],
    });

    await fiches.update(id, { title: 'Source', family: null, body: '' });
    fiche = await fiches.get(id);
    expect(fiche).toMatchObject({ title: 'Source', family: null, body: '' });

    await fiches.addPhoto(id, IMG);
    await fiches.addPdf(id, 'plan.pdf', [IMG, IMG]);
    await fiches.remove(id);
    expect(await fiches.get(id)).toBeNull();
    const { rows } = await db.execute(
      'SELECT COUNT(*) AS n FROM user_fiche_images',
    );
    expect(Number(rows[0].n)).toBe(0);
  });

  it('refuse un titre vide ou une famille inconnue', async () => {
    const { fiches } = await repo();
    await expect(
      fiches.create({ title: ' ', family: null, body: '' }),
    ).rejects.toThrow('Donnez un titre');
    await expect(
      fiches.create({ title: 'X', family: 'Cuisine', body: '' }),
    ).rejects.toThrow('Famille inconnue');
  });

  it('limite les photos et les PDF, et ordonne les pages', async () => {
    const { fiches } = await repo();
    const id = await fiches.create({ title: 'X', family: null, body: '' });
    for (let i = 0; i < USER_FICHE_PHOTOS_MAX; i++) {
      await fiches.addPhoto(id, IMG);
    }
    await expect(fiches.addPhoto(id, IMG)).rejects.toThrow('photos au maximum');
    await expect(fiches.addPhoto(id, 'pas une image!')).rejects.toThrow(
      'Image illisible',
    );

    const many = Array.from({ length: USER_FICHE_PDF_PAGES_MAX + 5 }, (_, i) =>
      btoa(`page${i}`),
    );
    const pdfId = await fiches.addPdf(id, 'guide.pdf', many);
    const pages = await fiches.pdfPages(id, pdfId);
    expect(pages).toHaveLength(USER_FICHE_PDF_PAGES_MAX);
    expect(pages[0]).toBe(btoa('page0'));
    expect(pages[2]).toBe(btoa('page2'));
    for (let i = 1; i < USER_FICHE_PDFS_MAX; i++) {
      await fiches.addPdf(id, `doc${i}.pdf`, [IMG]);
    }
    await expect(fiches.addPdf(id, 'trop.pdf', [IMG])).rejects.toThrow(
      'PDF au maximum',
    );

    const fiche = await fiches.get(id);
    expect(fiche?.pdfs.map(p => [p.name, p.pageCount])).toEqual([
      ['guide.pdf', USER_FICHE_PDF_PAGES_MAX],
      ['doc1.pdf', 1],
      ['doc2.pdf', 1],
    ]);
    expect((await fiches.list())[0]).toMatchObject({
      photoCount: USER_FICHE_PHOTOS_MAX,
      pdfCount: USER_FICHE_PDFS_MAX,
    });

    await fiches.removePdf(id, pdfId);
    await fiches.removePhoto(id, (await fiches.get(id))!.photos[0].id);
    expect(await fiches.get(id)).toMatchObject({
      photoCount: USER_FICHE_PHOTOS_MAX - 1,
      pdfCount: USER_FICHE_PDFS_MAX - 1,
    });
  });

  it('cherche sans tenir compte des accents ni de la casse', async () => {
    const { fiches } = await repo();
    await fiches.create({
      title: 'Ail des ours',
      family: 'Autonomie en nature',
      body: 'Sous-bois humide près du moulin.',
    });
    await fiches.create({ title: 'Mairie', family: null, body: 'Évacuation' });
    expect((await fiches.search('MOULIN ail')).map(f => f.title)).toEqual([
      'Ail des ours',
    ]);
    expect((await fiches.search('evacuation')).map(f => f.title)).toEqual([
      'Mairie',
    ]);
    expect(await fiches.search('  ')).toEqual([]);
  });

  it('donne la première photo de chaque fiche', async () => {
    const { fiches } = await repo();
    const a = await fiches.create({ title: 'A', family: null, body: '' });
    await fiches.create({ title: 'B', family: null, body: '' });
    await fiches.addPhoto(a, 'Rk9P');
    await fiches.addPhoto(a, 'QkFS');
    const thumbs = await fiches.thumbnails();
    expect([...thumbs.entries()]).toEqual([[a, 'Rk9P']]);
  });

  it('signale les familles à risque', () => {
    expect(isRiskyFamily('Santé')).toBe(true);
    expect(isRiskyFamily('Autonomie en nature')).toBe(true);
    expect(isRiskyFamily('Eau potable')).toBe(false);
    expect(isRiskyFamily(null)).toBe(false);
  });
});
