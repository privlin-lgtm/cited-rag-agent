export const usdPerMTok = {
  'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
} as const;

export type PricedModel = keyof typeof usdPerMTok;
export type TokenCounts = { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number };

export const costUsd = (model: PricedModel, { inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens }: TokenCounts) => {
  const price = usdPerMTok[model];
  return (inputTokens * price.input + outputTokens * price.output + cacheReadTokens * price.cacheRead + cacheWriteTokens * price.cacheWrite) / 1e6;
};
