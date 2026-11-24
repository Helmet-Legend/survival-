import { prepareDatabase } from '../../src/db/connection';
import {
  LIBRARY_CHUNK_BYTES,
  LIBRARY_MAX_BYTES,
  LibraryRepository,
  titleFromFileName,
} from '../../src/db/library';
import {
  convertPdfPages,
  pickPdfWith,
  type PdfFiles,
} from '../../src/photo/photoSource';
import {
  conversionLabel,
  formatBytes,
  importSummary,
} from '../../src/photo/pdfImport';
import { NodeSqliteDb } from './sqlite';

/** Faux moteur PDF : fichiers en mémoire, pages « dessinées » en texte. */
function fakeFiles(
  file: Buffer,
  pageCount: number,
): PdfFiles & {
  rendered: Array<[number, number, number]>;
  open: () => Promise<{
    token: string;
    name: string;
    pageCount: number;
    bytes: number;
  } | null>;
  closed: string[];
  written: Map<string, Buffer>;
} {
  const written = new Map<string, Buffer>();
  const rendered: Array<[number, number, number]> = [];
  const closed: string[] = [];
  let n = 0;
  return {
    rendered,
    closed,
    written,
    open: async () => {
      written.set('picked', file);
      return {
        token: 'picked',
        name: 'Guide_survie-urbaine.pdf',
        pageCount,
        bytes: file.length,
      };
    },
    begin: async () => {
      const token = `t${n++}`;
      written.set(token, Buffer.alloc(0));
      return token;
    },
    append: async (token, base64) => {
      written.set(
        token,
        Buffer.concat([
          written.get(token) ?? Buffer.alloc(0),
          Buffer.from(base64, 'base64'),
        ]),
      );
    },
    load: async () => ({ pageCount }),
    render: async (_token, from, count, maxSide) => {
      rendered.push([from, count, maxSide]);
      return Array.from({ length: count }, (_, i) =>
        Buffer.from(`page${from + i}`).toString('base64'),
      );
    },
    read: async (token, offset, length) =>
      (written.get(token) ?? Buffer.alloc(0))
        .subarray(offset, offset + length)
        .toString('base64'),
    close: async token => {
      closed.push(token);
    },
  };
}

async function repo() {
  const db = new NodeSqliteDb();
  await prepareDatabase(db);
  return { db, library: new LibraryRepository(db) };
}

describe('Bibliothèque', () => {
  it('range un PDF entier et le reconstitue à l’identique', async () => {
    const { db, library } = await repo();
    const file = Buffer.alloc(LIBRARY_CHUNK_BYTES * 2 + 1234, 7);
    file.write('%PDF-1.7', 0);
    const files = fakeFiles(file, 380);
    const opened = await files.open();
    const progress: number[] = [];
    const id = await library.add(files, opened!, done => progress.push(done));
    expect(progress).toEqual([
      LIBRARY_CHUNK_BYTES,
      LIBRARY_CHUNK_BYTES * 2,
      file.length,
    ]);
    const { rows } = await db.execute(
      'SELECT COUNT(*) AS n FROM library_chunks WHERE book_id = ?',
      [id],
    );
    expect(Number(rows[0].n)).toBe(3);

    const [book] = await library.list();
    expect(book).toMatchObject({
      id,
      title: 'Guide survie-urbaine',
      fileName: 'Guide_survie-urbaine.pdf',
      bytes: file.length,
      pageCount: 380,
      lastPage: 0,
    });

    const session = await library.open(files, id);
    expect(session.pageCount).toBe(380);
    expect(files.written.get(session.token)?.equals(file)).toBe(true);

    await library.setLastPage(id, 141);
    await library.rename(id, 'Survie urbaine, tome 1');
    expect(await library.get(id)).toMatchObject({
      lastPage: 141,
      title: 'Survie urbaine, tome 1',
    });
    expect((await library.search('URBAINE tome')).length).toBe(1);
    expect(await library.totalBytes()).toBe(file.length);

    await library.remove(id);
    expect(await library.list()).toEqual([]);
    const left = await db.execute('SELECT COUNT(*) AS n FROM library_chunks');
    expect(Number(left.rows[0].n)).toBe(0);
  });

  it('refuse un PDF trop lourd et un titre vide', async () => {
    const { library } = await repo();
    const files = fakeFiles(Buffer.from('%PDF'), 1);
    await expect(
      library.add(files, {
        token: 'x',
        name: 'gros.pdf',
        pageCount: 10,
        bytes: LIBRARY_MAX_BYTES + 1,
      }),
    ).rejects.toThrow('PDF trop lourd');
    const id = await library.add(files, (await files.open())!);
    await expect(library.rename(id, '  ')).rejects.toThrow('Donnez un titre');
  });

  it('tire un titre lisible du nom de fichier', () => {
    expect(titleFromFileName('mon_guide.PDF')).toBe('mon guide');
    expect(titleFromFileName('.pdf')).toBe('Document');
  });
});

describe('import de PDF par paquets', () => {
  it('convertit 10 pages à la fois, plus légères après 30', async () => {
    const files = fakeFiles(Buffer.from('%PDF'), 150);
    const opened = (await files.open())!;
    const steps: string[] = [];
    const pdf = await convertPdfPages(files, opened, 100, (done, total) =>
      steps.push(`${done}/${total}`),
    );
    expect(pdf.pages).toHaveLength(100);
    expect(pdf.pageCount).toBe(150);
    expect(files.rendered).toHaveLength(10);
    expect(files.rendered[0]).toEqual([0, 10, 1800]);
    expect(files.rendered[2]).toEqual([20, 10, 1800]);
    expect(files.rendered[3]).toEqual([30, 10, 1400]);
    expect(steps[0]).toBe('0/100');
    expect(steps[steps.length - 1]).toBe('100/100');
  });

  it('referme toujours le fichier choisi', async () => {
    const files = fakeFiles(Buffer.from('%PDF'), 3);
    const pdf = await pickPdfWith(files)(100);
    expect(pdf?.pages).toHaveLength(3);
    expect(files.closed).toEqual(['picked']);
  });

  it('affiche la progression et la taille', () => {
    expect(conversionLabel(null, 'PDF')).toBe('PDF');
    expect(conversionLabel({ done: 40, total: 100 }, 'PDF')).toBe(
      'Conversion : page 40 / 100…',
    );
    expect(formatBytes(800 * 1024)).toBe('800 Ko');
    expect(formatBytes(5.25 * 1024 * 1024)).toBe('5,3 Mo');
    expect(formatBytes(24 * 1024 * 1024)).toBe('24 Mo');
    expect(importSummary(['QUJD', 'QUJD'])).toBe(
      '2 pages importées · 1 Ko dans le coffre',
    );
  });
});
