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

  it('carries a heading with no body into the next section instead of giving it a chunk of its own', async () => {
    const { parts } = await extract('md', bytes('# Use Cases\n## Perform Transfer\nSteps follow here.\n\n## Next\nMore.'));
    expect(parts.map(({ locator }) => locator)).toEqual(['§ Use Cases › Perform Transfer', '§ Use Cases › Next']);
    expect(parts[0].paragraphs[0].text).toBe('# Use Cases\n## Perform Transfer\nSteps follow here.');
  });

  it('does not treat ~~~ or ``` lines in plain text as code fences', async () => {
    const { parts } = await extract('txt', bytes('Intro one.\n\n~~~~~~~~~~\n\nPara A.\n\nPara B.'));
    expect(parts[0].paragraphs.map(({ text }) => text)).toEqual(['Intro one.', '~~~~~~~~~~', 'Para A.', 'Para B.']);
  });

  it('drops YAML front matter but keeps a section that follows a leading horizontal rule', async () => {
    const rule = await extract('md', bytes('---\nFirst section.\n\n---\n\n# Title\nBody.'));
    expect(rule.parts.flatMap(({ paragraphs }) => paragraphs.map(({ text }) => text)).join('\n')).toContain('First section.');
    const yaml = await extract('md', bytes('---\ntitle: x\ntags:\n  - a\n---\n# Title\nBody.'));
    expect(yaml.parts).toHaveLength(1);
    expect(yaml.parts[0].paragraphs[0].text).toBe('# Title\nBody.');
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
