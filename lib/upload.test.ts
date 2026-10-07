import { readFile } from 'node:fs/promises';
import { beforeEach, describe, expect, it } from 'vitest';
import { migrate } from '../scripts/migrate';
import { pgliteDb, type Db } from './db';
import { fakeEmbedder } from './fake-embedder';
import { makePdf } from './test-pdf';
import { ingestUpload, MAX_UPLOAD_BYTES, prepareUpload, UploadError, uploadFilename } from './upload';

const bytes = (text: string) => new TextEncoder().encode(text);
let db: Db;

beforeEach(async () => {
  db = await pgliteDb();
  await migrate(db);
});

const rejection = async (run: () => Promise<unknown> | unknown) => {
  const error = await Promise.resolve()
    .then(run)
    .then(
      () => null,
      (reason: unknown) => reason,
    );
  expect(error).toBeInstanceOf(UploadError);
  return error as UploadError;
};

describe('uploadFilename', () => {
  it('keeps the base name of a path and accepts md, pdf and txt in any case', () => {
    expect(uploadFilename('C:\\Users\\x\\notes (v2).MD')).toBe('notes (v2).MD');
    expect(uploadFilename('folder/report.pdf')).toBe('report.pdf');
  });

  it.each(['', 'noextension', 'script.exe', '.md', 'a/..', 'x'.repeat(130) + '.txt', 'bad\u0000name.txt', 'tab\tname.md'])('rejects %j', (name) => {
    expect(() => uploadFilename(name)).toThrow(UploadError);
  });
});

describe('prepareUpload', () => {
  it('rejects an empty file and one over 4 MB, before reading it', async () => {
    expect((await rejection(() => prepareUpload('a.txt', new Uint8Array(0)))).status).toBe(400);
    const error = await rejection(() => prepareUpload('a.txt', new Uint8Array(MAX_UPLOAD_BYTES + 1)));
    expect(error).toMatchObject({ status: 413, message: 'The file is larger than 4 MB.' });
  });

  it('rejects a PDF over 40 pages', async () => {
    const pages = Array.from({ length: 41 }, (_, i) => [`Topic ${String.fromCharCode(65 + (i % 26))}${String.fromCharCode(97 + Math.floor(i / 26))} has some text.`]);
    expect(await rejection(() => prepareUpload('long.pdf', makePdf(pages)))).toMatchObject({ status: 413 });
    expect(await prepareUpload('ok.pdf', makePdf(pages.slice(0, 40)))).toEqual({ filename: 'ok.pdf', kind: 'pdf' });
  });

  it('rejects a PDF with no text and says OCR is out of scope', async () => {
    const error = await rejection(() => prepareUpload('scan.pdf', makePdf([[], []])));
    expect(error.status).toBe(422);
    expect(error.message).toContain('OCR is out of scope');
  });
});

describe('ingestUpload', () => {
  it('stores the file under the session collection and returns its id', async () => {
    const { id, filename, kind, report } = await ingestUpload(db, fakeEmbedder, 'sess1', 'notes.md', bytes('# Refunds\nRefunds arrive within 12 days.'));
    expect(report.status).toBe('ingested');
    expect(await db.query('select id::text as id, collection, filename, kind from documents')).toEqual([{ id, collection: 'upload:sess1', filename: 'notes.md', kind: 'md' }]);
    expect({ filename, kind }).toEqual({ filename: 'notes.md', kind: 'md' });
  });

  it('replaces the first upload when the same session uploads the same filename again', async () => {
    const first = await ingestUpload(db, fakeEmbedder, 'sess1', 'notes.md', bytes('# Refunds\nRefunds arrive within 12 days.'));
    const second = await ingestUpload(db, fakeEmbedder, 'sess1', 'notes.md', bytes('# Refunds\nRefunds arrive within 30 days.'));
    expect(second.id).not.toBe(first.id);
    expect(await db.query('select content from chunks')).toEqual([{ content: '# Refunds\nRefunds arrive within 30 days.' }]);
    expect(await db.query('select count(*)::int as documents from documents')).toEqual([{ documents: 1 }]);
  });

  it('keeps two sessions\' uploads of the same filename apart', async () => {
    await ingestUpload(db, fakeEmbedder, 'sess1', 'notes.md', bytes('# A\nOne.'));
    await ingestUpload(db, fakeEmbedder, 'sess2', 'notes.md', bytes('# A\nTwo.'));
    expect(await db.query('select collection from documents order by collection')).toEqual([{ collection: 'upload:sess1' }, { collection: 'upload:sess2' }]);
  });

  it('ingests the committed two-page PDF fixture with its text on each page', async () => {
    const { id } = await ingestUpload(db, fakeEmbedder, 'sess1', 'acme-pay-terms.pdf', new Uint8Array(await readFile(new URL('./fixtures/acme-pay-terms.pdf', import.meta.url))));
    const rows = await db.query<{ locator: string; content: string }>('select locator, content from chunks where document_id = $1::uuid order by ord', [id]);
    expect(rows.map(({ locator }) => locator)).toEqual(['p. 1', 'p. 2']);
    expect(rows[0].content).toContain('within 12 days of sending it');
    expect(rows[1].content).toContain('flat fee of 3.50 euro');
  });

  it('ingests a text PDF page by page', async () => {
    const { id } = await ingestUpload(db, fakeEmbedder, 'sess1', 'terms.pdf', makePdf([['Refunds arrive within 12 days.'], ['Fees are listed on page two.']]));
    expect(await db.query('select locator from chunks where document_id = $1::uuid order by ord', [id])).toEqual([{ locator: 'p. 1' }, { locator: 'p. 2' }]);
  });
});
