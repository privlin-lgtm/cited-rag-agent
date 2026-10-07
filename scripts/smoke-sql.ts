import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import { postgresDb, type Db } from '../lib/db';
import { fakeEmbedder, fakeVector } from '../lib/fake-embedder';
import { ingestDocument } from '../lib/ingest';
import { keywordSearch, semanticSearch } from '../lib/search';
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
