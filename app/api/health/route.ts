import { createHash } from 'node:crypto';
import { appDb } from '../../../lib/db';
import { env } from '../../../lib/env';

export const dynamic = 'force-dynamic';

export const GET = async () => {
  const { APP_ENV, DATABASE_URL } = env();
  const [last] = await appDb().query<{ name: string }>('select name from schema_migrations order by name desc limit 1');
  const database = createHash('sha256').update(new URL(DATABASE_URL).hostname).digest('hex').slice(0, 12);
  return Response.json({ env: APP_ENV, database, lastMigration: last?.name ?? null });
};
