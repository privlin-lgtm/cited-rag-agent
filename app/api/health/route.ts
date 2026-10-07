import { appDb } from '../../../lib/db';
import { env } from '../../../lib/env';

export const dynamic = 'force-dynamic';

export const GET = async () => {
  const { APP_ENV, DATABASE_URL } = env();
  const [last] = await appDb().query<{ name: string }>('select name from schema_migrations order by name desc limit 1');
  return Response.json({ env: APP_ENV, database: new URL(DATABASE_URL).hostname, lastMigration: last?.name ?? null });
};
