import { describe, expect, it } from 'vitest';
import { resetSentence } from './notice';

const zone = { locale: 'en-GB', timeZone: 'Asia/Jerusalem' };
const sentence = (resetsAt: string, now: string) => resetSentence(new Date(resetsAt), new Date(now), zone);

describe('resetSentence', () => {
  it('gives the time alone when the reset falls on the visitor\'s own day', () => {
    expect(sentence('2026-10-07T15:00:00Z', '2026-10-07T14:30:00Z')).toBe('You can try again at 18:00.');
  });

  it('says tomorrow for the next local day, which is where a 00:00 UTC reset falls for Israel', () => {
    expect(sentence('2026-10-08T00:00:00Z', '2026-10-07T14:30:00Z')).toBe('You can try again tomorrow at 3:00.');
    expect(sentence('2026-10-30T00:00:00Z', '2026-10-29T10:00:00Z')).toBe('You can try again tomorrow at 2:00.');
  });

  it('counts the local day, not 24 hours: 23:30 local and a reset 90 minutes later is tomorrow', () => {
    expect(sentence('2026-10-07T22:00:00Z', '2026-10-07T20:30:00Z')).toBe('You can try again tomorrow at 1:00.');
  });

  it('names the weekday for a later day', () => {
    expect(sentence('2026-10-10T00:00:00Z', '2026-10-07T14:30:00Z')).toBe('You can try again on Saturday at 3:00.');
  });

  it('follows the time zone it is given', () => {
    expect(resetSentence(new Date('2026-10-08T00:00:00Z'), new Date('2026-10-07T14:30:00Z'), { locale: 'en-GB', timeZone: 'UTC' })).toBe('You can try again tomorrow at 0:00.');
    expect(resetSentence(new Date('2026-10-08T00:00:00Z'), new Date('2026-10-07T14:30:00Z'), { locale: 'en-US', timeZone: 'America/New_York' })).toBe('You can try again at 8:00 PM.');
  });
});
