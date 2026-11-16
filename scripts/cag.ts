import type { SearchResultBlockParam, TextCitation, Usage } from '@anthropic-ai/sdk/resources/messages';
import { checkCitations, type CitationCheck, type Excerpt, type SentResult } from '../lib/agent/citations';
import { MAX_TOKENS, type ModelCall, type ModelParams } from '../lib/agent/loop';
import { SYSTEM_PROMPT } from '../lib/agent/prompt';
import { asRun } from '../lib/agent/tools';
import type { Db } from '../lib/db';

export const CORPUS_CHUNKS_SQL = `select c.id::text as id, c.document_id::text as "documentId", d.filename, c.locator, c.content
  from chunks c join documents d on d.id = c.document_id
  where d.collection = $1
  order by d.filename, c.ord`;

export type CagContext = { blocks: SearchResultBlockParam[]; sent: SentResult[]; scope: ReadonlySet<string>; chunks: number; characters: number };

export const cagContext = async (db: Db, collection = 'corpus'): Promise<CagContext> => {
  const rows = await db.query<{ id: string; documentId: string; filename: string; locator: string; content: string }>(CORPUS_CHUNKS_SQL, [collection]);
  const run = asRun({}, rows.map((row) => ({ ...row, score: null })));
  if (!run.entries.length) throw new Error(`No chunks in collection "${collection}"; run npm run ingest:corpus.`);
  return {
    blocks: run.content as SearchResultBlockParam[],
    sent: run.entries.map((entry, index) => ({ ...entry, index, round: 0 })),
    scope: new Set(rows.map(({ documentId }) => documentId)),
    chunks: rows.length,
    characters: rows.reduce((sum, { content }) => sum + content.length, 0),
  };
};

export const cagParams = (modelId: string, { blocks }: Pick<CagContext, 'blocks'>, question: string): ModelParams => ({
  model: modelId,
  max_tokens: MAX_TOKENS,
  system: SYSTEM_PROMPT,
  thinking: { type: 'between_tools' },
  messages: [
    {
      role: 'user',
      content: [...blocks.slice(0, -1), { ...blocks[blocks.length - 1], cache_control: { type: 'ephemeral' } }, { type: 'text', text: question }],
    },
  ],
});

export type Outcome = {
  status: 'complete' | 'cut_off' | 'declined' | 'error';
  error?: string;
  answer: string;
  results: CitationCheck[];
  excerpts: Excerpt[];
  usages: Usage[];
  latencyMs: number;
  toolCalls: number;
};

export const askCag = async ({ db, model, modelId }: { db: Db; model: ModelCall; modelId: string }, context: CagContext, question: string): Promise<Outcome> => {
  const started = performance.now();
  const message = await model(cagParams(modelId, context, question), () => {});
  const latencyMs = Math.round(performance.now() - started);
  const base = { usages: [message.usage], latencyMs, toolCalls: 0 };
  if (message.stop_reason === 'refusal') return { ...base, status: 'declined', answer: '', results: [], excerpts: [] };
  if (message.stop_reason !== 'end_turn' && message.stop_reason !== 'max_tokens') throw new Error(`unexpected stop reason ${message.stop_reason}`);
  const blocks = message.content.flatMap((block) => (block.type === 'text' ? [block] : []));
  const citations: TextCitation[] = blocks.flatMap((block) => block.citations ?? []);
  const { results, excerpts } = await checkCitations(db, context.sent, context.scope, citations, () => null);
  return { ...base, status: message.stop_reason === 'end_turn' ? 'complete' : 'cut_off', answer: blocks.map(({ text }) => text).join(''), results, excerpts };
};
