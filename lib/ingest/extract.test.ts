import { describe, expect, it } from 'vitest';
import { readCorpusFile } from '../corpus';
import { extract } from './extract';

const bytes = (text: string) => new TextEncoder().encode(text);

describe('extract', () => {
  it('splits Markdown by heading, with the heading path as each section locator and front matter dropped', async () => {
    const markdown = [
      '---',
      'title: x',
      '---',
      'Text before any heading.',
      '',
      '# Transfers',
      'Overview paragraph.',
      '',
      '## Phases',
      'First phase.',
      '',
      'Second paragraph.',
      '',
      '## Quotes',
      'Quote text.',
      '',
      '# Settlement',
      'Settlement text.',
    ].join('\n');
    const { pages, parts } = await extract('md', bytes(markdown));
    expect(pages).toBeNull();
    expect(parts.map(({ locator }) => locator)).toEqual([
      '§ Preamble',
      '§ Transfers',
      '§ Transfers › Phases',
      '§ Transfers › Quotes',
      '§ Settlement',
    ]);
    expect(parts[2].paragraphs.map(({ text }) => text)).toEqual(['## Phases\nFirst phase.', 'Second paragraph.']);
  });

  it('keeps a code fence in one paragraph and ignores # inside it', async () => {
    const { parts } = await extract('md', bytes('# A\n\n```\n# not a heading\n\nstill code\n```\n\nAfter.'));
    expect(parts).toHaveLength(1);
    expect(parts[0].paragraphs.map(({ text }) => text)).toEqual(['# A', '```\n# not a heading\n\nstill code\n```', 'After.']);
  });

  it('strips links and emphasis from heading paths', async () => {
    const { parts } = await extract('md', bytes('# [Linked](http://example.test) `code`\nBody.'));
    expect(parts[0].locator).toBe('§ Linked code');
  });

  it('splits plain text into paragraphs with their line numbers', async () => {
    const { pages, parts } = await extract('txt', bytes('One\ntwo\n\nThree\n\n\nFour\r\n'));
    expect(pages).toBeNull();
    expect(parts).toEqual([
      {
        locator: null,
        paragraphs: [
          { text: 'One\ntwo', lines: [1, 2] },
          { text: 'Three', lines: [4, 4] },
          { text: 'Four', lines: [7, 7] },
        ],
      },
    ]);
  });

  it('removes NUL characters, which Postgres rejects', async () => {
    const { parts } = await extract('txt', bytes('a\0b'));
    expect(parts[0].paragraphs[0].text).toBe('ab');
  });

  it('reads a PDF page by page with p. N locators, and can read the same bytes twice', async () => {
    const data = new Uint8Array(await readCorpusFile('cfpb_remittance-transfers_small-entity-compliance-guide.pdf'));
    const first = await extract('pdf', data);
    const second = await extract('pdf', data);
    expect(first.pages).toBe(46);
    expect(first.parts.length).toBe(46);
    expect(first.parts.map(({ locator }) => locator).slice(0, 3)).toEqual(['p. 1', 'p. 2', 'p. 3']);
    expect(second.parts).toEqual(first.parts);
    const page10 = first.parts.find(({ locator }) => locator === 'p. 10');
    expect(page10?.paragraphs.length).toBeGreaterThan(3);
    expect(page10?.paragraphs.map(({ text }) => text).join('\n')).toContain('2.3 Cancellation and error resolution rights');
  });
});
