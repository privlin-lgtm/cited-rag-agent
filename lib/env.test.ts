import { describe, expect, it } from 'vitest';
import { parseEnv } from './env';

const valid = {
  DATABASE_URL: 'postgresql://user:pw@localhost:5432/app',
  VOYAGE_API_KEY: 'test-voyage',
  ANTHROPIC_API_KEY: 'test-anthropic',
  IP_HASH_SECRET: 'test-ip-secret',
  CRON_SECRET: 'test-cron-secret',
};

describe('parseEnv', () => {
  it('accepts a complete environment and fills the defaults', () => {
    expect(parseEnv(valid)).toMatchObject({
      ANTHROPIC_MODEL: 'claude-sonnet-5-5',
      DAILY_ANTHROPIC_BUDGET_USD: 1,
      APP_ENV: 'local',
    });
  });

  it.each(['claude-unknown-9', 'toString'])('rejects ANTHROPIC_MODEL %s, which is not a key of lib/pricing.ts', (model) => {
    expect(() => parseEnv({ ...valid, ANTHROPIC_MODEL: model })).toThrow(/ANTHROPIC_MODEL/);
  });
});
