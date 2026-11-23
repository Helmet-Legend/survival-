import { pdfPagesToKeep } from '../../src/photo/pdfImport';

const pdf = (pageCount: number, read = pageCount) => ({
  name: 'cni.pdf',
  pageCount,
  pages: Array.from({ length: read }, (_, i) => `p${i}`),
});

describe('import de PDF dans un document', () => {
  it('garde toutes les pages quand il y a la place', () => {
    expect(pdfPagesToKeep(pdf(2), 30)).toEqual({
      pages: ['p0', 'p1'],
      notice: null,
    });
  });

  it('coupe à la place restante et le signale', () => {
    const result = pdfPagesToKeep(pdf(5), 3);
    expect(result.pages).toEqual(['p0', 'p1', 'p2']);
    expect(result.notice).toBe(
      '3 pages sur 5 importées : la limite du document est atteinte.',
    );
  });

  it('signale les pages que le téléphone n’a pas converties', () => {
    expect(pdfPagesToKeep(pdf(40, 30), 30).notice).toBe(
      '30 pages sur 40 importées : la limite du document est atteinte.',
    );
  });

  it('refuse un PDF sans page lisible ou un document plein', () => {
    expect(pdfPagesToKeep(pdf(3, 0), 30)).toEqual({
      pages: [],
      notice: 'Aucune page lisible dans ce PDF.',
    });
    expect(pdfPagesToKeep(pdf(1), 0).notice).toBe(
      'Plus de place pour de nouvelles pages.',
    );
  });
});
