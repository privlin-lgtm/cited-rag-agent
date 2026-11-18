import type { Message, MessageCountTokensParams, SearchResultBlockParam, StopReason, TextCitation, ToolResultBlockParam } from '@anthropic-ai/sdk/resources/messages';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { MAX_TOKENS, type ModelCall, type ModelParams } from '../lib/agent/loop';
import { SYSTEM_PROMPT } from '../lib/agent/prompt';
import { asRun } from '../lib/agent/tools';
import { setup, type Fixture } from '../lib/agent/test-setup';
import type { Question } from '../lib/evals';
import { fakeEmbedder } from '../lib/fake-embedder';
import { ingestDocument } from '../lib/ingest';
import { consoleText, reportMarkdown, runArm, summarise, type AnswerRow } from './answer-eval';
import { cagContext, cagParams, CORPUS_CHUNKS_SQL } from './cag';
import { countCag, countText } from './cag-count';
import { corpusState } from './eval';

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const root = fileURLToPath(new URL('..', import.meta.url));
let fixture: Fixture;
let documents: { filename: string; sha256: string }[];

beforeAll(async () => {
  fixture = await setup();
  await ingestDocument(fixture.db, fakeEmbedder, { collection: 'upload:abc', filename: 'private.md', kind: 'md', data: new TextEncoder().encode('# Private\nA visitor upload that CAG must never send.') });
  documents = (await corpusState(fixture.db)).map(({ filename, sha256 }) => ({ filename, sha256 }));
});

const usage = (write: number, read: number) => ({ input_tokens: 50, output_tokens: 20, cache_creation_input_tokens: write, cache_read_input_tokens: read });
const reply = (content: unknown[], stopReason: StopReason, use = usage(0, 0)) =>
  ({ id: 'msg', type: 'message', role: 'assistant', model: 'claude-sonnet-5-5', content, stop_reason: stopReason, stop_sequence: null, stop_details: null, usage: use }) as unknown as Message;
const text = (value: string, citations: TextCitation[] | null = null) => ({ type: 'text', text: value, citations });
const cite = (index: number, start = 0, end = start + 1): TextCitation => ({
  type: 'search_result_location',
  search_result_index: index,
  start_block_index: start,
  end_block_index: end,
  cited_text: 'ignored',
  source: 'chunk:0',
  title: null,
});
const question = (id: string, ...expected: [string, string][]): Question => ({ id, question: `Question ${id}?`, expected: expected.map(([filename, locator]) => ({ filename, locator })) });

const userBlocks = (params: ModelParams) => {
  const content = params.messages[0].content;
  return typeof content === 'string' ? [] : content;
};

describe('the CAG request', () => {
  it('sends every corpus chunk, in file and chunk order, as the search tool builds it, and no upload', async () => {
    const rows = await fixture.db.query<{ id: string; documentId: string; filename: string; locator: string; content: string }>(CORPUS_CHUNKS_SQL, ['corpus']);
    const context = await cagContext(fixture.db);
    expect(rows.map(({ filename }) => filename)).toEqual([...rows.map(({ filename }) => filename)].sort());
    expect(rows.some(({ filename }) => filename === 'private.md')).toBe(false);
    expect(context.blocks).toEqual(asRun({}, rows.map((row) => ({ ...row, score: null }))).content);
    expect(context.sent.map(({ index, chunkId }) => [index, chunkId])).toEqual(rows.map(({ id }, i) => [i, id]));
    expect(context.scope).toEqual(new Set(fixture.all));
    expect(context.blocks.every((block) => block.type === 'search_result' && block.citations?.enabled)).toBe(true);
  });

  it('uses the app model, prompt, thinking and token limit, no tools, one breakpoint on the last passage and the question after it', async () => {
    const context = await cagContext(fixture.db);
    const params = cagParams('claude-sonnet-5-5', context, 'How long to cancel?');
    expect(params).toMatchObject({ model: 'claude-sonnet-5-5', max_tokens: MAX_TOKENS, system: SYSTEM_PROMPT, thinking: { type: 'between_tools' } });
    expect(params).not.toHaveProperty('tools');
    expect(params).not.toHaveProperty('tool_choice');
    const blocks = userBlocks(params);
    expect(blocks).toHaveLength(context.blocks.length + 1);
    expect(blocks.at(-1)).toEqual({ type: 'text', text: 'How long to cancel?' });
    expect(blocks.filter((block) => 'cache_control' in block && block.cache_control).map((block) => blocks.indexOf(block))).toEqual([context.blocks.length - 1]);
    expect(context.blocks.at(-1)).not.toHaveProperty('cache_control');
  });

  it('keeps the cached prefix byte for byte the same from one question to the next', async () => {
    const context = await cagContext(fixture.db);
    const prefix = (q: string) => JSON.stringify({ ...cagParams('claude-sonnet-5-5', context, q), messages: [{ ...cagParams('claude-sonnet-5-5', context, q).messages[0], content: userBlocks(cagParams('claude-sonnet-5-5', context, q)).slice(0, -1) }] });
    expect(prefix('one')).toBe(prefix('two'));
  });

  it('refuses an empty collection with the ingest command to run', async () => {
    await expect(cagContext(fixture.db, 'nothing-here')).rejects.toThrow(/npm run ingest:corpus/);
  });
});

