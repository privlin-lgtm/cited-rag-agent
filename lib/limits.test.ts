import { beforeEach, describe, expect, it } from 'vitest';
import { migrate } from '../scripts/migrate';
import { pgliteDb, type Db } from './db';
import {
  addCost,
  addEmbedTokens,
  assertBudget,
  assertEmbedBudget,
  clientKey,
  deleteExpiredWindows,
  EMBED_TOKENS_PER_DAY,
  LimitError,
  reserveQuestion,
  reserveUpload,
  windowStart,
} from './limits';

const now = new Date('2026-10-07T14:30:00Z');
let db: Db;

beforeEach(async () => {
  db = await pgliteDb();
  await migrate(db);
});

const limited = async (run: () => Promise<unknown>) => {
  const error = await run().then(
    () => null,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(LimitError);
  return error as LimitError;
};

describe('windowStart', () => {
  it('starts the UTC hour or the UTC day', () => {
    expect(windowStart(now, 'hour').toISOString()).toBe('2026-10-07T14:00:00.000Z');
    expect(windowStart(now, 'day').toISOString()).toBe('2026-10-07T00:00:00.000Z');
  });
});

describe('clientKey', () => {
  const headers = (value?: string) => new Headers(value ? { 'x-forwarded-for': value } : {});

  it('hashes the first forwarded address with the secret to 16 hex characters', () => {
    const key = clientKey(headers('203.0.113.9, 10.0.0.1'), 'secret');
    expect(key).toMatch(/^[0-9a-f]{16}$/);
    expect(key).toBe(clientKey(headers('203.0.113.9'), 'secret'));
    expect(key).not.toBe(clientKey(headers('203.0.113.10'), 'secret'));
    expect(key).not.toBe(clientKey(headers('203.0.113.9'), 'other secret'));
    expect(key).not.toContain('203');
  });

  it('shares one key when there is no forwarded address', () => {
    expect(clientKey(headers(), 'secret')).toBe(clientKey(headers(''), 'secret'));
  });
});

describe('reserveQuestion', () => {
  it('allows 15 questions an hour and refuses the 16th with its reset time', async () => {
    for (let i = 0; i < 15; i++) await reserveQuestion(db, 'abc', now);
    const error = await limited(() => reserveQuestion(db, 'abc', now));
    expect(error.message).toContain('15 questions an hour');
    expect(error.message).toContain('2026-10-07 15:00 UTC');
    expect(error.resetsAt.toISOString()).toBe('2026-10-07T15:00:00.000Z');
  });

  it('counts each address on its own, and starts again in the next hour', async () => {
    for (let i = 0; i < 15; i++) await reserveQuestion(db, 'abc', now);
    await reserveQuestion(db, 'other', now);
    await reserveQuestion(db, 'abc', new Date('2026-10-07T15:00:00Z'));
  });
});

describe('reserveUpload', () => {
  it('allows 10 uploads a day and refuses the 11th until midnight UTC', async () => {
    for (let i = 0; i < 10; i++) await reserveUpload(db, 'abc', now);
    const error = await limited(() => reserveUpload(db, 'abc', now));
    expect(error.message).toContain('10 uploads a day');
    expect(error.resetsAt.toISOString()).toBe('2026-10-08T00:00:00.000Z');
  });
});

describe('assertBudget', () => {
  it('refuses a new question once today\'s cost reaches the budget, in micro-dollars', async () => {
    await assertBudget(db, 1, now);
    await addCost(db, 0.4, now);
    await addCost(db, 0.35, now);
    await assertBudget(db, 1, now);
    await addCost(db, 0.25, now);
    const error = await limited(() => assertBudget(db, 1, now));
    expect(error.message).toContain('$1.00');
    expect(error.resetsAt.toISOString()).toBe('2026-10-08T00:00:00.000Z');
    await assertBudget(db, 1, new Date('2026-10-08T00:00:01Z'));
  });

  it('stores the cost rounded to whole micro-dollars', async () => {
    await addCost(db, 0.1234567, now);
    expect(await db.query('select count::float8 as count from usage_windows where bucket = $1', ['anthropic:usd'])).toEqual([{ count: 123457 }]);
  });
});

describe('assertEmbedBudget', () => {
  it('refuses once 2M embedding tokens are used today', async () => {
    await addEmbedTokens(db, EMBED_TOKENS_PER_DAY - 1, now);
    await assertEmbedBudget(db, now);
    await addEmbedTokens(db, 1, now);
    const error = await limited(() => assertEmbedBudget(db, now));
    expect(error.message).toContain('2,000,000 tokens a day');
  });
});

describe('deleteExpiredWindows', () => {
  it('removes windows that ended and keeps the current ones', async () => {
    await reserveQuestion(db, 'abc', new Date('2026-10-07T12:10:00Z'));
    await reserveQuestion(db, 'abc', now);
    await addCost(db, 0.1, new Date('2026-10-06T09:00:00Z'));
    await addCost(db, 0.1, now);
    await addEmbedTokens(db, 5, new Date('2026-10-05T09:00:00Z'));
    expect(await deleteExpiredWindows(db, now)).toBe(3);
    expect(await db.query(`select bucket, to_char(window_start at time zone 'UTC', 'YYYY-MM-DD HH24:MI') as window_start from usage_windows order by bucket`)).toEqual([
      { bucket: 'anthropic:usd', window_start: '2026-10-07 00:00' },
      { bucket: 'ask:ip:abc', window_start: '2026-10-07 14:00' },
    ]);
  });
});
