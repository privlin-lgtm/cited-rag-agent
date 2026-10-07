import type Anthropic from '@anthropic-ai/sdk';
import type {
  Message,
  MessageParam,
  SearchResultBlockParam,
  TextBlockParam,
  TextCitation,
  ToolResultBlockParam,
  ToolUseBlock,
  Usage,
} from '@anthropic-ai/sdk/resources/messages';
import type { Db } from '../db';
import type { Embedder } from '../embed';
import { checkCitations, type CitationCheck, type Excerpt, type SentResult } from './citations';
import { SYSTEM_PROMPT } from './prompt';
import { runTool, tools } from './tools';

export type ModelParams = Parameters<Anthropic['messages']['stream']>[0];

export const MAX_ROUNDS = 6;
export const MAX_TOKENS = 2000;
const EXCERPTS_ON_ERROR = 5;

export type ModelCall = (params: ModelParams, onText: (delta: string) => void) => Promise<Message>;

export const anthropicModel =
  (client: Anthropic): ModelCall =>
  (params, onText) => {
    const stream = client.messages.stream(params);
    stream.on('text', onText);
    return stream.finalMessage();
  };

export type StepEvent = {
  type: 'step';
  round: number;
  reason: string;
  tool: string;
  input: unknown;
  hits: { file: string; locator: string; score: number | null }[];
  fallback?: 'keyword';
  error?: string;
};

export type AgentEvent =
  | StepEvent
  | { type: 'answer'; text: string }
  | { type: 'citations'; status: 'complete' | 'cut_off' | 'declined'; segments: { text: string; refs: number[] }[]; results: CitationCheck[]; excerpts: Excerpt[] }
  | { type: 'error'; message: string; excerpts: Excerpt[] }
  | { type: 'usage'; anthropic?: Usage; embedTokens?: number };

export type AgentDeps = {
  model: ModelCall;
  modelId: string;
  db: Db;
  embed: Embedder;
  scope: string[];
  sourceUrlOf: (documentId: string) => string | null;
};

type Breakpoint = { cache_control?: SearchResultBlockParam['cache_control'] };

const fallbackExcerpts = (sent: SentResult[], sourceUrlOf: AgentDeps['sourceUrlOf']): Excerpt[] => {
  const seen = new Set<string>();
  return [...sent]
    .sort((a, b) => (b.score ?? -Infinity) - (a.score ?? -Infinity))
    .filter((entry) => !seen.has(entry.chunkId) && seen.add(entry.chunkId))
    .slice(0, EXCERPTS_ON_ERROR)
    .map((entry, i) => ({
      n: i + 1,
      chunkId: entry.chunkId,
      documentId: entry.documentId,
      file: entry.file,
      locator: entry.locator,
      sourceUrl: sourceUrlOf(entry.documentId),
      blocks: entry.blocks.map((block) => ({ text: block, cited: false })),
    }));
};

const reasons = (message: Message, uses: ToolUseBlock[]) => {
  const out: string[] = [];
  let pending: string[] = [];
  for (const block of message.content) {
    if (block.type === 'text') pending.push(block.text);
    else if (block.type === 'tool_use') {
      out.push(pending.join(' ').trim());
      pending = [];
    }
  }
  if (pending.length && out.length) out[out.length - 1] = `${out[out.length - 1]} ${pending.join(' ')}`.trim();
  return uses.map((_, i) => out[i] ?? '');
};

export const runAgent = async (deps: AgentDeps, question: string, emit: (event: AgentEvent) => void) => {
  const scope = new Set(deps.scope);
  const messages: MessageParam[] = [{ role: 'user', content: [{ type: 'text', text: question }] }];
  const sent: SentResult[] = [];
  const breakpoints: Breakpoint[] = [];

  for (let round = 0; ; round++) {
    const params: ModelParams = {
      model: deps.modelId,
      max_tokens: MAX_TOKENS,
      system: SYSTEM_PROMPT,
      tools,
      thinking: { type: 'between_tools' },
      messages,
      ...(round === MAX_ROUNDS ? { tool_choice: { type: 'none' as const } } : {}),
    };
    let message: Message;
    try {
      message = await deps.model(params, (text) => emit({ type: 'answer', text }));
    } catch (error) {
      emit({ type: 'error', message: error instanceof Error ? error.message : String(error), excerpts: fallbackExcerpts(sent, deps.sourceUrlOf) });
      return;
    }
    emit({ type: 'usage', anthropic: message.usage });
    messages.push({ role: 'assistant', content: message.content });

    if (message.stop_reason === 'refusal') {
      emit({ type: 'citations', status: 'declined', segments: [], results: [], excerpts: [] });
      return;
    }

    if (message.stop_reason === 'end_turn' || message.stop_reason === 'max_tokens') {
      const blocks = message.content.flatMap((block) => (block.type === 'text' ? [block] : []));
      const citations: TextCitation[] = blocks.flatMap((block) => block.citations ?? []);
      const { results, excerpts } = await checkCitations(deps.db, sent, scope, citations, deps.sourceUrlOf);
      let next = 0;
      emit({
        type: 'citations',
        status: message.stop_reason === 'end_turn' ? 'complete' : 'cut_off',
        segments: blocks.map((block) => ({ text: block.text, refs: (block.citations ?? []).map(() => next++) })),
        results,
        excerpts,
      });
      return;
    }

    if (message.stop_reason !== 'tool_use') throw new Error(`unexpected stop reason ${message.stop_reason}`);
    if (round === MAX_ROUNDS) throw new Error('the model asked for another tool after the last round');

    const uses = message.content.filter((block): block is ToolUseBlock => block.type === 'tool_use');
    const texts = reasons(message, uses);
    const runs = await Promise.all(uses.map((use) => runTool({ db: deps.db, embed: deps.embed, scope }, use.name, use.input)));
    const toolResults: ToolResultBlockParam[] = uses.map((use, i) => {
      const run = runs[i];
      for (const entry of run.entries) sent.push({ ...entry, index: sent.length, round: round + 1 });
      emit({ type: 'step', round: round + 1, reason: texts[i], tool: use.name, input: run.input, hits: run.hits, fallback: run.fallback, error: run.error });
      if (run.embedTokens) emit({ type: 'usage', embedTokens: run.embedTokens });
      return {
        type: 'tool_result',
        tool_use_id: use.id,
        content: run.content,
        ...(run.isError ? { is_error: true } : {}),
      };
    });

    const lastResult = toolResults[toolResults.length - 1];
    const lastBlock = (lastResult.content as (SearchResultBlockParam | TextBlockParam)[]).at(-1);
    if (lastBlock) {
      lastBlock.cache_control = { type: 'ephemeral' };
      breakpoints.push(lastBlock);
      if (breakpoints.length > 2) delete breakpoints.shift()?.cache_control;
    }
    messages.push({ role: 'user', content: toolResults });
  }
};
