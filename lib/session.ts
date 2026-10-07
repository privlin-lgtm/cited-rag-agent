import { randomBytes } from 'node:crypto';
import { cookies } from 'next/headers';
import { env } from './env';

const COOKIE = 'sid';
const SESSION_ID = /^[0-9a-f]{32}$/;

export const sessionId = async ({ create }: { create: boolean }) => {
  const jar = await cookies();
  const existing = jar.get(COOKIE)?.value;
  if (existing && SESSION_ID.test(existing)) return existing;
  if (!create) return undefined;
  const id = randomBytes(16).toString('hex');
  jar.set(COOKIE, id, { httpOnly: true, sameSite: 'lax', secure: env().APP_ENV !== 'local', path: '/', maxAge: 24 * 60 * 60 });
  return id;
};
