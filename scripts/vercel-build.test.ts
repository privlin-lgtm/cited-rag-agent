import { describe, expect, it } from 'vitest';
import { checkBuildEnv } from './vercel-build';

const pooled = 'postgresql://app:pw-pooled@ep-quiet-sky-123456-pooler.c-2.eu-central-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require';
const direct = 'postgresql://owner:pw-direct@ep-quiet-sky-123456.c-2.eu-central-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require';
const otherDirect = 'postgresql://owner:pw-other@ep-calm-moon-999999.c-2.eu-central-1.aws.neon.tech/neondb?sslmode=require';

const runtime = {
  DATABASE_URL: pooled,
  VOYAGE_API_KEY: 'voyage-secret-1',
  ANTHROPIC_API_KEY: 'anthropic-secret-1',
  ANTHROPIC_MODEL: 'claude-sonnet-5-5',
  DAILY_ANTHROPIC_BUDGET_USD: '3.00',
  IP_HASH_SECRET: 'ip-secret-1',
  CRON_SECRET: 'cron-secret-1',
};
const production: Record<string, string | undefined> = {
  ...runtime,
  VERCEL: '1',
  VERCEL_ENV: 'production',
  VERCEL_GIT_COMMIT_REF: 'master',
  APP_ENV: 'production',
};
const qa: Record<string, string | undefined> = {
  ...runtime,
  VERCEL: '1',
  VERCEL_ENV: 'preview',
  VERCEL_GIT_COMMIT_REF: 'qa',
  APP_ENV: 'qa',
  MIGRATION_DATABASE_URL: direct,
};
const sandbox: Record<string, string | undefined> = {
  ...qa,
  VERCEL_GIT_COMMIT_REF: 'm5-environments',
  APP_ENV: 'sandbox',
};

const failure = (env: Record<string, string | undefined>) => {
  try {
    checkBuildEnv(env);
  } catch (error) {
    return (error as Error).message;
  }
  return '';
};

const eight = ['DATABASE_URL', 'VOYAGE_API_KEY', 'ANTHROPIC_API_KEY', 'ANTHROPIC_MODEL', 'DAILY_ANTHROPIC_BUDGET_USD', 'IP_HASH_SECRET', 'CRON_SECRET', 'APP_ENV'];

describe('checkBuildEnv', () => {
  it.each([
    ['production', production],
    ['qa', qa],
    ['sandbox', sandbox],
  ])('accepts a complete %s environment', (_, env) => {
    expect(() => checkBuildEnv(env)).not.toThrow();
  });

  it('accepts production without MIGRATION_DATABASE_URL', () => {
    expect(() => checkBuildEnv({ ...production, MIGRATION_DATABASE_URL: undefined })).not.toThrow();
  });

  it.each(eight)('names %s when it is missing', (name) => {
    expect(failure({ ...production, [name]: undefined })).toContain(name);
  });

  it.each(eight)('names %s when it is blank', (name) => {
    expect(failure({ ...production, [name]: '' })).toContain(name);
  });

  it('does not rely on the defaults for ANTHROPIC_MODEL and DAILY_ANTHROPIC_BUDGET_USD', () => {
    const message = failure({ ...sandbox, ANTHROPIC_MODEL: undefined, DAILY_ANTHROPIC_BUDGET_USD: undefined });
    expect(message).toContain('ANTHROPIC_MODEL is not set');
    expect(message).toContain('DAILY_ANTHROPIC_BUDGET_USD is not set');
  });

  it.each([
    { expected: 'production', env: production, wrong: 'sandbox' },
    { expected: 'production', env: production, wrong: 'qa' },
    { expected: 'qa', env: qa, wrong: 'sandbox' },
    { expected: 'qa', env: qa, wrong: 'production' },
    { expected: 'sandbox', env: sandbox, wrong: 'qa' },
    { expected: 'sandbox', env: sandbox, wrong: 'production' },
  ])('expects APP_ENV $expected and rejects $wrong', ({ expected, env, wrong }) => {
    expect(failure({ ...env, APP_ENV: wrong })).toContain(`APP_ENV must be ${expected}`);
  });

  it('expects sandbox on a preview of any branch but qa', () => {
    expect(failure({ ...sandbox, VERCEL_GIT_COMMIT_REF: 'fix/anything', APP_ENV: 'qa' })).toContain('APP_ENV must be sandbox');
  });

  it('rejects a DATABASE_URL that is not pooled', () => {
    expect(failure({ ...production, DATABASE_URL: direct })).toContain('DATABASE_URL must be the pooled host');
  });

  it.each([undefined, ''])('requires MIGRATION_DATABASE_URL on a preview (%j)', (value) => {
    expect(failure({ ...sandbox, MIGRATION_DATABASE_URL: value })).toContain('MIGRATION_DATABASE_URL');
  });

  it('rejects a pooled MIGRATION_DATABASE_URL', () => {
    expect(failure({ ...sandbox, MIGRATION_DATABASE_URL: pooled })).toContain('MIGRATION_DATABASE_URL must be the direct host');
  });

  it('rejects URLs from two databases', () => {
    expect(failure({ ...sandbox, MIGRATION_DATABASE_URL: otherDirect })).toContain('MIGRATION_DATABASE_URL must be the direct endpoint of the same database');
  });

  it('lists every problem in one message', () => {
    const message = failure({ ...sandbox, VOYAGE_API_KEY: '', CRON_SECRET: undefined, APP_ENV: 'qa', MIGRATION_DATABASE_URL: pooled });
    for (const name of ['VOYAGE_API_KEY', 'CRON_SECRET', 'APP_ENV', 'MIGRATION_DATABASE_URL']) expect(message).toContain(name);
  });

  it('never prints a value', () => {
    const hostile = {
      VERCEL: '1',
      VERCEL_ENV: 'preview',
      VERCEL_GIT_COMMIT_REF: 'leak-ref',
      VOYAGE_API_KEY: 'leak-voyage',
      ANTHROPIC_API_KEY: 'leak-anthropic',
      IP_HASH_SECRET: 'leak-ip',
      CRON_SECRET: 'leak-cron',
      ANTHROPIC_MODEL: 'leak-model',
      DAILY_ANTHROPIC_BUDGET_USD: 'leak-budget',
      APP_ENV: 'leak-env',
    };
    const notPooled = failure({
      ...hostile,
      DATABASE_URL: 'postgresql://leak-user:leak-pw@leak-host.example.com/leak-db',
      MIGRATION_DATABASE_URL: 'postgresql://leak-user:leak-pw@leak-other-pooler.example.com/leak-db',
    });
    const notUrls = failure({ ...hostile, DATABASE_URL: 'leak-database', MIGRATION_DATABASE_URL: 'leak-migration' });
    for (const message of [notPooled, notUrls]) {
      for (const name of ['DATABASE_URL', 'MIGRATION_DATABASE_URL', 'ANTHROPIC_MODEL', 'DAILY_ANTHROPIC_BUDGET_USD', 'APP_ENV']) expect(message).toContain(name);
      expect(message).not.toMatch(/leak/);
    }
  });
});
