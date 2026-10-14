import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import { postgresDb } from '../lib/db';
import { schema } from '../lib/env';
import { migrate, migrationSummary } from './migrate';

type Source = Record<string, string | undefined>;

const pooledLabel = /^([^.]+)-pooler\./;

const hostOf = (value: string | undefined) => (value && URL.canParse(value) ? new URL(value).hostname : undefined);

export const checkBuildEnv = (source: Source) => {
  const problems = new Map<string, string>();
  const add = (name: string, reason: string) => problems.has(name) || problems.set(name, reason);
  const unset = (name: string) => (source[name] === undefined ? 'is not set' : source[name] === '' ? 'is blank' : 'is invalid');

  for (const issue of schema.safeParse(source).error?.issues ?? []) add(String(issue.path[0]), unset(String(issue.path[0])));
  for (const name of ['ANTHROPIC_MODEL', 'DAILY_ANTHROPIC_BUDGET_USD', 'APP_ENV']) if (source[name] === undefined) add(name, 'is not set');

  const production = source.VERCEL_ENV === 'production';
  const expected = production ? 'production' : source.VERCEL_GIT_COMMIT_REF === 'qa' ? 'qa' : 'sandbox';
  if (source.APP_ENV !== expected) add('APP_ENV', `must be ${expected} on this deployment`);

  const databaseHost = hostOf(source.DATABASE_URL);
  if (databaseHost && !pooledLabel.test(databaseHost)) add('DATABASE_URL', 'must be the pooled host (its first label ends in -pooler)');

  if (!production) {
    const migrationHost = hostOf(source.MIGRATION_DATABASE_URL);
    if (!migrationHost) add('MIGRATION_DATABASE_URL', unset('MIGRATION_DATABASE_URL'));
    else if (pooledLabel.test(migrationHost)) add('MIGRATION_DATABASE_URL', 'must be the direct host, not the pooled one');
    else if (databaseHost && databaseHost.replace(pooledLabel, '$1.') !== migrationHost)
      add('MIGRATION_DATABASE_URL', 'must be the direct endpoint of the same database as DATABASE_URL');
  }

  if (problems.size)
    throw new Error(`Vercel build environment check failed:\n${[...problems].map(([name, reason]) => `- ${name} ${reason}`).join('\n')}`);
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!process.env.VERCEL) {
    console.error('vercel-build is for Vercel builds. For a local build, run npm run build.');
    process.exit(1);
  }
  checkBuildEnv(process.env);
  if (process.env.VERCEL_ENV !== 'production')
    console.log(migrationSummary(await migrate(postgresDb(z.url().parse(process.env.MIGRATION_DATABASE_URL)))));
  process.exit(spawnSync('next', ['build'], { stdio: 'inherit', shell: true }).status ?? 1);
}
