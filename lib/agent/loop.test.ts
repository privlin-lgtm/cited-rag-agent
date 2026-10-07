import type { Message, SearchResultBlockParam, StopReason, TextCitation, ToolResultBlockParam } from '@anthropic-ai/sdk/resources/messages';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Embedder } from '../embed';
import { fakeEmbedder } from '../fake-embedder';
import { runAgent, type AgentEvent, type ModelCall, type ModelParams } from './loop';
import { setup, type Fixture } from './test-setup';

let fixture: Fixture;

const usage = { input_tokens: 100, output_tokens: 20, cache_creation_input_tokens: null, cache_read_input_tokens: null };
const reply = (content: unknown[], stopReason: StopReason | null) =>
  ({ id: 'msg', type: 'message', role: 'assistant', model: 'claude-sonnet-5-5', content, stop_reason: stopReason, stop_sequence: null, stop_details: null, usage }) as unknown as Message;
const text = (value: string, citations: TextCitation[] | null = null) => ({ type: 'text', text: value, citations });
const toolUse = (id: string, name: string, input: unknown) => ({ type: 'tool_use', id, name, input, caller: { type: 'direct' } });
const cite = (index: number, start: number, end = start + 1): TextCitation => ({
  type: 'search_result_location',
  search_result_index: index,
  start_block_index: start,
  end_block_index: end,
  cited_text: 'ignored',
  source: 'chunk:0',
  title: null,
});

const scripted = (script: (calls: ModelParams[]) => Message | Error) => {
  const calls: ModelParams[] = [];
  const model: ModelCall = async (params, onText) => {
    calls.push(structuredClone(params));
    const next = script(calls);
    if (next instanceof Error) throw next;
    for (const block of next.content) if (block.type === 'text') onText(block.text);
    return next;
  };
  return { model, calls };
};

const run = async (model: ModelCall, { scope = fixture.all, embed = fakeEmbedder as Embedder } = {}) => {
  const events: AgentEvent[] = [];
  await runAgent({ model, modelId: 'claude-sonnet-5-5', db: fixture.db, embed, scope, sourceUrlOf: () => null }, 'How long to cancel?', (event) => events.push(event));
  return events;
};

const ofType = <T extends AgentEvent['type']>(events: AgentEvent[], type: T) => events.filter((event): event is Extract<AgentEvent, { type: T }> => event.type === type);

const toolResults = (params: ModelParams) =>
  params.messages.flatMap((message) => (typeof message.content === 'string' ? [] : message.content)).filter((block): block is ToolResultBlockParam => block.type === 'tool_result');

const searchResults = (params: ModelParams) =>
  toolResults(params)
    .flatMap((result) => (Array.isArray(result.content) ? result.content : []))
    .filter((block): block is SearchResultBlockParam => block.type === 'search_result');

const breakpoints = (params: ModelParams) =>
  toolResults(params)
    .flatMap((result) => (Array.isArray(result.content) ? result.content : []))
    .filter((block) => 'cache_control' in block && block.cache_control);

beforeEach(async () => {
  fixture = await setup();
});

