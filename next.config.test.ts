import { describe, expect, it } from 'vitest';
import config from './next.config';

describe('next.config headers', () => {
  it.each(['/', '/api/health', '/api/ask'])('sets the three security headers on %s', async (path) => {
    const rules = (await config.headers?.()) ?? [];
    const headers = Object.fromEntries(
      rules
        .filter(({ source }) => new RegExp(`^${source}$`).test(path))
        .flatMap((rule) => rule.headers.map(({ key, value }) => [key, value])),
    );
    expect(headers).toEqual({
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
    });
  });
});
