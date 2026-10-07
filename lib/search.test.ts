import { beforeEach, describe, expect, it } from 'vitest';
import { migrate } from '../scripts/migrate';
import { pgliteDb, type Db } from './db';
import { fakeEmbedder, fakeVector } from './fake-embedder';
import { ingestDocument } from './ingest';
import { keywordSearch, semanticSearch } from './search';

const bytes = (text: string) => new TextEncoder().encode(text);

const fixtures = {
  'cancel.md': '# Cancellation\nA sender has 30 minutes to cancel a remittance transfer and receive a full refund.\n\n# Errors\nThe sender has 180 days to report an error on a remittance transfer.',
  'sca.md': '# Authentication\nStrong customer authentication requires two independent elements of knowledge, possession and inherence.\n\n# Exemptions\nLow value payments may be exempt from strong customer authentication.',
  'settlement.md': '# Settlement\nMojaloop settlement windows group transfers between participants before the hub settles net positions.',
  'rule.txt': 'Section 1005.33 sets the procedures for resolving errors.\n\nA provider must investigate promptly.',
} as const;

let db: Db;
const ids: Record<string, string> = {};

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
    const [top, second] = await semanticSearch(db, fakeVector('how long to cancel a remittance transfer'), { k: 3 });
    expect(top).toMatchObject({ filename: 'cancel.md', locator: '§ Cancellation' });
    expect(top.content).toContain('30 minutes');
    expect(top.id).toMatch(/^\d+$/);
    expect(top.score).toBeGreaterThan(second.score);
    expect(top.score).toBeLessThanOrEqual(1);
  });

  it('returns at most k hits, best first', async () => {
    const hits = await semanticSearch(db, fakeVector('remittance transfer'), { k: 2 });
    expect(hits).toHaveLength(2);
    expect(hits[0].score).toBeGreaterThanOrEqual(hits[1].score);
  });

  it('searches only the selected documents', async () => {
    const hits = await semanticSearch(db, fakeVector('remittance transfer cancel'), { k: 10, documentIds: [ids['settlement.md']] });
    expect(hits.map(({ filename }) => filename)).toEqual(['settlement.md']);
    expect(await semanticSearch(db, fakeVector('remittance'), { documentIds: [] })).toEqual([]);
  });
});

describe('keywordSearch', () => {
  it('finds an exact phrase', async () => {
    const hits = await keywordSearch(db, 'strong customer authentication');
    expect(hits.map(({ filename }) => filename)).toEqual(['sca.md', 'sca.md']);
    expect(hits[0].score).toBeGreaterThanOrEqual(hits[1].score);
    expect(hits[0].score).toBeGreaterThan(0);
  });

  it('finds a section number', async () => {
    const [hit] = await keywordSearch(db, '1005.33');
    expect(hit).toMatchObject({ filename: 'rule.txt', locator: 'lines 1–3' });
  });

  it('returns nothing when no chunk matches', async () => {
    expect(await keywordSearch(db, 'blockchain')).toEqual([]);
  });

  it('searches only the selected documents', async () => {
    expect(await keywordSearch(db, 'remittance', { documentIds: [ids['settlement.md']] })).toEqual([]);
    expect((await keywordSearch(db, 'remittance', { documentIds: [ids['cancel.md']] })).length).toBe(2);
  });
});
