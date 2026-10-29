import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { CitationCheck, Excerpt } from '../lib/agent/citations';
import type { StepEvent } from '../lib/agent/loop';
import type { Notice } from '../lib/notice';
import { initialRun, type CitationsEvent, type RunState } from '../lib/run-state';
import { AnswerPanel } from './answer-panel';
import { DocumentsPanel } from './documents-panel';
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
  const answer = (run: RunState, running: boolean, problem?: Notice) => renderToStaticMarkup(<AnswerPanel run={run} running={running} problem={problem} />);
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
    expect(answer(afterFirstStep, true, { message: 'The connection was lost.', limit: false })).not.toContain(STATUS);
    expect(answer(afterFirstStep, false)).not.toContain(STATUS);
  });
});

describe('AnswerPanel problems and errors', () => {
  const answer = (run: RunState, problem?: Notice) => renderToStaticMarkup(<AnswerPanel run={run} running={false} problem={problem} />);
  const sentence = 'You can try again at 15:00.';

  it('shows a limit in the neutral box with its reset sentence, not the red one', () => {
    const html = answer(initialRun, { message: `This demo takes 15 questions an hour from each visitor, and you've reached that. ${sentence}`, limit: true });
    expect(html).toContain('You can try again at 15:00.');
    expect(html).toContain('border-zinc-300');
    expect(html).not.toMatch(/bg-red-50|text-red-800/);
  });

  it('keeps any other problem in the red box', () => {
    const html = answer(initialRun, { message: 'The request failed (HTTP 500).', limit: false });
    expect(html).toContain('bg-red-50');
    expect(html).toContain('The request failed (HTTP 500).');
  });

  it('shows the visitor sentence under "No answer generated." in the red box', () => {
    const message = 'The demo has reached its spending limit for now. Please try again later.';
    const html = answer({ ...initialRun, error: { type: 'error', message, excerpts: [] } });
    expect(html).toContain('No answer generated.');
    expect(html).toContain(message);
    expect(html).toContain('bg-red-50');
    expect(html).not.toContain('{');
  });
});

