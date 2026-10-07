import { beforeEach, describe, expect, it } from 'vitest';
import { pgliteDb, type Db } from '../lib/db';
import { migrate } from './migrate';

let db: Db;

beforeEach(async () => {
  db = await pgliteDb();
});

describe('migrate', () => {
  it('applies 0001_init.sql through Db and records it in schema_migrations', async () => {
    expect(await migrate(db)).toEqual(['0001_init.sql']);
    expect(await db.query('select name from schema_migrations')).toEqual([{ name: '0001_init.sql' }]);
    expect(
      await db.query("select table_name from information_schema.tables where table_schema = 'public' order by table_name"),
    ).toEqual([
      { table_name: 'chunks' },
      { table_name: 'documents' },
      { table_name: 'schema_migrations' },
      { table_name: 'usage_windows' },
    ]);
  });

  it('applies nothing on a second run', async () => {
    await migrate(db);
    expect(await migrate(db)).toEqual([]);
    expect(await db.query('select name from schema_migrations')).toEqual([{ name: '0001_init.sql' }]);
  });
});
