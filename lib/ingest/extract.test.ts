import { describe, expect, it } from 'vitest';
import { readCorpusFile } from '../corpus';
import { makePdf } from '../test-pdf';
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

  it('drops lines that hold only an image, so a heading followed only by an image merges into the next section', async () => {
    const { parts } = await extract('md', bytes('# A\n\n## Flow Diagram\n![Flow](./a.svg)\n[![Linked](./b.svg)](https://example.test)\n\n## Next\nText here with ![inline](./c.svg) kept.'));
    expect(parts).toHaveLength(1);
    expect(parts[0].locator).toBe('§ A › Next');
    const text = parts[0].paragraphs.map(({ text: paragraph }) => paragraph).join('\n');
    expect(text).toContain('## Flow Diagram');
    expect(text).not.toContain('a.svg');
    expect(text).not.toContain('b.svg');
    expect(text).toContain('![inline](./c.svg)');
  });

  it('keeps an image line inside a code fence', async () => {
    const { parts } = await extract('md', bytes('# A\n```\n![x](y.svg)\n```\nAfter.'));
    expect(parts[0].paragraphs.map(({ text }) => text).join('\n')).toContain('![x](y.svg)');
  });

  it('drops a line repeated at the edge of a third of the pages, and keeps one repeated on fewer', async () => {
    const pages = Array.from({ length: 12 }, (_, i) => {
      const word = String.fromCharCode(97 + i).repeat(6);
      const body = Array.from({ length: 6 }, (_, j) => `Body ${word} ${'xyz'.charAt(j % 3)} line ${j}.`);
      const header = `ACME GUIDE v 1.0 page ${i + 1}`;
      return i === 5
        ? [`Intro ${word} text.`, ...body.slice(0, 3), header, ...body.slice(3), `Footer ${word} stays.`]
        : [header, i < 3 ? 'SECTION BANNER' : `Intro ${word} text.`, ...body, `Footer ${word} stays.`];
    });
    const { parts } = await extract('pdf', makePdf(pages));
    const all = parts.flatMap(({ paragraphs }) => paragraphs.map(({ text }) => text)).join('\n');
    expect(parts.map(({ locator }) => locator)).toEqual(pages.map((_, i) => `p. ${i + 1}`));
    expect(all).not.toContain('ACME GUIDE');
    expect(all).toContain('SECTION BANNER');
    expect(all).toContain('Body aaaaaa x line 0.');
    expect(all).toContain('Footer llllll stays.');
  });

  it('does not strip anything from a PDF of fewer than three pages', async () => {
    const { parts } = await extract('pdf', makePdf([['Same line.', 'Text A.'], ['Same line.', 'Text B.']]));
    expect(parts.flatMap(({ paragraphs }) => paragraphs.map(({ text }) => text)).join('\n')).toContain('Same line.');
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