describe('DocumentsPanel upload notice', () => {
  const panel = (uploadError: Notice) =>
    renderToStaticMarkup(<DocumentsPanel documents={[]} selected={new Set()} onToggle={() => {}} onToggleAll={() => {}} onUpload={() => {}} onDelete={() => {}} uploading={false} uploadError={uploadError} />);

  it('shows an upload limit in neutral text and any other upload problem in red', () => {
    const limit = panel({ message: 'This demo takes 10 uploads a day from each visitor, and you\'ve reached that. You can try again tomorrow at 02:00.', limit: true });
    expect(limit).toContain('text-zinc-600');
    expect(limit).toContain('You can try again tomorrow at 02:00.');
    expect(limit).not.toContain('text-red-700');
    const other = panel({ message: 'The file is larger than 4 MB.', limit: false });
    expect(other).toContain('text-red-700');
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

describe("AnswerPanel formatting of the model's text", () => {
  const checked: CitationCheck = { ok: true, excerpt: 1, chunkId: '10', blocks: [0, 1] };
  const answer = (segments: CitationsEvent['segments'], results: CitationCheck[] = []) =>
    renderToStaticMarkup(<AnswerPanel run={{ ...initialRun, citations: { type: 'citations', status: 'complete', segments, results, excerpts: [] } }} running={false} />);

  it('shows a heading line as a bold paragraph, without its markers or a heading element', () => {
    const html = answer([{ text: '## Summary\nA sender has 30 minutes to cancel.', refs: [] }]);
    expect(html).not.toContain('#');
    expect(html.match(/<h[1-6]/g)).toEqual(['<h2']);
    expect(html).toMatch(/<p class="[^"]*font-semibold[^"]*"><span>Summary<\/span><\/p>/);
    expect(html).toContain('<span>A sender has 30 minutes to cancel.</span>');
  });

  it('shows a table split across segments as one table, with the separator hidden and the citation marker in its cell', () => {
    const html = answer(
      [
        { text: 'Fees:\n| Fee | Amount |\n|---|---|\n| **Transfer** | $5 ', refs: [0] },
        { text: '|\n| Exchange rate | 1% |', refs: [] },
      ],
      [checked],
    );
    expect(html.match(/<table/g)).toHaveLength(1);
    expect(html.match(/<th /g)).toHaveLength(2);
    expect(html.match(/<td /g)).toHaveLength(4);
    expect(html).not.toMatch(/---|\|/);
    expect(html).toContain('<strong>Transfer</strong>');
    expect(html.split('<td').find((cell) => cell.includes('$5'))?.split('</td>')[0]).toContain('href="#excerpt-1"');
    expect(html).toMatch(/<div class="[^"]*overflow-x-auto[^"]*"><table/);
  });

  it('keeps a single line with a pipe as a paragraph', () => {
    for (const text of ['Fees | Taxes', '| Fees | Taxes |']) {
      const html = answer([{ text, refs: [] }]);
      expect(html).not.toContain('<table');
      expect(html).toContain(`<span>${text}</span></p>`);
    }
  });

  it('joins an indented list item to the list of its neighbours', () => {
    const html = answer([{ text: '- one\n  - two', refs: [] }]);
    expect(html.match(/<ul/g)).toHaveLength(1);
    expect(html.match(/<li>/g)).toHaveLength(2);
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

  const BEFORE = 'The passages behind each checked citation appear here, with the cited sentences highlighted.';
  const CITES_NONE = 'This answer cites no passage, so there is no excerpt to show. The steps show what was searched.';
  const NONE_PASSED = "None of this answer's citations passed the check, so no excerpt is shown.";
  const DECLINED = 'Claude declined to answer, so there is no excerpt to show.';
  const ended = (status: CitationsEvent['status'], results: CitationCheck[], excerpts: Excerpt[] = []): CitationsEvent => ({ type: 'citations', status, segments: [], results, excerpts });
  const empty = (citations?: CitationsEvent) => renderToStaticMarkup(<ExcerptsPanel excerpts={citations?.excerpts ?? []} noAnswer={false} citations={citations} />).replaceAll('&#x27;', "'");

  it.each([
    ['before any answer', undefined, BEFORE],
    ['after an answer that cites nothing', ended('complete', []), CITES_NONE],
    ['after a cut-off answer that cites nothing', ended('cut_off', []), CITES_NONE],
    ['after an answer whose citations all failed the check', ended('complete', [{ ok: false, reason: 'text' }, { ok: false, reason: 'index' }]), NONE_PASSED],
    ['after Claude declined', ended('declined', []), DECLINED],
  ])('says why there is nothing to show %s', (_name, citations, message) => {
    const html = empty(citations);
    expect(html).toContain(message);
    for (const other of [BEFORE, CITES_NONE, NONE_PASSED, DECLINED].filter((text) => text !== message)) expect(html).not.toContain(other);
  });

  it('shows none of those messages when there are excerpts', () => {
    const html = empty(ended('complete', [{ ok: true, excerpt: 1, chunkId: '1', blocks: [0, 1] }], [excerpt('rule.txt', [{ text: 'Cancel within 30 minutes.', cited: true }])]));
    for (const message of [BEFORE, CITES_NONE, NONE_PASSED, DECLINED]) expect(html).not.toContain(message);
    expect(html).toContain('Cancel within 30 minutes.');
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

  it('puts the answer, then the excerpts, then the documents in the markup, the order a phone shows, with no CSS order', () => {
    const at = (label: string) => html.indexOf(`<section aria-label="${label}"`);
    expect(at('What the agent did')).toBeGreaterThan(html.indexOf('id="question"'));
    expect(at('Answer')).toBeGreaterThan(at('What the agent did'));
    expect(at('Excerpts')).toBeGreaterThan(at('Answer'));
    expect(at('Documents')).toBeGreaterThan(at('Excerpts'));
    expect(html).not.toMatch(/\border-\d/);
  });
});