describe('runAgent', () => {
  it('maps citations from either round through one global index and passes assistant turns back unchanged', async () => {
    const first = [text('Looking for cancellation rules.'), toolUse('t1', 'search_documents', { query: 'cancel a remittance transfer', k: 3 })];
    const second = [toolUse('t2', 'keyword_search', { terms: '1005.33' })];
    const { model, calls } = scripted((so) => {
      if (so.length === 1) return reply(first, 'tool_use');
      if (so.length === 2) return reply(second, 'tool_use');
      const titles = searchResults(so[2]).map(({ title }) => title);
      const roundOne = searchResults(so[1]).length;
      const cancel = titles.findIndex((title) => title === 'cancel.md · § Cancellation');
      const rule = titles.findIndex((title, i) => i >= roundOne && title.startsWith('rule.txt'));
      return reply([text('Cancel within 30 minutes. Errors follow section 1005.33.', [cite(cancel, 0), cite(rule, 0)])], 'end_turn');
    });
    const events = await run(model);

    expect(calls).toHaveLength(3);
    expect(ofType(events, 'step').map(({ round, tool }) => [round, tool])).toEqual([
      [1, 'search_documents'],
      [2, 'keyword_search'],
    ]);
    expect(ofType(events, 'step')[0].reason).toBe('Looking for cancellation rules.');
    expect(ofType(events, 'step')[1].reason).toBe('');
    expect(events.findIndex((event) => event.type === 'answer')).toBeLessThan(events.findIndex((event) => event.type === 'step'));

    const [citations] = ofType(events, 'citations');
    expect(citations.status).toBe('complete');
    expect(citations.results.map((result) => result.ok)).toEqual([true, true]);
    expect(citations.excerpts.map(({ file }) => file)).toEqual(['cancel.md', 'rule.txt']);
    expect(citations.segments).toEqual([{ text: 'Cancel within 30 minutes. Errors follow section 1005.33.', refs: [0, 1] }]);

    expect(calls[1].messages[1]).toEqual({ role: 'assistant', content: first });
    expect(calls[2].messages[3]).toEqual({ role: 'assistant', content: second });
    const sources = searchResults(calls[2]).map(({ source }) => source);
    expect(sources).toEqual([...searchResults(calls[1]).map(({ source }) => source), ...sources.slice(searchResults(calls[1]).length)]);
    expect(new Set(sources).size).toBeGreaterThan(1);
    expect(breakpoints(calls[1])).toHaveLength(1);
    expect(breakpoints(calls[2])).toHaveLength(2);
    expect(ofType(events, 'usage').filter(({ anthropic }) => anthropic)).toHaveLength(3);
    expect(ofType(events, 'usage').filter(({ embedTokens }) => embedTokens)).toHaveLength(1);
  });

  it('keeps tool results in tool_use order when the tools finish in another order', async () => {
    const slow: Embedder = async (texts, inputType) => {
      await new Promise((resolve) => setTimeout(resolve, 60));
      return fakeEmbedder(texts, inputType);
    };
    const { model, calls } = scripted((so) =>
      so.length === 1
        ? reply([toolUse('t1', 'search_documents', { query: 'cancel a remittance transfer', k: 1 }), toolUse('t2', 'keyword_search', { terms: '1005.33', k: 1 })], 'tool_use')
        : reply([text('Done.')], 'end_turn'),
    );
    const events = await run(model, { embed: slow });
    const results = toolResults(calls[1]);
    expect(results.map(({ tool_use_id }) => tool_use_id)).toEqual(['t1', 't2']);
    expect(searchResults(calls[1]).map(({ title }) => title)).toEqual(['cancel.md · § Cancellation', 'rule.txt · lines 1–3']);
    expect(ofType(events, 'step').map(({ tool }) => tool)).toEqual(['search_documents', 'keyword_search']);
  });

  it('sends one search_result per occurrence when two searches return the same chunk, and shows it once', async () => {
    const search = (id: string) => toolUse(id, 'search_documents', { query: 'cancel a remittance transfer', k: 1 });
    const { model } = scripted((so) =>
      so.length === 1 ? reply([search('t1'), search('t2')], 'tool_use') : reply([text('Cancel within 30 minutes.', [cite(0, 0), cite(1, 1)])], 'end_turn'),
    );
    const [citations] = ofType(await run(model), 'citations');
    expect(citations.results.map((result) => result.ok)).toEqual([true, true]);
    expect(citations.excerpts).toHaveLength(1);
    expect(citations.excerpts[0].blocks.map(({ cited }) => cited)).toEqual([true, true, false]);
  });

  it('ends a refused run with no citations', async () => {
    const { model, calls } = scripted(() => reply([text('I cannot help with that.')], 'refusal'));
    const events = await run(model);
    expect(calls).toHaveLength(1);
    expect(ofType(events, 'citations')).toEqual([{ type: 'citations', status: 'declined', segments: [], results: [], excerpts: [] }]);
    expect(ofType(events, 'step')).toEqual([]);
  });

  it('finishes a truncated answer as cut off, and still checks its citations', async () => {
    const { model } = scripted((so) =>
      so.length === 1
        ? reply([toolUse('t1', 'search_documents', { query: 'cancel a remittance transfer', k: 1 })], 'tool_use')
        : reply([text('A sender can cancel', [cite(0, 0)])], 'max_tokens'),
    );
    const [citations] = ofType(await run(model), 'citations');
    expect(citations.status).toBe('cut_off');
    expect(citations.results).toMatchObject([{ ok: true }]);
  });

  it('answers without any search and without citations', async () => {
    const { model } = scripted(() => reply([text('I have nothing to cite.')], 'end_turn'));
    const [citations] = ofType(await run(model), 'citations');
    expect(citations).toMatchObject({ status: 'complete', results: [], excerpts: [] });
  });

  it('makes the call after round 6 with tool_choice none, and never sends any other tool_choice or an effort', async () => {
    const { model, calls } = scripted((so) => (so.length <= 6 ? reply([toolUse(`t${so.length}`, 'list_documents', {})], 'tool_use') : reply([text('Final answer.')], 'end_turn')));
    const events = await run(model);
    expect(calls).toHaveLength(7);
    calls.slice(0, 6).forEach((params) => expect(params).not.toHaveProperty('tool_choice'));
    expect(calls[6].tool_choice).toEqual({ type: 'none' });
    expect(calls[6].tools).toHaveLength(4);
    for (const params of calls) {
      expect(params.thinking).toEqual({ type: 'between_tools' });
      expect(params.max_tokens).toBe(2000);
      expect(params.model).toBe('claude-sonnet-5-5');
      expect(JSON.stringify(params)).not.toMatch(/effort|"type":"any"|"type":"tool"/);
    }
    expect(ofType(events, 'step')).toHaveLength(6);
  });

  it('throws when the model still asks for a tool on the call after round 6', async () => {
    const { model } = scripted((so) => reply([toolUse(`t${so.length}`, 'list_documents', {})], 'tool_use'));
    await expect(run(model)).rejects.toThrow('another tool after the last round');
  });

  it('throws on a stop reason it cannot handle', async () => {
    const { model } = scripted(() => reply([text('Paused.')], 'pause_turn'));
    await expect(run(model)).rejects.toThrow('unexpected stop reason pause_turn');
  });

  it('reports a model failure with the passages retrieved so far, and records usage only for calls that returned', async () => {
    const { model } = scripted((so) =>
      so.length === 1 ? reply([toolUse('t1', 'search_documents', { query: 'cancel a remittance transfer', k: 2 })], 'tool_use') : new Error('Overloaded'),
    );
    const events = await run(model);
    const [error] = ofType(events, 'error');
    expect(error.message).toBe('Overloaded');
    expect(error.excerpts.length).toBeGreaterThan(0);
    expect(error.excerpts[0]).toMatchObject({ n: 1, file: 'cancel.md' });
    expect(error.excerpts.every(({ blocks }) => blocks.every(({ cited }) => !cited))).toBe(true);
    expect(ofType(events, 'citations')).toEqual([]);
    expect(ofType(events, 'usage').filter(({ anthropic }) => anthropic)).toHaveLength(1);
  });

  it('answers an unknown tool and invalid input with error results and carries on', async () => {
    const { model, calls } = scripted((so) =>
      so.length === 1
        ? reply([toolUse('t1', 'drop_tables', {}), toolUse('t2', 'search_documents', { query: 'x', k: 50 })], 'tool_use')
        : reply([text('Sorry.')], 'end_turn'),
    );
    const events = await run(model);
    expect(toolResults(calls[1]).map(({ tool_use_id, is_error }) => [tool_use_id, is_error])).toEqual([
      ['t1', true],
      ['t2', true],
    ]);
    expect(ofType(events, 'step').every(({ error }) => Boolean(error))).toBe(true);
  });

  it('uses keyword search for a call whose query cannot be embedded, and says so', async () => {
    const failing: Embedder = async () => {
      throw new Error('Voyage is down');
    };
    const { model } = scripted((so) =>
      so.length === 1 ? reply([toolUse('t1', 'search_documents', { query: 'how long to cancel a remittance transfer' })], 'tool_use') : reply([text('Done.')], 'end_turn'),
    );
    const [step] = ofType(await run(model, { embed: failing }), 'step');
    expect(step.fallback).toBe('keyword');
    expect(step.hits.length).toBeGreaterThan(0);
  });

  it('cannot be pushed outside its scope by a tool argument, so a citation of what was never sent fails as unchecked', async () => {
    const outside = [toolUse('t1', 'search_documents', { query: 'settlement windows', document_ids: [fixture.ids['settlement.md']] })];
    const { model, calls } = scripted((so) => (so.length === 1 ? reply(outside, 'tool_use') : reply([text('Windows group transfers.', [cite(0, 0)])], 'end_turn')));
    const events = await run(model, { scope: [fixture.ids['cancel.md']] });
    expect(toolResults(calls[1])[0]).toMatchObject({ is_error: true });
    expect(searchResults(calls[1])).toEqual([]);
    expect(ofType(events, 'citations')[0].results).toEqual([{ ok: false, reason: 'index' }]);
  });
});