describe('the token count', () => {
  it('counts the CAG request without max_tokens and prices the corpus cold and warm', async () => {
    const seen: MessageCountTokensParams[] = [];
    const report = await countCag(fixture.db, async (params) => (seen.push(params), { input_tokens: 200_000 }), 'claude-sonnet-5-5', 'How long to cancel?', documents);
    const context = await cagContext(fixture.db);
    expect(seen).toHaveLength(1);
    expect(seen[0]).not.toHaveProperty('max_tokens');
    expect(seen[0]).not.toHaveProperty('tools');
    const { model, system, thinking, messages } = cagParams('claude-sonnet-5-5', context, 'How long to cancel?');
    expect(seen[0]).toEqual({ model, system, thinking, messages });
    expect(report).toMatchObject({ documents: 4, chunks: context.chunks, passages: context.blocks.length, tokens: 200_000, fits: true });
    expect(report.coldUsd).toBeCloseTo(0.5, 10);
    expect(report.warmUsd).toBeCloseTo(0.02, 10);
    expect(countText(report, 'claude-sonnet-5-5')).toMatch(/fits\s+yes/);
  });

  it('says it does not fit when the corpus and the answer exceed the context window', async () => {
    const report = await countCag(fixture.db, async () => ({ input_tokens: 999_000 }), 'claude-sonnet-5-5', 'q', documents);
    expect(report.fits).toBe(false);
    expect(countText(report, 'claude-sonnet-5-5')).toMatch(/fits\s+NO/);
  });

  it('stops on a stale database before calling the counter', async () => {
    const count = vi.fn(async () => ({ input_tokens: 1 }));
    await expect(countCag(fixture.db, count, 'claude-sonnet-5-5', 'q', [...documents, { filename: 'ghost.md', sha256: 'a'.repeat(64) }])).rejects.toThrow(/ghost\.md/);
    expect(count).not.toHaveBeenCalled();
  });
});

const titled = (blocks: unknown[], title: string) => (blocks as SearchResultBlockParam[]).findIndex((block) => block.type === 'search_result' && block.title === title);

