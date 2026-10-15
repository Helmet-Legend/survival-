import { prepareDatabase } from '../../src/db/connection';
import {
  ArmoryRepository,
  DocumentRepository,
  PHOTOS_PER_OWNER_MAX,
  PhotoRepository,
} from '../../src/inventory';
import { NodeSqliteDb } from '../db/sqlite';

const TODAY = '2026-10-15';
const JPEG =
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8U';

async function setup() {
  const db = new NodeSqliteDb();
  await prepareDatabase(db);
  let n = 0;
  const newId = () => `id-${++n}`;
  return {
    db,
    docs: new DocumentRepository(db, { newId, today: () => TODAY }),
    photos: new PhotoRepository(db, { newId }),
    armory: new ArmoryRepository(db, { newId, today: () => TODAY }),
  };
}

describe('DocumentRepository', () => {
  it('enregistre un document et calcule les jours avant expiration', async () => {
    const { docs } = await setup();
    await docs.create({
      kind: 'passport',
      title: ' Passeport ',
      holder: 'Rémi',
      number: '18AB12345',
      expiresAt: '2026-12-14',
    });
    await docs.create({ kind: 'health_card', title: 'Carte Vitale' });
    await docs.create({
      kind: 'id_card',
      title: 'CNI',
      expiresAt: '2026-10-01',
    });

    const list = await docs.list();
    expect(list.map(d => [d.title, d.daysLeft])).toEqual([
      ['CNI', -14],
      ['Passeport', 60],
      ['Carte Vitale', null],
    ]);
    expect(list[1]).toMatchObject({ holder: 'Rémi', number: '18AB12345' });
  });

  it.each([
    ['intitulé vide', { title: '  ' }, 'title'],
    ['date invalide', { expiresAt: '2027-02-30' }, 'expiresAt'],
    ['type inconnu', { kind: 'visa' as never }, 'kind'],
  ])('refuse un document invalide (%s)', async (_, patch, field) => {
    const { docs } = await setup();
    await expect(
      docs.create({ kind: 'passport', title: 'Passeport', ...patch }),
    ).rejects.toMatchObject({ code: 'VALIDATION', field });
  });

  it('modifie puis supprime un document avec ses photos', async () => {
    const { docs, photos } = await setup();
    const doc = await docs.create({ kind: 'insurance', title: 'Mutuelle' });
    await photos.add('document', doc.id, JPEG);
    const updated = await docs.update(doc.id, {
      kind: 'insurance',
      title: 'Mutuelle MGEN',
      number: '123',
    });
    expect(updated).toMatchObject({ title: 'Mutuelle MGEN', number: '123' });

    await docs.remove(doc.id);
    expect(await docs.list()).toEqual([]);
    expect(await photos.list('document', doc.id)).toEqual([]);
  });
});

describe('PhotoRepository', () => {
  it('ajoute, liste, compte et retire les photos d’une arme', async () => {
    const { armory, photos } = await setup();
    const weapon = await armory.createWeapon({
      model: 'Glock 17',
      kind: 'handgun',
      caliber: '9x19',
      serialNumber: 'ABC123',
    });
    const id = await photos.add('weapon', weapon.id, `${JPEG}\n`);
    expect(await photos.list('weapon', weapon.id)).toEqual([
      expect.objectContaining({ id, mime: 'image/jpeg', base64: JPEG }),
    ]);
    expect((await photos.counts('weapon')).get(weapon.id)).toBe(1);

    await photos.remove(id);
    expect(await photos.list('weapon', weapon.id)).toEqual([]);
  });

  it('efface les photos avec l’arme', async () => {
    const { armory, photos } = await setup();
    const weapon = await armory.createWeapon({
      model: 'Glock 17',
      kind: 'handgun',
      caliber: '9x19',
    });
    await photos.add('weapon', weapon.id, JPEG);
    await armory.deleteWeapon(weapon.id);
    expect(await photos.list('weapon', weapon.id)).toEqual([]);
  });

  it('refuse une image illisible, un propriétaire absent et un excès', async () => {
    const { armory, photos } = await setup();
    const weapon = await armory.createWeapon({
      model: 'Glock 17',
      kind: 'handgun',
      caliber: '9x19',
    });
    await expect(
      photos.add('weapon', weapon.id, 'pas une image !'),
    ).rejects.toMatchObject({ field: 'photo' });
    await expect(photos.add('weapon', 'absent', JPEG)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    for (let i = 0; i < PHOTOS_PER_OWNER_MAX; i++) {
      await photos.add('weapon', weapon.id, JPEG);
    }
    await expect(photos.add('weapon', weapon.id, JPEG)).rejects.toMatchObject({
      field: 'photo',
    });
  });
});
