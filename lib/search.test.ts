import { beforeEach, describe, expect, it, vi } from 'vitest';
import { migrate } from '../scripts/migrate';
import { pgliteDb, type Db } from './db';
import { fakeEmbedder, fakeVector } from './fake-embedder';
import { ingestDocument } from './ingest';
import { keywordSearch, SEMANTIC_SQL, semanticSearch } from './search';

const bytes = (text: string) => new TextEncoder().encode(text);

const fixtures = {
  'cancel.md': '# Cancellation\nA sender has 30 minutes to cancel a remittance transfer and receive a full refund.\n\n# Errors\nThe sender has 180 days to report an error on a remittance transfer.',
  'sca.md': '# Authentication\nStrong customer authentication requires two independent elements of knowledge, possession and inherence.\n\n# Exemptions\nLow value payments may be exempt from strong customer authentication.',
  'settlement.md': '# Settlement\nMojaloop settlement windows group transfers between participants before the hub settles net positions.',
  'rule.txt': 'Section 1005.33 sets the procedures for resolving errors.\n\nA provider must investigate promptly.',
} as const;

let db: Db;
const ids: Record<string, string> = {};
const everything = () => Object.values(ids);

beforeEach(async () => {
  db = await pgliteDb();
  await migrate(db);
  for (const [filename, text] of Object.entries(fixtures)) {
    await ingestDocument(db, fakeEmbedder, { collection: 'corpus', filename, kind: filename.endsWith('.md') ? 'md' : 'txt', data: bytes(text) });
    ids[filename] = (await db.query<{ id: string }>('select id from documents where filename = $1', [filename]))[0].id;
  }
});

describe('semanticSearch', () => {
  it('finds the chunk nearest the query, with its file, locator, content and a cosine score', async () => {
    const [top, second] = await semanticSearch(db, fakeVector('how long to cancel a remittance transfer'), { k: 3, documentIds: everything() });
    expect(top).toMatchObject({ filename: 'cancel.md', locator: '§ Cancellation' });
    expect(top.content).toContain('30 minutes');
    expect(top.id).toMatch(/^\d+$/);
    expect(top.score).toBeGreaterThan(second.score);
    expect(top.score).toBeLessThanOrEqual(1);
  });

  it('returns at most k hits, best first', async () => {
    const hits = await semanticSearch(db, fakeVector('remittance transfer'), { k: 2, documentIds: everything() });
    expect(hits).toHaveLength(2);
    expect(hits[0].score).toBeGreaterThanOrEqual(hits[1].score);
  });

  it('searches only the selected documents', async () => {
    const hits = await semanticSearch(db, fakeVector('remittance transfer cancel'), { k: 10, documentIds: [ids['settlement.md']] });
    expect(hits.map(({ filename }) => filename)).toEqual(['settlement.md']);
  });

  it('returns no hits for an empty selection without touching the database', async () => {
    const spy = { query: vi.fn(), transaction: vi.fn() } as unknown as Db;
    expect(await semanticSearch(spy, fakeVector('remittance'), { documentIds: [] })).toEqual([]);
    expect(spy.query).not.toHaveBeenCalled();
    expect(spy.transaction).not.toHaveBeenCalled();
  });

  it('ignores an id that is not a document, without a cast error', async () => {
    expect(await semanticSearch(db, fakeVector('remittance'), { documentIds: ['not-a-uuid'] })).toEqual([]);
  });
});

describe('semanticSearch behind a large, nearer cluster', () => {
  const random = (seed: number) => () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const next = random(7);
  const normalize = (vector: number[]) => vector.map((x) => x / Math.hypot(...vector));
  const noise = () => Array.from({ length: 1024 }, () => next() - 0.5);
  const literal = (vector: number[]) => `[${vector.join(',')}]`;
  const query = normalize(noise());
  let far: string;

  beforeEach(async () => {
    await db.query('delete from documents');
    await db.query("insert into documents (collection, filename, kind, sha256, ingest_version) values ('corpus', 'near.md', 'md', 'a', 1), ('corpus', 'far.md', 'md', 'b', 1)");
    const docs = await db.query<{ id: string; filename: string }>('select id, filename from documents');
    const near = docs.find(({ filename }) => filename === 'near.md')?.id;
    far = docs.find(({ filename }) => filename === 'far.md')?.id ?? '';
    for (let i = 0; i < 200; i++)
      await db.query('insert into chunks (document_id, ord, locator, content, embedding) values ($1, $2, $3, $4, $5::vector)', [
        near,
        i,
        `lines ${i}`,
        `near ${i}`,
        literal(normalize(query.map((x) => x + 0.02 * (next() - 0.5)))),
      ]);
    for (let i = 0; i < 5; i++)
      await db.query('insert into chunks (document_id, ord, locator, content, embedding) values ($1, $2, $3, $4, $5::vector)', [far, i, `lines ${i}`, `far ${i}`, literal(normalize(noise()))]);
    await db.query('set enable_seqscan = off');
  });

  it('plans the search through the HNSW index', async () => {
    const plan = (await db.query<Record<string, string>>(`explain ${SEMANTIC_SQL}`, [literal(query), 3, JSON.stringify([far])])).map((row) => Object.values(row)[0]).join('\n');
    expect(plan).toContain('chunks_embedding_idx');
  });

  it('returns k hits from the small distant document, or all of its chunks when it has fewer', async () => {
    const three = await semanticSearch(db, query, { k: 3, documentIds: [far] });
    expect(three).toHaveLength(3);
    expect(three.every(({ filename }) => filename === 'far.md')).toBe(true);
    expect(await semanticSearch(db, query, { k: 10, documentIds: [far] })).toHaveLength(5);
  });

  it('would return fewer hits without the iterative scan', async () => {
    const plain = await db.query(SEMANTIC_SQL, [literal(query), 3, JSON.stringify([far])]);
    expect(plain.length).toBeLessThan(3);
  });
});

describe('keywordSearch', () => {
  it('finds an exact phrase', async () => {
    const hits = await keywordSearch(db, 'strong customer authentication', { documentIds: everything() });
    expect(hits.map(({ filename }) => filename)).toEqual(['sca.md', 'sca.md']);
    expect(hits[0].score).toBeGreaterThanOrEqual(hits[1].score);
    expect(hits[0].score).toBeGreaterThan(0);
  });

  it('finds a section number', async () => {
    const [hit] = await keywordSearch(db, '1005.33', { documentIds: everything() });
    expect(hit).toMatchObject({ filename: 'rule.txt', locator: 'lines 1–3' });
  });

  it('returns nothing when no chunk matches', async () => {
    expect(await keywordSearch(db, 'blockchain', { documentIds: everything() })).toEqual([]);
  });

  it('searches only the selected documents', async () => {
    expect(await keywordSearch(db, 'remittance', { documentIds: [ids['settlement.md']] })).toEqual([]);
    expect((await keywordSearch(db, 'remittance', { documentIds: [ids['cancel.md']] })).length).toBe(2);
  });

  it('returns no hits for an empty selection without touching the database', async () => {
    const spy = { query: vi.fn(), transaction: vi.fn() } as unknown as Db;
    expect(await keywordSearch(spy, 'remittance', { documentIds: [] })).toEqual([]);
    expect(spy.query).not.toHaveBeenCalled();
  });

  it('lets OR join alternatives', async () => {
    const hits = await keywordSearch(db, '"strong customer authentication" OR settlement', { documentIds: everything() });
    expect(new Set(hits.map(({ filename }) => filename))).toEqual(new Set(['sca.md', 'settlement.md']));
  });
});