describe('the CAG arm', () => {
  const cagModel = () => {
    const calls: ModelParams[] = [];
    const model: ModelCall = async (params) => {
      calls.push(params);
      const cancel = titled(userBlocks(params), 'cancel.md · § Cancellation');
      const sca = titled(userBlocks(params), 'sca.md · § Authentication');
      const use = calls.length === 1 ? usage(100_000, 0) : usage(0, 100_000);
      if (calls.length === 3) return reply([], 'refusal', use);
      return reply([text('Cancel within 30 minutes.', [cite(cancel, 0)]), text(' SCA has two elements.', [cite(sca, 0), cite(sca, 0, 99), cite(9999, 0)])], 'end_turn', use);
    };
    return { model, calls };
  };

  it('scores right source, the citation pass rate, cold and warm cost, and a declined answer', async () => {
    const { model, calls } = cagModel();
    const saved: number[] = [];
    const rows = await runArm(
      { db: fixture.db, model, modelId: 'claude-sonnet-5-5', embed: fakeEmbedder },
      'cag',
      [question('cancel', ['cancel.md', '§ Cancellation']), question('miss', ['settlement.md', '§ Settlement']), question('declined', ['cancel.md', '§ Cancellation'])],
      documents,
      (sofar) => saved.push(sofar.length),
    );
    expect(calls).toHaveLength(3);
    expect(saved).toEqual([1, 2, 3]);
    expect(rows.map(({ status, rightSource, passed, citations, cold }) => ({ status, rightSource, passed, citations, cold }))).toEqual([
      { status: 'complete', rightSource: true, passed: 2, citations: 4, cold: true },
      { status: 'complete', rightSource: false, passed: 2, citations: 4, cold: false },
      { status: 'declined', rightSource: false, passed: 0, citations: 0, cold: false },
    ]);
    expect(rows[0].cited).toEqual([
      { file: 'cancel.md', locator: '§ Cancellation', expected: true },
      { file: 'sca.md', locator: '§ Authentication', expected: false },
    ]);
    expect(rows[0].costUsd).toBeCloseTo((50 * 2 + 20 * 10 + 100_000 * 2.5) / 1e6, 10);
    expect(rows[1].costUsd).toBeCloseTo((50 * 2 + 20 * 10 + 100_000 * 0.1) / 1e6, 10);
    const summary = summarise(rows);
    expect(summary).toMatchObject({ questions: 3, rightSource: 1, citations: 8, passed: 4, passRate: 0.5, coldCount: 1, warmCount: 2 });
    expect(summary.coldUsd).toBeCloseTo(rows[0].costUsd, 10);
    expect(summary.warmMeanUsd).toBeCloseTo((rows[1].costUsd + rows[2].costUsd) / 2, 10);
  });

  it('records a failed call or an unexpected stop as an error row and goes on, with nothing cited', async () => {
    let n = 0;
    const model: ModelCall = async () => {
      n++;
      if (n === 1) throw new Error('529 overloaded');
      return reply([text('cut')], 'model_context_window_exceeded' as StopReason, usage(100_000, 0));
    };
    const rows = await runArm({ db: fixture.db, model, modelId: 'claude-sonnet-5-5', embed: fakeEmbedder }, 'cag', [question('a', ['cancel.md', '§ Cancellation']), question('b', ['cancel.md', '§ Cancellation'])], documents);
    expect(rows.map(({ status, error, cited, cold }) => ({ status, error, cited, cold }))).toEqual([
      { status: 'error', error: '529 overloaded', cited: [], cold: false },
      { status: 'error', error: 'unexpected stop reason model_context_window_exceeded', cited: [], cold: true },
    ]);
    expect(rows[1].costUsd).toBeGreaterThan(0.25);
  });

  it('stops the CAG arm when a second question writes the cache again, after saving its row', async () => {
    const model: ModelCall = async () => reply([text('No.')], 'end_turn', usage(100_000, 0));
    const saved: number[] = [];
    await expect(
      runArm({ db: fixture.db, model, modelId: 'claude-sonnet-5-5', embed: fakeEmbedder }, 'cag', ['a', 'b', 'c'].map((id) => question(id, ['cancel.md', '§ Cancellation'])), documents, (rows) => saved.push(rows.length)),
    ).rejects.toThrow(/Stopped after b: a second CAG question wrote the cache again/);
    expect(saved).toEqual([1, 2]);
  });

  it('stops on a stale database before calling the model', async () => {
    const model = vi.fn<ModelCall>();
    await expect(runArm({ db: fixture.db, model, modelId: 'claude-sonnet-5-5', embed: fakeEmbedder }, 'cag', [question('a', ['cancel.md', '§ Cancellation'])], [{ filename: 'ghost.md', sha256: 'a'.repeat(64) }])).rejects.toThrow(/ghost\.md/);
    expect(model).not.toHaveBeenCalled();
  });
});

describe('the RAG arm', () => {
  it('runs the app agent loop with its tools and scores the passing citations it returns', async () => {
    const calls: ModelParams[] = [];
    const model: ModelCall = async (params) => {
      calls.push(structuredClone(params));
      if (calls.length === 1) return reply([text('Looking.'), { type: 'tool_use', id: 't1', name: 'search_documents', input: { query: 'cancel a remittance transfer', k: 3 }, caller: { type: 'direct' } }], 'tool_use', usage(500, 0));
      const results = params.messages
        .flatMap((message) => (typeof message.content === 'string' ? [] : message.content))
        .filter((block): block is ToolResultBlockParam => block.type === 'tool_result')
        .flatMap((result) => (Array.isArray(result.content) ? result.content : []));
      return reply([text('Cancel within 30 minutes.', [cite(titled(results, 'cancel.md · § Cancellation'), 0)])], 'end_turn');
    };
    const [row] = await runArm({ db: fixture.db, model, modelId: 'claude-sonnet-5-5', embed: fakeEmbedder }, 'rag', [question('cancel', ['cancel.md', '§ Cancellation'])], documents);
    expect(calls[0].tools?.map((tool) => ('name' in tool ? tool.name : ''))).toContain('search_documents');
    expect(row).toMatchObject({ status: 'complete', rightSource: true, passed: 1, citations: 1, toolCalls: 1, inputTokens: 100, outputTokens: 40, cacheWriteTokens: 500, cold: false, answer: 'Cancel within 30 minutes.' });
  });

  it('records a model error as an error row and goes on', async () => {
    const model: ModelCall = async () => {
      throw new Error('529 overloaded');
    };
    const rows = await runArm({ db: fixture.db, model, modelId: 'claude-sonnet-5-5', embed: fakeEmbedder }, 'rag', [question('a', ['cancel.md', '§ Cancellation']), question('b', ['cancel.md', '§ Cancellation'])], documents);
    expect(rows.map(({ status, error, cited }) => [status, error, cited])).toEqual([
      ['error', '529 overloaded', []],
      ['error', '529 overloaded', []],
    ]);
  });
});

