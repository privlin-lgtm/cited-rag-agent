import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import { checkCitations, type SentResult } from '../lib/agent/citations';
import { runTool } from '../lib/agent/tools';
import { postgresDb, type Db } from '../lib/db';
import { deleteExpiredUploads, deleteUpload, listDocuments } from '../lib/documents';
import { fakeEmbedder, fakeVector } from '../lib/fake-embedder';
import { ingestDocument } from '../lib/ingest';
import { addCost, addEmbedTokens, assertEmbedBudget, deleteExpiredWindows, releaseBudget, reserveBudget, reserveQuestion, reserveUpload } from '../lib/limits';
import { keywordSearch, semanticSearch } from '../lib/search';
import { ingestUpload } from '../lib/upload';
import { migrate } from './migrate';

class Rollback extends Error {}

const squash = (sql: string) => sql.replace(/\s+/g, ' ').trim().slice(0, 96);

export const traced = (db: Db, log: (line: string) => void): Db => ({
  query: async <T>(text: string, params?: unknown[]) => {
    const rows = await db.query<T>(text, params);
    log(`    ${squash(text)}  ->  ${rows.length} row${rows.length === 1 ? '' : 's'}`);
    return rows;
  },
  transaction: (fn) => db.transaction((tx) => fn(traced(tx, log))),
});

export const COLLECTION = 'smoke-test';
const bytes = (text: string) => new TextEncoder().encode(text);
const sample = '# Cancel\nA sender has 30 minutes to cancel a remittance transfer.\n\n# Errors\nThe sender has 180 days to report an error under § 1005.33.';

export type SmokeContext = { db: Db; step: (name: string) => void };
export type SmokeStep = (context: SmokeContext) => Promise<void>;

export const steps: SmokeStep[] = [
  async ({ db, step }) => {
    step('migrate: schema_migrations');
    await migrate(db);
  },
  async ({ db, step }) => {
    step('health: last migration');
    await db.query('select name from schema_migrations order by name desc limit 1');
  },
  async ({ db, step }) => {
    step('ingest: document and chunks (fake embedder)');
    const report = await ingestDocument(db, fakeEmbedder, { collection: COLLECTION, filename: 'smoke.md', kind: 'md', data: bytes(sample) });
    if (report.status !== 'ingested') throw new Error('smoke document was not ingested');
    step('ingest: unchanged document is skipped');
    const again = await ingestDocument(db, fakeEmbedder, { collection: COLLECTION, filename: 'smoke.md', kind: 'md', data: bytes(sample) });
    if (again.status !== 'skipped') throw new Error('smoke document was not skipped');
  },
  async ({ db, step }) => {
    const [{ id }] = await db.query<{ id: string }>('select id::text as id from documents where collection = $1', [COLLECTION]);
    step('search: semantic, scoped to the smoke document');
    const semantic = await semanticSearch(db, fakeVector('cancel a remittance transfer'), { k: 3, documentIds: [id] });
    if (!semantic.length) throw new Error('semantic search returned no hit');
    step('search: keyword, scoped to the smoke document');
    const keyword = await keywordSearch(db, '"1005.33"', { k: 3, documentIds: [id] });
    if (!keyword.length) throw new Error('keyword search returned no hit');
  },
  async ({ db, step }) => {
    step('limits: reserve question and upload, reserve and release budget, add cost and embedding tokens, check embedding budget, clear expired windows');
    const future = new Date('2099-01-01T12:00:00Z');
    await reserveQuestion(db, 'smoke-test', future);
    await reserveUpload(db, 'smoke-test', future);
    await reserveBudget(db, 1, future);
    await addCost(db, 0.0001, future);
    await releaseBudget(db, future);
    await addEmbedTokens(db, 10, future);
    await assertEmbedBudget(db, future, 10);
    if ((await deleteExpiredWindows(db, new Date('2099-01-03T00:00:00Z'))) < 1) throw new Error('expired windows were not cleared');
  },
  async ({ db, step }) => {
    step('documents: upload, list, expire, delete');
    const upload = await ingestUpload(db, fakeEmbedder, 'smoke-session', 'smoke-upload.md', bytes(sample));
    if (!(await listDocuments(db, 'smoke-session')).some(({ id }) => id === upload.id)) throw new Error('upload is not listed');
    if (!(await deleteUpload(db, 'smoke-session', upload.id))) throw new Error('upload was not deleted');
    await ingestUpload(db, fakeEmbedder, 'smoke-session', 'smoke-upload.md', bytes(sample));
    if ((await deleteExpiredUploads(db, new Date('2099-01-01T00:00:00Z'))) < 1) throw new Error('expired uploads were not deleted');
  },
  async ({ db, step }) => {
    const [{ id }] = await db.query<{ id: string }>('select id::text as id from documents where collection = $1', [COLLECTION]);
    const context = { db, embed: fakeEmbedder, scope: new Set([id]) };
    step('agent: search tools');
    const found = await runTool(context, 'search_documents', { query: 'cancel a remittance transfer', k: 3 });
    await runTool(context, 'keyword_search', { terms: '"1005.33"', k: 3 });
    step('agent: read_neighbours and list_documents');
    const [chunk] = await db.query<{ id: string }>('select id::text as id from chunks where document_id = $1::uuid order by ord limit 1', [id]);
    await runTool(context, 'read_neighbours', { chunk_id: chunk.id });
    await runTool(context, 'list_documents', {});
    step('agent: citation check');
    const sent: SentResult[] = found.entries.map((entry, index) => ({ ...entry, index, round: 1 }));
    const citation = { type: 'search_result_location' as const, search_result_index: 0, start_block_index: 0, end_block_index: 1, cited_text: '', source: '', title: null };
    const { results } = await checkCitations(db, sent, context.scope, [citation], () => null);
    if (!results[0].ok) throw new Error('citation check failed on a valid citation');
  },
];

export const runSmoke = async (db: Db, log: (line: string) => void = console.log) => {
  try {
    await db.transaction(async (tx) => {
      const context = { db: traced(tx, log), step: (name: string) => log(`  ${name}`) };
      for (const run of steps) await run(context);
      throw new Rollback('rolled back');
    });
  } catch (error) {
    if (!(error instanceof Rollback)) throw error;
  }
  const [{ left }] = await db.query<{ left: number }>('select count(*)::int as left from documents where collection = $1', [COLLECTION]);
  if (left !== 0) throw new Error(`${left} smoke documents were committed`);
  log('rolled back; nothing left behind');
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runSmoke(postgresDb(z.url().parse(process.env.DATABASE_URL)));
  process.exit(0);
}
