import { beforeAll, describe, expect, it } from 'vitest';
import { pgliteDb, type Db } from '../lib/db';
import { fakeEmbedder } from '../lib/fake-embedder';
import { ingestCorpus } from './ingest-corpus';
import { migrate } from './migrate';

let db: Db;

beforeAll(async () => {
  db = await pgliteDb();
  await migrate(db);
});

describe('ingestCorpus', () => {
  it('ingests every manifest document, then skips them all on a second run', { timeout: 300_000 }, async () => {
    const first = await ingestCorpus(db, fakeEmbedder);
    expect(first).toHaveLength(9);
    for (const report of first) {
      expect(report.status, report.filename).toBe('ingested');
      expect(report.chunks, report.filename).toBeGreaterThan(0);
    }
    expect(first.filter((report) => report.status === 'ingested' && report.pages !== null).map(({ filename }) => filename)).toHaveLength(3);
    const [{ chunks }] = await db.query<{ chunks: number }>('select count(*)::int as chunks from chunks');
    expect(chunks).toBe(first.reduce((sum, { chunks: n }) => sum + n, 0));

    const second = await ingestCorpus(db, fakeEmbedder);
    expect(second.map(({ status }) => status)).toEqual(Array(9).fill('skipped'));
    expect(second.map(({ chunks: n }) => n)).toEqual(first.map(({ chunks: n }) => n));
  });
});
