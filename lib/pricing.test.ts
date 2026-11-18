import { describe, expect, it } from 'vitest';
import { costUsd, usdPerMTok } from './pricing';

describe('costUsd', () => {
  it('prices Sonnet 5.5 at $2 input, $10 output, $0.10 cache read and $2.50 cache write per million tokens', () => {
    expect(usdPerMTok['claude-sonnet-5-5']).toEqual({ input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2.5 });
  });

  it('charges each kind of token at its own price', () => {
    const million = 1_000_000;
    expect(costUsd('claude-sonnet-5-5', { inputTokens: million, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 })).toBeCloseTo(2, 10);
    expect(costUsd('claude-sonnet-5-5', { inputTokens: 0, outputTokens: million, cacheReadTokens: 0, cacheWriteTokens: 0 })).toBeCloseTo(10, 10);
    expect(costUsd('claude-sonnet-5-5', { inputTokens: 0, outputTokens: 0, cacheReadTokens: million, cacheWriteTokens: 0 })).toBeCloseTo(0.1, 10);
    expect(costUsd('claude-sonnet-5-5', { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: million })).toBeCloseTo(2.5, 10);
  });

  it('adds the four parts of one call', () => {
    expect(costUsd('claude-sonnet-5-5', { inputTokens: 1000, outputTokens: 200, cacheReadTokens: 200_000, cacheWriteTokens: 4000 })).toBeCloseTo(0.002 + 0.002 + 0.02 + 0.01, 10);
  });
});
