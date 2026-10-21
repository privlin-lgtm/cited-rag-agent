import { beforeEach, describe, expect, it } from 'vitest';
import { migrate } from '../../scripts/migrate';
import { pgliteDb, type Db } from '../db';
import type { Embedder } from '../embed';
import { fakeEmbedder } from '../fake-embedder';
import { INGEST_VERSION, ingestDocument } from './index';

const bytes = (text: string) => new TextEncoder().encode(text);
const guide = '# Cancel\nA sender has 30 minutes to cancel a remittance transfer.\n\n# Errors\nA sender has 180 days to report an error.';
const input = (data = guide) => ({ collection: 'corpus', filename: 'guide.md', kind: 'md' as const, data: bytes(data) });

let db: Db;
let calls: number;
const counting: Embedder = async (texts, inputType) => {
  calls++;
  return fakeEmbedder(texts, inputType);
};

const chunkIds = async () => (await db.query<{ id: string }>('select id::text from chunks order by id')).map(({ id }) => id);

beforeEach(async () => {
  db = await pgliteDb();
  await migrate(db);
  calls = 0;
});

describe('ingestDocument', () => {
  it('stores the document and its chunks with a locator each, and reports pages, chunks and Voyage tokens', async () => {
    const report = await ingestDocument(db, counting, input());
    expect(report).toEqual({ status: 'ingested', pages: null, chunks: 2, tokens: expect.any(Number) });
    expect(await db.query('select collection, filename, kind, ingest_version from documents')).toEqual([
      { collection: 'corpus', filename: 'guide.md', kind: 'md', ingest_version: INGEST_VERSION },
    ]);
    expect(await db.query('select ord, locator from chunks order by ord')).toEqual([
      { ord: 0, locator: '§ Cancel' },
      { ord: 1, locator: '§ Errors' },
    ]);
  });

  it('passes beforeEmbed the estimated tokens of all chunks before embedding, and embeds nothing when it throws', async () => {
    let estimate = 0;
    await ingestDocument(db, counting, {
      ...input(),
      beforeEmbed: async (tokens) => {
        expect(calls).toBe(0);
        estimate = tokens;
      },
    });
    const stored = await db.query<{ content: string }>('select content from chunks');
    expect(estimate).toBe(stored.reduce((sum, { content }) => sum + Math.ceil(content.length / 4), 0));
    expect(calls).toBe(1);

    calls = 0;
    await expect(
      ingestDocument(db, counting, {
        ...input('# Other\nDifferent text.'),
        beforeEmbed: async () => {
          throw new Error('too big');
        },
      }),
    ).rejects.toThrow('too big');
    expect(calls).toBe(0);
    expect(await db.query('select count(*)::int as n from chunks')).toEqual([{ n: 2 }]);
  });

  it('numbers chunks 0..n-1 across insert batches', async () => {
    const paragraphs = Array.from({ length: 130 }, (_, i) => `Paragraph ${i}. ${'word '.repeat(340).trim()}`).join('\n\n');
    const report = await ingestDocument(db, counting, { collection: 'corpus', filename: 'long.txt', kind: 'txt', data: bytes(paragraphs) });
    expect(report).toMatchObject({ status: 'ingested', chunks: 130 });
    const ords = (await db.query<{ ord: number }>('select ord from chunks order by id')).map(({ ord }) => ord);
    expect(ords).toEqual(Array.from({ length: 130 }, (_, i) => i));
  });

  it('changes nothing on a second ingest at the same version', async () => {
    await ingestDocument(db, counting, input());
    const before = await chunkIds();
    expect(await ingestDocument(db, counting, input())).toEqual({ status: 'skipped', chunks: 2 });
    expect(calls).toBe(1);
    expect(await chunkIds()).toEqual(before);
  });

  it('replaces the rows when the version is bumped', async () => {
    await ingestDocument(db, counting, input());
    const before = await chunkIds();
    expect((await ingestDocument(db, counting, input(), INGEST_VERSION + 1)).status).toBe('ingested');
    expect(calls).toBe(2);
    const after = await chunkIds();
    expect(after).toHaveLength(2);
    expect(after.filter((id) => before.includes(id))).toEqual([]);
    expect(await db.query('select ingest_version from documents')).toEqual([{ ingest_version: INGEST_VERSION + 1 }]);
  });

  it('replaces the rows when the file changes', async () => {
    await ingestDocument(db, counting, input());
    await ingestDocument(db, counting, input(`${guide}\n\n# Refunds\nA refund follows.`));
    expect(await db.query('select count(*)::int as documents from documents')).toEqual([{ documents: 1 }]);
    expect(await db.query('select locator from chunks order by ord')).toEqual([{ locator: '§ Cancel' }, { locator: '§ Errors' }, { locator: '§ Refunds' }]);
  });

  it('keeps a filename unique per collection, not across collections', async () => {
    await ingestDocument(db, counting, input());
    await ingestDocument(db, counting, { ...input(), collection: 'upload:abc' });
    expect(await db.query('select count(*)::int as documents from documents')).toEqual([{ documents: 2 }]);
  });

  it('leaves the old rows alone when embedding fails', async () => {
    await ingestDocument(db, counting, input());
    const before = await chunkIds();
    const failing: Embedder = async () => {
      throw new Error('Voyage is down');
    };
    await expect(ingestDocument(db, failing, input(`${guide}\n\nMore.`))).rejects.toThrow('Voyage is down');
    expect(await chunkIds()).toEqual(before);
  });

  it('rolls back the document when a chunk insert fails', async () => {
    const short: Embedder = async (texts) => ({ embeddings: [], tokens: texts.length });
    await expect(ingestDocument(db, short, input())).rejects.toThrow('0 embeddings for 2 chunks');
    expect(await db.query('select count(*)::int as documents from documents')).toEqual([{ documents: 0 }]);
  });

  it('rejects a document with no text', async () => {
    await expect(ingestDocument(db, counting, input('  \n\n '))).rejects.toThrow('guide.md has no extractable text');
    expect(calls).toBe(0);
  });
});
