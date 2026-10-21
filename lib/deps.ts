import Anthropic from '@anthropic-ai/sdk';
import { anthropicModel } from './agent/loop';
import type { ApiDeps } from './api';
import { appDb } from './db';
import { createEmbedder } from './embed';
import { env } from './env';
import type { PricedModel } from './pricing';
import { sessionId } from './session';

export const apiDeps = (): ApiDeps => {
  const settings = env();
  return {
    db: appDb(),
    now: () => new Date(),
    sessionId,
    ipSecret: settings.IP_HASH_SECRET,
    cronSecret: settings.CRON_SECRET,
    budgetUsd: settings.DAILY_ANTHROPIC_BUDGET_USD,
    model: { id: settings.ANTHROPIC_MODEL as PricedModel, call: anthropicModel(new Anthropic({ apiKey: settings.ANTHROPIC_API_KEY })) },
    queryEmbedder: createEmbedder({ apiKey: settings.VOYAGE_API_KEY, maxRetries: 0, timeoutMs: 5000 }),
    documentEmbedder: createEmbedder({ apiKey: settings.VOYAGE_API_KEY }),
  };
};
