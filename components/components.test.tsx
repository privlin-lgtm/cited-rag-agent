import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { CitationCheck, Excerpt } from '../lib/agent/citations';
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

describe('AnswerPanel citation header and markers', () => {
  const NOT_CHECKED = 'This answer has no checked citation. Treat it as unverified.';
  const checked: CitationCheck = { ok: true, excerpt: 1, chunkId: '10', blocks: [0, 1] };
  const failed: CitationCheck = { ok: false, reason: 'text' };
  const answer = (results: CitationCheck[], segments: CitationsEvent['segments'], status: CitationsEvent['status'] = 'complete') =>
    renderToStaticMarkup(<AnswerPanel run={{ ...initialRun, citations: { type: 'citations', status, segments, results, excerpts: [] } }} running={false} />);
  const badge = (html: string, text: string) => html.match(new RegExp(`<span class="([^"]*)">${text}</span>`))?.[1];
  const count = (html: string, needle: string) => html.split(needle).length - 1;

  it('shows a failed citation as an "unchecked" badge that carries the reason, with no [n] link', () => {
    const html = answer([failed], [{ text: 'Thirty minutes.', refs: [0] }]);
    expect(count(html, '>unchecked<')).toBe(1);
    expect(html).toContain('title="The check failed: text"');
    expect(html).not.toContain('href="#excerpt-');
  });

  it('counts one checked and one failed citation, with one [n] link and one "unchecked" badge', () => {
    const html = answer([checked, failed], [{ text: 'First.', refs: [0] }, { text: ' Second.', refs: [1] }]);
    expect(badge(html, '1 of 2 citations checked')).toContain('bg-emerald-50');
    expect(count(html, 'href="#excerpt-1"')).toBe(1);
    expect(count(html, 'href="#excerpt-')).toBe(1);
    expect(count(html, '>unchecked<')).toBe(1);
    expect(html).not.toContain(NOT_CHECKED);
  });

  it('shows a red badge and the red box when citations were given and none was checked', () => {
    const html = answer([failed, failed], [{ text: 'Thirty minutes.', refs: [0, 1] }]);
    expect(badge(html, '0 of 2 citations checked')).toContain('bg-red-50');
    expect(html).toContain(NOT_CHECKED);
  });

  it('shows "no citations" in the neutral badge, with no red box, when nothing was cited', () => {
    const html = answer([], [{ text: 'The documents do not cover this.', refs: [] }]);
    const classes = badge(html, 'no citations');
    expect(classes).toContain('text-zinc-700');
    expect(classes).not.toMatch(/red|emerald/);
    expect(html).not.toContain(NOT_CHECKED);
    expect(html).not.toContain('bg-red-50');
    expect(html).not.toContain('citations checked');
  });

  it('keeps the cut-off badge beside "no citations"', () => {
    expect(answer([], [{ text: 'Partial.', refs: [] }], 'cut_off')).toContain('>cut off<');
  });

  it('shows a declined answer as the declined message with no badge', () => {
    const html = answer([], [], 'declined');
    expect(html).toContain('Claude declined to answer this question.');
    expect(html).not.toMatch(/no citations|citations checked|rounded-full/);
    expect(html).not.toContain(NOT_CHECKED);
  });
});

describe('Timeline score labels', () => {
  const timeline = (steps: StepEvent[]) => renderToStaticMarkup(<Timeline steps={steps} running={false} />);

  it('labels search_documents scores as similarity and keyword scores as keyword rank', () => {
    expect(timeline([step()]).replace(/<[^>]*>/g, '')).toContain('p. 1 similarity 0.612');
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

  it('renders <sup> footnote markers in .md excerpts as superscript, with a link inside shown as its text', () => {
    const marked = [{ text: 'Interledger Payment Request protocol<sup>[1](https://interledger.org/rfcs/0011-interledger-payment-request)</sup>(ILP) and <sup>2</sup> more.', cited: false }];
    const html = renderToStaticMarkup(<ExcerptsPanel excerpts={[excerpt('generic-transaction-patterns.md', marked)]} noAnswer={false} />);
    expect(html).toContain('Interledger Payment Request protocol<sup>1</sup>(ILP) and <sup>2</sup> more.');
    expect(html).not.toMatch(/&lt;|\]\(/);
    expect(renderToStaticMarkup(<ExcerptsPanel excerpts={[excerpt('regulation-e-subpart-b.txt', marked)]} noAnswer={false} />)).toContain('&lt;sup&gt;2&lt;/sup&gt;');
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
