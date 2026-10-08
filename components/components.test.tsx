import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Excerpt } from '../lib/agent/citations';
import type { StepEvent } from '../lib/agent/loop';
import { initialRun, type CitationsEvent, type RunState } from '../lib/run-state';
import { AnswerPanel } from './answer-panel';
import { ExcerptsPanel } from './excerpts-panel';
import { Timeline } from './timeline';
import { Workspace } from './workspace';

const STATUS = 'Reading the passages and writing the answer…';
const step = (overrides: Partial<StepEvent> = {}): StepEvent => ({
  type: 'step',
  round: 1,
  reason: '',
  tool: 'search_documents',
  input: { query: 'cancel' },
  hits: [{ file: 'a.md', locator: 'p. 1', score: 0.6123 }],
  ...overrides,
});

describe('AnswerPanel status line', () => {
  const answer = (run: RunState, running: boolean, problem?: string) => renderToStaticMarkup(<AnswerPanel run={run} running={running} problem={problem} />);
  const afterFirstStep: RunState = { ...initialRun, steps: [step()] };
  const citations: CitationsEvent = { type: 'citations', status: 'complete', segments: [{ text: 'Thirty minutes.', refs: [] }], results: [], excerpts: [] };

  it('shows between the first step and the answer while no streamed text is showing', () => {
    expect(answer(afterFirstStep, true)).toContain(STATUS);
  });

  it('is absent before the first step, while text streams, and after the answer, an error or a problem', () => {
    expect(answer(initialRun, true)).not.toContain(STATUS);
    expect(answer({ ...afterFirstStep, pending: 'Thirty min' }, true)).not.toContain(STATUS);
    expect(answer({ ...afterFirstStep, pending: 'Thirty min' }, true)).toContain('Thirty min');
    expect(answer({ ...afterFirstStep, citations }, true)).not.toContain(STATUS);
    expect(answer({ ...afterFirstStep, error: { type: 'error', message: 'Overloaded', excerpts: [] } }, true)).not.toContain(STATUS);
    expect(answer(afterFirstStep, true, 'The connection was lost.')).not.toContain(STATUS);
    expect(answer(afterFirstStep, false)).not.toContain(STATUS);
  });
});

describe('Timeline score labels', () => {
  const timeline = (steps: StepEvent[]) => renderToStaticMarkup(<Timeline steps={steps} running={false} />);

  it('labels search_documents scores as similarity and keyword scores as keyword rank', () => {
    expect(timeline([step()])).toContain('similarity 0.612');
    expect(timeline([step({ tool: 'keyword_search', input: { terms: 'refund' }, hits: [{ file: 'b.txt', locator: 'lines 1–4', score: 0.2512 }] })])).toContain('keyword rank 0.251');
  });

  it('labels the scores of a keyword fallback as keyword rank', () => {
    const html = timeline([step({ fallback: 'keyword', fallbackReason: 'Voyage is down', hits: [{ file: 'b.txt', locator: 'lines 1–4', score: 0.18 }] })]);
    expect(html).toContain('keyword rank 0.180');
    expect(html).not.toContain('similarity');
  });

  it('shows no score for read_neighbours', () => {
    const html = timeline([step({ tool: 'read_neighbours', input: { chunk_id: '7' }, hits: [{ file: 'a.md', locator: 'p. 2', score: null }] })]);
    expect(html).toContain('a.md · p. 2');
    expect(html).not.toMatch(/similarity|keyword rank/);
  });
});

describe('ExcerptsPanel', () => {
  const excerpt = (file: string, blocks: Excerpt['blocks']): Excerpt => ({ n: 1, chunkId: '1', documentId: 'd', file, locator: '§ Intro', sourceUrl: null, blocks });
  const blocks = [
    { text: '**Note:** see [Generic Transaction Patterns](#generic-transaction-patterns).', cited: true },
    { text: 'Use `Lookup Participant Information`. <br /> Then wait.', cited: false },
    { text: '##### 3.2.1 Heading', cited: true },
  ];
  const panel = (file: string) => renderToStaticMarkup(<ExcerptsPanel excerpts={[excerpt(file, blocks)]} noAnswer={false} />);

  it('renders inline Markdown in .md excerpts and keeps the cited blocks highlighted', () => {
    const html = panel('generic-transaction-patterns.md');
    expect(html).toContain('<strong>Note:</strong> see Generic Transaction Patterns.');
    expect(html).toContain('<code class="rounded bg-zinc-100 px-1 font-mono text-[0.9em] dark:bg-zinc-800">Lookup Participant Information</code>');
    expect(html).toContain('<br/>');
    expect(html).toContain('3.2.1 Heading');
    expect(html).not.toMatch(/\*\*|\]\(|<br \/>|#####/);
    expect(html.match(/<mark /g)).toHaveLength(2);
  });

  it('shows the stored text of other files as it is', () => {
    const html = panel('regulation-e-subpart-b.txt');
    expect(html).toContain('**Note:** see [Generic Transaction Patterns](#generic-transaction-patterns).');
    expect(html).toContain('##### 3.2.1 Heading');
    expect(html).not.toContain('<strong>');
  });
});

describe('Workspace header and footer', () => {
  const html = renderToStaticMarkup(<Workspace env="sandbox" examples={[]} initialDocuments={[]} />);

  it('links the repository and explains how the answers are checked', () => {
    expect(html).toContain('href="https://github.com/privlin-lgtm/cited-rag-agent"');
    expect(html).toContain('Claude searches the documents with tools and cites passages; each citation is checked against the stored text before it is marked checked.');
  });

  it('links the intent, spec and plan on the default branch', () => {
    for (const file of ['intent', 'spec', 'plan']) expect(html).toContain(`href="https://github.com/privlin-lgtm/cited-rag-agent/blob/HEAD/intent/2026-10-07-mvp/${file}.md"`);
    expect(html).not.toContain('blob/master');
  });
});
