import { createHmac } from 'node:crypto';
import type { Db } from './db';

export const ASK_PER_HOUR = 15;
export const UPLOAD_PER_DAY = 10;
export const EMBED_TOKENS_PER_DAY = 2_000_000;
const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

type Unit = 'hour' | 'day';

export class LimitError extends Error {
  constructor(
    message: string,
    readonly resetsAt: Date,
  ) {
    super(message);
  }
}

export const windowStart = (now: Date, unit: Unit) => {
  const length = unit === 'hour' ? HOUR_MS : DAY_MS;
  return new Date(Math.floor(now.getTime() / length) * length);
};

const windowEnd = (start: Date, unit: Unit) => new Date(start.getTime() + (unit === 'hour' ? HOUR_MS : DAY_MS));
const resets = (end: Date) => `It resets at ${end.toISOString().slice(0, 16).replace('T', ' ')} UTC.`;

export const clientKey = (headers: Headers, secret: string) =>
  createHmac('sha256', secret)
    .update(headers.get('x-forwarded-for')?.split(',')[0].trim() || 'unknown')
    .digest('hex')
    .slice(0, 16);

const add = async (db: Db, bucket: string, start: Date, amount: number) => {
  const [row] = await db.query<{ count: number }>(
    `insert into usage_windows (bucket, window_start, count) values ($1, $2::timestamptz, $3::bigint)
     on conflict (bucket, window_start) do update set count = usage_windows.count + $3::bigint
     returning count::float8 as count`,
    [bucket, start.toISOString(), amount],
  );
  return row.count;
};

const read = async (db: Db, bucket: string, start: Date) =>
  (
    await db.query<{ count: number }>('select count::float8 as count from usage_windows where bucket = $1 and window_start = $2::timestamptz', [
      bucket,
      start.toISOString(),
    ])
  )[0]?.count ?? 0;

export const reserveQuestion = async (db: Db, key: string, now = new Date()) => {
  const start = windowStart(now, 'hour');
  if ((await add(db, `ask:ip:${key}`, start, 1)) > ASK_PER_HOUR)
    throw new LimitError(`Question limit reached: ${ASK_PER_HOUR} questions an hour from one address. ${resets(windowEnd(start, 'hour'))}`, windowEnd(start, 'hour'));
};

export const reserveUpload = async (db: Db, key: string, now = new Date()) => {
  const start = windowStart(now, 'day');
  if ((await add(db, `upload:ip:${key}`, start, 1)) > UPLOAD_PER_DAY)
    throw new LimitError(`Upload limit reached: ${UPLOAD_PER_DAY} uploads a day from one address. ${resets(windowEnd(start, 'day'))}`, windowEnd(start, 'day'));
};

export const assertBudget = async (db: Db, budgetUsd: number, now = new Date()) => {
  const start = windowStart(now, 'day');
  if ((await read(db, 'anthropic:usd', start)) >= budgetUsd * 1e6)
    throw new LimitError(`Daily cost budget reached: the demo has spent its $${budgetUsd.toFixed(2)} for today. ${resets(windowEnd(start, 'day'))}`, windowEnd(start, 'day'));
};

export const assertEmbedBudget = async (db: Db, now = new Date()) => {
  const start = windowStart(now, 'day');
  if ((await read(db, 'embed:tokens', start)) >= EMBED_TOKENS_PER_DAY)
    throw new LimitError(`Embedding budget reached: ${EMBED_TOKENS_PER_DAY.toLocaleString('en-US')} tokens a day. ${resets(windowEnd(start, 'day'))}`, windowEnd(start, 'day'));
};

export const addCost = async (db: Db, usd: number, now = new Date()) => {
  await add(db, 'anthropic:usd', windowStart(now, 'day'), Math.round(usd * 1e6));
};

export const addEmbedTokens = async (db: Db, tokens: number, now = new Date()) => {
  await add(db, 'embed:tokens', windowStart(now, 'day'), tokens);
};

export const deleteExpiredWindows = async (db: Db, now = new Date()) =>
  (
    await db.query(
      `delete from usage_windows
       where (bucket like 'ask:%' and window_start <= $1::timestamptz - interval '1 hour')
          or (bucket not like 'ask:%' and window_start <= $1::timestamptz - interval '1 day')
       returning bucket`,
      [now.toISOString()],
    )
  ).length;
