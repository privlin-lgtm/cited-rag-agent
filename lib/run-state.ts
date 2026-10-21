import type { CitationCheck, Excerpt } from './agent/citations';
import type { StepEvent } from './agent/loop';

export type DoneEvent = {
  type: 'done';
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsd: number;
  latencyMs: number;
};

export type CitationsEvent = {
  type: 'citations';
  status: 'complete' | 'cut_off' | 'declined';
  segments: { text: string; refs: number[] }[];
  results: CitationCheck[];
  excerpts: Excerpt[];
};

export type ErrorEvent = { type: 'error'; message: string; excerpts: Excerpt[] };

export type WireEvent = StepEvent | { type: 'answer'; text: string } | CitationsEvent | ErrorEvent | DoneEvent;

export type RunState = { steps: StepEvent[]; pending: string; citations?: CitationsEvent; error?: ErrorEvent; done?: DoneEvent };

export const initialRun: RunState = { steps: [], pending: '' };

export const reduce = (state: RunState, event: WireEvent): RunState => {
  switch (event.type) {
    case 'answer':
      return { ...state, pending: state.pending + event.text };
    case 'step':
      return { ...state, steps: [...state.steps, event], pending: state.steps.some(({ round }) => round === event.round) ? state.pending : '' };
    case 'citations':
      return { ...state, citations: event, pending: '' };
    case 'error':
      return { ...state, error: event, pending: '' };
    case 'done':
      return { ...state, done: event };
  }
};

export const checkedCount = (citations: CitationsEvent) => citations.results.filter(({ ok }) => ok).length;

export const header = (citations: CitationsEvent) =>
  citations.results.length > 0 ? `${checkedCount(citations)} of ${citations.results.length} citations checked` : 'no citations';

export type Marker = { kind: 'checked'; n: number } | { kind: 'unchecked'; reason: string };

export const markers = (citations: CitationsEvent, refs: number[]): Marker[] => {
  const seen = new Set<number>();
  return refs.flatMap((ref): Marker[] => {
    const result = citations.results[ref];
    if (!result) return [{ kind: 'unchecked', reason: 'index' }];
    if (!result.ok) return [{ kind: 'unchecked', reason: result.reason }];
    if (seen.has(result.excerpt)) return [];
    seen.add(result.excerpt);
    return [{ kind: 'checked', n: result.excerpt }];
  });
};
