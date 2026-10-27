import { prepareDatabase } from '../../src/db/connection';
import {
  buildPharmacyList,
  LIST_KEY,
  listSettingsError,
  loadListSettings,
  newListSettings,
  pharmacyListCsv,
  saveListSettings,
  type ListSettings,
} from '../../src/plan/pharmacyList';
import { NodeSqliteDb } from '../db/sqlite';

const settings = (patch: Partial<ListSettings> = {}): ListSettings => ({
  ...newListSettings(2, 2),
  ...patch,
});
const byId = (s: ListSettings) =>
  new Map(buildPharmacyList(s).map(i => [i.id, i]));

describe('liste de pharmacie familiale', () => {
  it('estime les médicaments adultes selon les adultes et la durée', () => {
    const six = byId(settings({ months: 6 }));
    // 3 × 2 adultes × 180 j ÷ 365 × 18 = 53,3 → 54 comprimés → 4 boîtes de 16.
    expect(six.get('paracetamol')?.quantity).toBe('4 boîtes de 16 comprimés');
    expect(six.get('paracetamol')?.basis).toBe('estimate');
    expect(six.get('paracetamol')?.detail).toContain('= 54 comprimés');
    // 0,33 × 2 × 180 ÷ 365 × 21 = 6,8 → 7 sachets → 1 boîte de 18.
    expect(six.get('diosmectite')?.quantity).toBe('1 boîte de 18 sachets');
    const year = byId(settings({ months: 12 }));
    // 3 × 2 × 360 ÷ 365 × 18 = 106,5 → 107 → 7 boîtes.
    expect(year.get('paracetamol')?.packs).toBe(7);
    // Les enfants ne changent pas les quantités adultes.
    expect(byId(settings({ children: 5 })).get('paracetamol')?.packs).toBe(
      six.get('paracetamol')?.packs,
    );
  });

  it('ne calcule aucune quantité pour les enfants', () => {
    const items = buildPharmacyList(settings());
    const kids = items.filter(i => i.section === 'children');
    expect(kids.map(i => i.id)).toEqual([
      'paracetamol_enfant',
      'diosmectite_enfant',
    ]);
    expect(kids.every(i => i.basis === 'advice' && i.packs === undefined)).toBe(
      true,
    );
    expect(
      buildPharmacyList(settings({ children: 0 })).some(
        i => i.section === 'children',
      ),
    ).toBe(false);
  });

  it('sans adulte : pas de médicaments adultes ; sans personne : liste vide', () => {
    const items = buildPharmacyList(settings({ adults: 0 }));
    expect(items.some(i => i.section === 'adults')).toBe(false);
    expect(items.some(i => i.id === 'thermometre')).toBe(true);
    expect(buildPharmacyList(settings({ adults: 0, children: 0 }))).toEqual([]);
  });

  it('cite une source pour chaque estimation et chaque matériel', () => {
    for (const item of buildPharmacyList(settings())) {
      if (item.basis !== 'advice') {
        expect(item.sources.length).toBeGreaterThan(0);
      }
    }
  });

  it.each([
    [{ adults: -1 }, /adultes/],
    [{ children: 11 }, /enfants/],
    [{ adults: 0, children: 0 }, /au moins une personne/],
    [{ months: 2 as never }, /Durée/],
    [{ checked: [3] as never }, /cochée/],
  ])('refuse des réglages invalides %#', (patch, expected) => {
    expect(listSettingsError(settings(patch))).toMatch(expected);
  });

  it('garde réglages et coches, ignore une valeur abîmée', async () => {
    const db = new NodeSqliteDb();
    await prepareDatabase(db);
    expect(await loadListSettings(db)).toBeNull();
    const s = settings({ generated: true, checked: ['thermometre'] });
    await saveListSettings(db, s);
    expect(await loadListSettings(db)).toEqual(s);
    await expect(saveListSettings(db, { ...s, adults: 99 })).rejects.toThrow(
      /adultes/,
    );
    await db.execute('UPDATE settings SET value = ? WHERE key = ?', [
      '{"version":1}',
      LIST_KEY,
    ]);
    expect(await loadListSettings(db)).toBeNull();
  });

  it('exporte la liste avec hypothèses et coches', () => {
    const csv = pharmacyListCsv(
      settings({ generated: true, checked: ['thermometre'] }),
      '2026-10-27',
    );
    const lines = csv.trim().split('\r\n');
    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(lines[0]).toBe(
      'Pharmacie familiale — liste indicative, pas une prescription',
    );
    expect(lines[1]).toBe('2 adulte(s), 2 enfant(s), 6 mois, au 2026-10-27');
    expect(csv).toMatch(
      /Petit matériel;Thermomètre médical;1 pour le foyer;.*;oui\r\n/,
    );
    expect(csv).toMatch(
      /Enfants;Paracétamol pédiatrique;Quantité à définir avec le pharmacien;/,
    );
  });
});
