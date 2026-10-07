import { describe, expect, it } from 'vitest';
import { checkedCount, header, initialRun, markers, reduce, type CitationsEvent, type RunState, type WireEvent } from './run-state';

const step = (round: number, tool = 'search_documents'): WireEvent => ({ type: 'step', round, reason: '', tool, input: {}, hits: [] });
const play = (events: WireEvent[]): RunState => events.reduce(reduce, initialRun);

const citations = (results: CitationsEvent['results']): CitationsEvent => ({ type: 'citations', status: 'complete', segments: [], results, excerpts: [] });

describe('reduce', () => {
  it('keeps streamed text pending until the first step of its round arrives, then shows it as the step reason', () => {
    let state = play([{ type: 'answer', text: 'Looking for cancel' }, { type: 'answer', text: 'ation rules.' }]);
    expect(state.pending).toBe('Looking for cancelation rules.');
    state = reduce(state, step(1));
    expect(state.pending).toBe('');
    expect(state.steps).toHaveLength(1);
  });

  it('keeps the next round\'s text while its parallel steps arrive', () => {
    const state = play([step(1), step(1, 'keyword_search'), { type: 'answer', text: 'The answer starts' }, step(2)]);
    expect(state.steps.map(({ round }) => round)).toEqual([1, 1, 2]);
    expect(state.pending).toBe('');
    const second = play([step(1), { type: 'answer', text: 'Final' }, { type: 'answer', text: ' answer.' }]);
    expect(second.pending).toBe('Final answer.');
    expect(reduce(play([step(1), step(1, 'keyword_search')]), { type: 'answer', text: 'x' }).pending).toBe('x');
  });

  it('replaces the pending text with the citation segments, and drops it on an error', () => {
    const event = citations([]);
    expect(play([{ type: 'answer', text: 'Draft' }, event]).citations).toBe(event);
    expect(play([{ type: 'answer', text: 'Draft' }, event]).pending).toBe('');
    const failed = play([{ type: 'answer', text: 'Draft' }, { type: 'error', message: 'Overloaded', excerpts: [] }]);
    expect(failed.pending).toBe('');
    expect(failed.error?.message).toBe('Overloaded');
  });

  it('stores the done event', () => {
    const done: WireEvent = { type: 'done', model: 'm', inputTokens: 1, outputTokens: 2, cacheReadTokens: 3, cacheWriteTokens: 4, costUsd: 0.01, latencyMs: 5 };
    expect(play([done]).done).toBe(done);
  });
});

describe('citation display', () => {
  const event = citations([
    { ok: true, excerpt: 1, chunkId: '10', blocks: [0, 1] },
    { ok: true, excerpt: 1, chunkId: '10', blocks: [1, 2] },
    { ok: false, reason: 'text' },
    { ok: true, excerpt: 2, chunkId: '11', blocks: [0, 1] },
  ]);

  it('counts checked citations and words the header', () => {
    expect(checkedCount(event)).toBe(3);
    expect(header(event)).toBe('3 of 4 citations checked');
    expect(header(citations([]))).toBe('0 of 0 citations checked');
  });

  it('shows one marker per excerpt and one red marker per failed citation', () => {
    expect(markers(event, [0, 1, 2, 3])).toEqual([
      { kind: 'checked', n: 1 },
      { kind: 'unchecked', reason: 'text' },
      { kind: 'checked', n: 2 },
    ]);
    expect(markers(event, [9])).toEqual([{ kind: 'unchecked', reason: 'index' }]);
  });
});
