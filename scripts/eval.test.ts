import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { pgliteDb, type Db } from '../lib/db';
import type { Question } from '../lib/evals';
import { fakeEmbedder } from '../lib/fake-embedder';
import { INGEST_VERSION, ingestDocument } from '../lib/ingest';
import { makePdf } from '../lib/test-pdf';
import { assertFresh, consoleText, corpusState, loadThreshold, markdown, runEval, verdict, type EvalReport } from './eval';
import { migrate } from './migrate';

const root = fileURLToPath(new URL('..', import.meta.url));
const bytes = (text: string) => new TextEncoder().encode(text);
const words = (prefix: string) => [1, 2, 3, 4, 5].map((i) => `${prefix}${i}`).join(' ');
const sha = (data: Uint8Array) => createHash('sha256').update(data).digest('hex');

const files = {
  'rules.pdf': { kind: 'pdf' as const, data: makePdf([[words('pa')], [words('pb')], [words('pc')]]) },
  'phases.md': { kind: 'md' as const, data: bytes(`# Transfers\n## Phases\n${words('ma')}\n\n## Quotes\n${words('mb')}`) },
  'rule.txt': { kind: 'txt' as const, data: bytes([1, 2, 3].map((n) => `${words(`t${'abc'[n - 1]}`)} `.repeat(30).trim()).join('\n\n')) },
};
const documents = Object.entries(files).map(([filename, { data }]) => ({ filename, sha256: sha(data) }));
const question = (id: string, text: string, ...expected: [string, string][]): Question => ({
  id,
  question: text,
  expected: expected.map(([filename, locator]) => ({ filename, locator })),
});

let db: Db;

const ingestAll = async (version = INGEST_VERSION) => {
  for (const [filename, { kind, data }] of Object.entries(files))
    await ingestDocument(db, fakeEmbedder, { collection: 'corpus', filename, kind, data }, version);
};

beforeEach(async () => {
  db = await pgliteDb();
  await migrate(db);
  await ingestAll();
});

describe('runEval ranks a question by the matching rule of the document type', () => {
  it('uses the exact page for PDF, the heading path and its children for Markdown, and overlapping lines for text', async () => {
    const chunkLocators = await db.query<{ locator: string }>(
      "select c.locator from chunks c join documents d on d.id = c.document_id where d.filename = 'rule.txt' order by c.ord",
    );
    expect(chunkLocators.map(({ locator }) => locator)).toEqual(['lines 1–3', 'lines 5–5']);

    const { rows } = await runEval(
      db,
      fakeEmbedder,
      [
        question('pdf-exact', `${words('pb')} pa1`, ['rules.pdf', 'p. 2']),
        question('pdf-neighbour', `${words('pb')} pa1`, ['rules.pdf', 'p. 1']),
        question('md-child-of-expected', words('ma'), ['phases.md', '§ Transfers']),
        question('md-sibling', words('ma'), ['phases.md', '§ Transfers › Quotes']),
        question('txt-overlap', words('tc'), ['rule.txt', 'lines 4–6']),
        question('txt-no-overlap', words('tc'), ['rule.txt', 'lines 1–1']),
        question('miss', words('pb'), ['rules.pdf', 'p. 99']),
      ],
      documents,
    );
    const rank = Object.fromEntries(rows.map(({ id, rank: value }) => [id, value]));
    expect(rank['pdf-exact']).toBe(1);
    expect(rank['pdf-neighbour']).toBe(2);
    expect(rank['md-child-of-expected']).toBe(1);
    expect(rank['md-sibling']).toBeGreaterThan(1);
    expect(rank['txt-overlap']).toBe(1);
    expect(rank['txt-no-overlap']).toBeGreaterThan(1);
    expect(rank.miss).toBeNull();
  });

  it('counts hit@1, hit@3, hit@5 and the mean reciprocal rank over the ranks it found', async () => {
    const report = await runEval(
      db,
      fakeEmbedder,
      [
        question('first', words('pb'), ['rules.pdf', 'p. 2']),
        question('second', `${words('pb')} pa1`, ['rules.pdf', 'p. 1']),
        question('miss', words('pb'), ['rules.pdf', 'p. 99']),
      ],
      documents,
    );
    expect(report.rows.map(({ rank }) => rank)).toEqual([1, 2, null]);
    expect(report.score).toEqual({ total: 3, hit1: 1, hit3: 2, hit5: 2, mrr: 0.5 });
  });

  it('embeds all questions in one query call, returns the top 3 hits with scores, and reports the tokens used', async () => {
    const embed = vi.fn(fakeEmbedder);
    const report = await runEval(db, embed, [question('a', words('pa'), ['rules.pdf', 'p. 1']), question('b', words('pb'), ['rules.pdf', 'p. 2'])], documents);
    expect(embed).toHaveBeenCalledTimes(1);
    expect(embed).toHaveBeenCalledWith([words('pa'), words('pb')], 'query');
    expect(report.tokens).toBe(Math.ceil(words('pa').length / 4) + Math.ceil(words('pb').length / 4));
    expect(report.rows[0].top).toHaveLength(3);
    expect(report.rows[0].top[0]).toMatchObject({ filename: 'rules.pdf', locator: 'p. 1' });
    expect(report.rows[0].top[0].score).toBeCloseTo(1, 5);
  });
});

