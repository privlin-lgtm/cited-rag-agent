import { readdir, readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import { postgresDb, type Db } from '../lib/db';

const dir = new URL('../db/migrations/', import.meta.url);

export const migrate = async (db: Db) => {
  await db.query(
    'create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())',
  );
  const applied = new Set((await db.query<{ name: string }>('select name from schema_migrations')).map((row) => row.name));
  const pending = (await readdir(dir)).filter((file) => file.endsWith('.sql') && !applied.has(file)).sort();
  for (const name of pending)
    await db.transaction(async (tx) => {
      await tx.query(await readFile(new URL(name, dir), 'utf8'));
      await tx.query('insert into schema_migrations (name) values ($1)', [name]);
    });
  return pending;
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const applied = await migrate(postgresDb(z.url().parse(process.env.MIGRATION_DATABASE_URL)));
  console.log(applied.length ? `applied ${applied.join(', ')}` : 'nothing to apply');
  process.exit(0);
}
