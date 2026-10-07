import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { GET } from './route';

const state = vi.hoisted(() => ({ url: '' }));

vi.mock('../../../lib/env', () => ({ env: () => ({ APP_ENV: 'sandbox', DATABASE_URL: state.url }) }));
vi.mock('../../../lib/db', () => ({ appDb: () => ({ query: async () => [{ name: '0001_init.sql' }] }) }));

const health = async (host: string) => {
  state.url = `postgresql://user:pw@${host}/neondb?sslmode=require`;
  return (await GET()).json();
};

describe('GET /api/health', () => {
  it('reports the first 12 hex characters of the SHA-256 of the database host, not the host', async () => {
    const host = 'ep-cool-123.eu-central-1.aws.neon.tech';
    expect(await health(host)).toEqual({
      env: 'sandbox',
      database: createHash('sha256').update(host).digest('hex').slice(0, 12),
      lastMigration: '0001_init.sql',
    });
  });

  it('tells two environments apart', async () => {
    const sandbox = await health('ep-sandbox-1.eu-central-1.aws.neon.tech');
    const qa = await health('ep-qa-2.eu-central-1.aws.neon.tech');
    expect(sandbox.database).toMatch(/^[0-9a-f]{12}$/);
    expect(sandbox.database).not.toBe(qa.database);
  });
});