describe('the stale-data check', () => {
  const ask = [question('a', words('pa'), ['rules.pdf', 'p. 1'])];

  it('passes when every manifest document is in the database at the current version with the manifest hash', async () => {
    await expect(runEval(db, fakeEmbedder, ask, documents)).resolves.toBeTruthy();
  });

  it('stops, naming the document, when a manifest document is missing, and never calls the embedder', async () => {
    const embed = vi.fn(fakeEmbedder);
    await expect(runEval(db, embed, ask, [...documents, { filename: 'ghost.md', sha256: 'a'.repeat(64) }])).rejects.toThrow(/ghost\.md: not in the database/);
    expect(embed).not.toHaveBeenCalled();
  });

  it('stops when a document has a different hash from the manifest', async () => {
    const changed = documents.map((entry) => (entry.filename === 'phases.md' ? { ...entry, sha256: 'b'.repeat(64) } : entry));
    await expect(runEval(db, fakeEmbedder, ask, changed)).rejects.toThrow(/phases\.md: sha256/);
  });

  it('stops when a document was ingested at an older version', async () => {
    db = await pgliteDb();
    await migrate(db);
    await ingestAll(INGEST_VERSION - 1);
    await expect(runEval(db, fakeEmbedder, ask, documents)).rejects.toThrow(new RegExp(`ingest version ${INGEST_VERSION - 1}, expected ${INGEST_VERSION}`));
  });

  it('lists every mismatch at once', async () => {
    const state = await corpusState(db);
    expect(() =>
      assertFresh(state, [
        { filename: 'x.md', sha256: 'c'.repeat(64) },
        { filename: 'y.md', sha256: 'd'.repeat(64) },
      ]),
    ).toThrow(/x\.md[\s\S]*y\.md/);
  });

  it('reads the corpus collection only', async () => {
    await ingestDocument(db, fakeEmbedder, { collection: 'upload:abc', filename: 'mine.md', kind: 'md', data: bytes('# Mine\nprivate text') });
    expect((await corpusState(db)).map(({ filename }) => filename)).toEqual(['phases.md', 'rule.txt', 'rules.pdf']);
  });
});