describe('the report', () => {
  const row = (id: string, overrides: Partial<AnswerRow> = {}): AnswerRow => ({
    id,
    question: `Question ${id}?`,
    expected: [{ filename: 'a.pdf', locator: 'p. 1' }],
    status: 'complete',
    answer: 'Line one.\nLine | two.',
    citations: 2,
    passed: 1,
    rightSource: true,
    cited: [{ file: 'a.pdf', locator: 'p. 1', expected: true }],
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    costUsd: 0.03,
    cold: false,
    latencyMs: 4000,
    toolCalls: 2,
    ...overrides,
  });
  const files = {
    rag: { arm: 'rag' as const, model: 'claude-sonnet-5-5', startedAt: '2026-11-16T10:00:00.000Z', rows: [row('one'), row('two', { rightSource: false })] },
    cag: { arm: 'cag' as const, model: 'claude-sonnet-5-5', startedAt: '2026-11-16T10:10:00.000Z', rows: [row('one', { cold: true, costUsd: 0.6, toolCalls: 0 }), row('two', { costUsd: 0.04, toolCalls: 0 })] },
  };

  it('puts both arms side by side with empty right, partly and wrong columns to mark', () => {
    const text = reportMarkdown(files);
    expect(text).toContain('| Question | RAG right | RAG partly | RAG wrong | CAG right | CAG partly | CAG wrong |');
    expect(text).toContain('| one |   |   |   |   |   |   |');
    expect(text).toContain('| | RAG | CAG |');
    expect(text).toContain('| Right source | yes | yes |');
    expect(text).toContain('| Right source | no | yes |');
    expect(text).toContain('| Cost | $0.0300 | $0.6000 (cold) |');
    expect(text).toContain('| Answer | Line one.<br>Line \\| two. | Line one.<br>Line \\| two. |');
    expect(text).toContain('| right source | 1/2 | 2/2 |');
    expect(text).toContain('| citations pass | 2/4 (50%) | 2/4 (50%) |');
    expect(text).toContain('| cold questions | n/a | 1, $0.6000 in all |');
    expect(text).toContain('| warm questions | n/a | 1, $0.0400 each on average |');
    expect(text).toContain('Expected: a.pdf · p. 1');
  });

  it('works with one arm and says which arm is missing a question', () => {
    expect(reportMarkdown({ rag: files.rag })).toContain('| Question | RAG right | RAG partly | RAG wrong |');
    expect(reportMarkdown({ rag: files.rag, cag: { ...files.cag, rows: [files.cag.rows[0]] } })).toContain('| Right source | no | not run |');
  });

  it('prints one line per question and the summary', () => {
    const text = consoleText(files.cag);
    expect(text).toContain('CAG arm, claude-sonnet-5-5');
    expect(text).toMatch(/one\s+complete\s+right source {2}1\/2 cited {2}\$0\.6000 cold {2}4\.0 s/);
    expect(text).toMatch(/latency\s+mean 4\.0 s, median 4\.0 s/);
  });
});

describe('the command line', () => {
  const run = (script: string, args: string[], env: Record<string, string>) =>
    spawnSync(process.execPath, ['--import', 'tsx', script, ...args], {
      cwd: root,
      env: { NODE_ENV: 'test', PATH: process.env.PATH ?? '', SystemRoot: process.env.SystemRoot ?? '', ...env },
      encoding: 'utf8',
      timeout: 60_000,
    });

  it('asks for an arm', () => {
    const result = run('scripts/answer-eval.ts', ['--arm', 'both'], {});
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Pass --arm rag or --arm cag');
  });

  it('names the missing variables for each arm', () => {
    expect(run('scripts/answer-eval.ts', ['--arm', 'rag'], {}).stderr).toContain('DATABASE_URL and ANTHROPIC_API_KEY and VOYAGE_API_KEY are missing or empty');
    expect(run('scripts/answer-eval.ts', ['--arm', 'cag'], { DATABASE_URL: 'postgres://u:p@localhost:1/db' }).stderr).toContain('ANTHROPIC_API_KEY is missing or empty');
    expect(run('scripts/cag-count.ts', [], {}).stderr).toContain('DATABASE_URL and ANTHROPIC_API_KEY are missing or empty');
  });

  it('refuses a model that has no price', () => {
    const result = run('scripts/cag-count.ts', [], { DATABASE_URL: 'postgres://u:p@localhost:1/db', ANTHROPIC_API_KEY: 'x', ANTHROPIC_MODEL: 'claude-unknown-9' });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('ANTHROPIC_MODEL claude-unknown-9 is not a key of lib/pricing.ts');
  });
});
