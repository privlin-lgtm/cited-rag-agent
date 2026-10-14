import { readdir, readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import { postgresDb, type Db } from '../lib/db';

const dir = new URL('../db/migrations/', import.meta.url);
const lockKey = 5_151_905;

const lock = (tx: Db) => tx.query('select pg_advisory_xact_lock($1::bigint)', [lockKey]);

export const isApplied = async (db: Db, name: string) =>
  (await db.query('select 1 from schema_migrations where name = $1', [name])).length > 0;

export const migrationSummary = (applied: string[]) => (applied.length ? `applied ${applied.join(', ')}` : 'nothing to apply');

export const migrate = async (db: Db) => {
  await db.transaction(async (tx) => {
    await lock(tx);
    await tx.query(
      'create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())',
    );
  });
  const applied = new Set((await db.query<{ name: string }>('select name from schema_migrations')).map((row) => row.name));
  const pending = (await readdir(dir)).filter((file) => file.endsWith('.sql') && !applied.has(file)).sort();
  const ran: string[] = [];
  for (const name of pending)
    await db.transaction(async (tx) => {
      await lock(tx);
      if (await isApplied(tx, name)) return;
      await tx.query(await readFile(new URL(name, dir), 'utf8'));
      await tx.query('insert into schema_migrations (name) values ($1)', [name]);
      ran.push(name);
    });
  return ran;
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(migrationSummary(await migrate(postgresDb(z.url().parse(process.env.MIGRATION_DATABASE_URL)))));
  process.exit(0);
}