describe('the threshold exit code', () => {
  const report = (hit5: number, total: number) => ({ rows: [], score: { total, hit1: 0, hit3: 0, hit5, mrr: 0 }, tokens: 0 }) satisfies EvalReport;
  const threshold = { hitAt5: 11, of: 14, date: '2026-10-13', commit: 'abc1234' };

  it('exits 0 and only reports when there is no threshold file', () => {
    expect(verdict(report(0, 14), null)).toEqual({ code: 0, text: 'No evals/threshold.json: reporting only.' });
  });

  it('exits 0 at or above the threshold and 1 below it', () => {
    expect(verdict(report(11, 14), threshold).code).toBe(0);
    expect(verdict(report(14, 14), threshold).code).toBe(0);
    expect(verdict(report(10, 14), threshold).code).toBe(1);
    expect(verdict(report(0, 14), threshold).code).toBe(1);
  });

  it('compares fractions, so a longer question set is held to the same rate', () => {
    expect(verdict(report(12, 15), threshold).code).toBe(0);
    expect(verdict(report(11, 15), threshold).code).toBe(1);
  });

  it('says what it compared and where the threshold came from', () => {
    expect(verdict(report(10, 14), threshold).text).toBe('hit@5 10/14 is below the threshold 11/14 (set 2026-10-13 from abc1234)');
  });
});

describe('the committed threshold file', () => {
  it('holds a count out of the question set size, the date and the full commit of the first honest run', async () => {
    const threshold = await loadThreshold();
    expect(threshold).toEqual({ hitAt5: expect.any(Number), of: expect.any(Number), date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), commit: expect.stringMatching(/^[0-9a-f]{40}$/) });
    expect(threshold!.hitAt5).toBeLessThanOrEqual(threshold!.of);
  });
});

describe('the report', () => {
  const report: EvalReport = {
    rows: [
      { id: 'one', question: 'q1', rank: 1, top: [{ id: '1', documentId: 'd', filename: 'a.pdf', locator: 'p. 1', content: 'x', score: 0.5 }] },
      { id: 'two', question: 'q2', rank: null, top: [] },
    ],
    score: { total: 2, hit1: 1, hit3: 1, hit5: 1, mrr: 0.5 },
    tokens: 42,
  };

  it('prints each rank or miss, the metrics and the Voyage tokens', () => {
    const text = consoleText(report, { text: 'verdict line' });
    expect(text).toContain('one');
    expect(text).toContain('rank 1');
    expect(text).toContain('a.pdf · p. 1 · 0.500');
    expect(text).toContain('miss');
    expect(text).toMatch(/hit@1\s+1\/2 \(50%\)/);
    expect(text).toMatch(/MRR \(top 10\)\s+0\.500/);
    expect(text).toMatch(/Voyage tokens\s+42/);
    expect(text.endsWith('verdict line')).toBe(true);
  });

  it('writes the same figures as Markdown tables', () => {
    const text = markdown(report, { text: 'verdict line' });
    expect(text).toContain('| hit@5 | 1/2 (50%) |');
    expect(text).toContain('| MRR (top 10) | 0.500 |');
    expect(text).toContain('| Voyage tokens | 42 |');
    expect(text).toContain('| one | 1 | a.pdf · p. 1 · 0.500 |');
    expect(text).toContain('| two | miss |  |');
  });
});

describe('npm run eval with a missing variable', () => {
  const run = (env: Record<string, string>) =>
    spawnSync(process.execPath, ['--import', 'tsx', 'scripts/eval.ts'], {
      cwd: root,
      env: { NODE_ENV: 'test', PATH: process.env.PATH ?? '', SystemRoot: process.env.SystemRoot ?? '', ...env },
      encoding: 'utf8',
      timeout: 60_000,
    });

  it('exits non-zero and names both variables when neither is set', () => {
    const result = run({});
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('DATABASE_URL and VOYAGE_API_KEY are missing or empty');
  });

  it('exits non-zero and names only the empty variable', () => {
    const result = run({ DATABASE_URL: 'postgres://user:pw@localhost:1/db', VOYAGE_API_KEY: '' });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('VOYAGE_API_KEY is missing or empty');
    expect(result.stderr).not.toContain('DATABASE_URL');
  });
});
