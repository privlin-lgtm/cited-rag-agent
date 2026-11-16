import Anthropic from '@anthropic-ai/sdk';
import type { MessageCountTokensParams } from '@anthropic-ai/sdk/resources/messages';
import { pathToFileURL } from 'node:url';
import { MAX_TOKENS } from '../lib/agent/loop';
import { loadManifest } from '../lib/corpus';
import { postgresDb, type Db } from '../lib/db';
import { loadQuestions } from '../lib/evals';
import { usdPerMTok, type PricedModel } from '../lib/pricing';
import { cagContext, cagParams } from './cag';
import { assertFresh, corpusState } from './eval';

export const CONTEXT_TOKENS = 1_000_000;

export type TokenCounter = (params: MessageCountTokensParams) => Promise<{ input_tokens: number }>;

export const countCag = async (db: Db, count: TokenCounter, modelId: PricedModel, question: string, documents: { filename: string; sha256: string }[]) => {
  assertFresh(await corpusState(db), documents);
  const context = await cagContext(db);
  const { model, system, thinking, messages } = cagParams(modelId, context, question);
  const { input_tokens: tokens } = await count({ model, system, thinking, messages });
  const price = usdPerMTok[modelId];
  return {
    documents: context.scope.size,
    chunks: context.chunks,
    passages: context.blocks.length,
    sentences: context.sent.reduce((sum, { blocks }) => sum + blocks.length, 0),
    characters: context.characters,
    tokens,
    fits: tokens + MAX_TOKENS <= CONTEXT_TOKENS,
    coldUsd: (tokens * price.cacheWrite) / 1e6,
    warmUsd: (tokens * price.cacheRead) / 1e6,
  };
};

export const countText = (report: Awaited<ReturnType<typeof countCag>>, modelId: string) =>
  [
    `model           ${modelId}`,
    `documents       ${report.documents}`,
    `chunks          ${report.chunks} (${report.passages} sent as search_result blocks, ${report.sentences} sentence blocks)`,
    `characters      ${report.characters}`,
    `input tokens    ${report.tokens} (exact, from messages.count_tokens, one question included)`,
    `fits            ${report.fits ? 'yes' : 'NO'}: ${report.tokens} + ${MAX_TOKENS} output of ${CONTEXT_TOKENS}`,
    `cold question   $${report.coldUsd.toFixed(4)} for the corpus (5-minute cache write), plus output`,
    `warm question   $${report.warmUsd.toFixed(4)} for the corpus (cache read), plus output`,
  ].join('\n');

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const missing = ['DATABASE_URL', 'ANTHROPIC_API_KEY'].filter((name) => !process.env[name]?.trim());
  if (missing.length) {
    console.error(`${missing.join(' and ')} ${missing.length > 1 ? 'are' : 'is'} missing or empty`);
    process.exit(1);
  }
  const modelId = process.env.ANTHROPIC_MODEL?.trim() || 'claude-sonnet-5-5';
  if (!Object.hasOwn(usdPerMTok, modelId)) {
    console.error(`ANTHROPIC_MODEL ${modelId} is not a key of lib/pricing.ts`);
    process.exit(1);
  }
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const [first] = await loadQuestions();
  const report = await countCag(
    postgresDb(process.env.DATABASE_URL!),
    (params) => client.messages.countTokens(params),
    modelId as PricedModel,
    first.question,
    (await loadManifest()).documents,
  );
  console.log(countText(report, modelId));
  process.exit(report.fits ? 0 : 1);
}
