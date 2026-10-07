import { beforeEach, describe, expect, it } from 'vitest';
import { migrate } from '../scripts/migrate';
import { pgliteDb, type Db } from './db';

let db: Db;

beforeEach(async () => {
  db = await pgliteDb();
});

const vector = (weights: Record<number, number>) =>
  `[${Array.from({ length: 1024 }, (_, i) => weights[i] ?? 0).join(',')}]`;

describe('pgliteDb', () => {
  it('orders 1024-dimension vectors by cosine distance, nearest first', async () => {
    await migrate(db);
    const [doc] = await db.query<{ id: string }>(
      "insert into documents (collection, filename, kind, sha256, ingest_version) values ('corpus', 'a.md', 'md', 'abc', 1) returning id",
    );
    for (const [ord, hot] of [[0, 10], [1, 500], [2, 900]])
      await db.query('insert into chunks (document_id, ord, locator, content, embedding) values ($1, $2, $3, $4, $5::vector)', [
        doc.id,
        ord,
        `lines ${ord}`,
        `chunk ${ord}`,
        vector({ [hot]: 1 }),
      ]);
    const rows = await db.query<{ ord: number }>('select ord from chunks order by embedding <=> $1::vector', [
      vector({ 500: 1, 10: 0.5 }),
    ]);
    expect(rows.map((row) => row.ord)).toEqual([1, 0, 2]);
  });

  it('rolls a transaction back when its callback throws', async () => {
    await expect(
      db.transaction(async (tx) => {
        await tx.query('create table scratch (a int)');
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(await db.query("select to_regclass('scratch')::text as found")).toEqual([{ found: null }]);
  });
});
