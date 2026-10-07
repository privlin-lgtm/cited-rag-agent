import postgres from 'postgres';
import { beforeEach, describe, expect, it } from 'vitest';
import { migrate } from '../scripts/migrate';
import { pgliteDb, withoutChannelBinding, type Db } from './db';

const neonUrl = 'postgresql://user:p%40ss@ep-cool-123.eu-central-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require';

describe('withoutChannelBinding', () => {
  it('removes channel_binding and keeps the rest of the URL', () => {
    expect(withoutChannelBinding(neonUrl)).toBe(
      'postgresql://user:p%40ss@ep-cool-123.eu-central-1.aws.neon.tech/neondb?sslmode=require',
    );
    expect(withoutChannelBinding('postgresql://u:p@host/db?channel_binding=require')).toBe('postgresql://u:p@host/db');
  });

  it('leaves a URL without channel_binding unchanged', () => {
    expect(withoutChannelBinding('postgresql://u:p@host:5432/db?sslmode=require')).toBe(
      'postgresql://u:p@host:5432/db?sslmode=require',
    );
  });

  it('keeps channel_binding out of the startup parameters postgres.js sends', () => {
    expect(postgres(neonUrl).options.connection).toHaveProperty('channel_binding', 'require');
    expect(postgres(withoutChannelBinding(neonUrl)).options.connection).not.toHaveProperty('channel_binding');
  });
});

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
