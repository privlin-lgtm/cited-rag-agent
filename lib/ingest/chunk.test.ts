import { beforeAll, describe, expect, it } from 'vitest';
import { splitSentences } from '../agent/sentences';
import { loadManifest, readCorpusFile, type ManifestDocument } from '../corpus';
import { chunkParts, estimateTokens, MAX_TOKENS, TARGET_TOKENS, type Chunk } from './chunk';
import { extract, type Paragraph, type Part } from './extract';

const paragraph = (text: string, line = 1): Paragraph => ({ text, lines: [line, line] });
const sentence = 'Alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron pi rho sigma tau.';
const collapse = (text: string) => text.replace(/\s+/g, ' ').trim();
const numbered = (count: number) =>
  Array.from({ length: count }, (_, i) => paragraph(`Paragraph ${i}. ${'word '.repeat(60).trim()}`, i + 1));

describe('chunkParts', () => {
  it('packs paragraphs to about 400 estimated tokens and never exceeds 600', () => {
    const chunks = chunkParts([{ locator: 'p. 1', paragraphs: numbered(40) }]);
    expect(chunks.length).toBeGreaterThan(5);
    for (const { content } of chunks) {
      expect(estimateTokens(content)).toBeLessThanOrEqual(MAX_TOKENS);
      expect(estimateTokens(content)).toBeGreaterThan(TARGET_TOKENS / 2);
    }
  });

  it('starts each chunk with the last paragraph of the one before', () => {
    const paragraphs = numbered(12);
    const chunks = chunkParts([{ locator: 'p. 1', paragraphs }]);
    const lastOfFirst = chunks[0].content.split('\n\n').at(-1);
    expect(lastOfFirst).toMatch(/^Paragraph \d+\./);
    expect(chunks[1].content.startsWith(`${lastOfFirst}\n\n`)).toBe(true);
  });

  it('caps the overlap of a long paragraph at about 80 tokens, keeping whole sentences', () => {
    const long = Array.from({ length: 8 }, () => sentence).join(' ');
    const chunks = chunkParts([{ locator: 'p. 1', paragraphs: [paragraph(long), paragraph(long), paragraph(long), paragraph(long), paragraph(long)] }]);
    const overlap = chunks[1].content.split('\n\n')[0];
    expect(estimateTokens(overlap)).toBeLessThanOrEqual(80);
    expect(overlap.endsWith('tau.')).toBe(true);
    expect(overlap.startsWith('Alpha')).toBe(true);
  });

  it('never crosses a part, and carries no overlap into the next part', () => {
    const parts: Part[] = [
      { locator: 'p. 1', paragraphs: [paragraph('First page text.')] },
      { locator: 'p. 2', paragraphs: [paragraph('Second page text.')] },
    ];
    expect(chunkParts(parts)).toEqual([
      { locator: 'p. 1', content: 'First page text.' },
      { locator: 'p. 2', content: 'Second page text.' },
    ]);
  });

  it('splits a paragraph over 600 tokens into pieces and keeps every chunk within the ceiling', () => {
    const huge = Array.from({ length: 40 }, () => sentence).join(' ');
    const unbroken = 'x'.repeat(9000);
    for (const text of [huge, unbroken]) {
      const chunks = chunkParts([{ locator: 'p. 1', paragraphs: [paragraph(text)] }]);
      expect(chunks.length).toBeGreaterThan(1);
      for (const { content } of chunks) expect(estimateTokens(content)).toBeLessThanOrEqual(MAX_TOKENS);
    }
    const joined = chunkParts([{ locator: 'p. 1', paragraphs: [paragraph(unbroken)] }]).map(({ content }) => content).join('');
    expect(joined.length).toBe(9000);
  });

  it('labels plain-text chunks with the line range they cover, overlap included', () => {
    const paragraphs = [1, 3, 5, 7, 9, 11, 13, 15, 17, 19].map((line) => paragraph(`Line ${line}. ${'word '.repeat(60).trim()}`, line));
    const chunks = chunkParts([{ locator: null, paragraphs }]);
    expect(chunks.map(({ locator }) => locator)).toEqual(['lines 1–9', 'lines 9–19']);
  });

  it('drops the overlap when it would push a chunk past 600 tokens', () => {
    const big = (label: string) => paragraph(`${label} ${'word '.repeat(470).trim()}`);
    const chunks = chunkParts([{ locator: 'p. 1', paragraphs: [big('A'), big('B')] }]);
    expect(chunks.map(({ content }) => content.slice(0, 1))).toEqual(['A', 'B']);
    for (const { content } of chunks) expect(estimateTokens(content)).toBeLessThanOrEqual(MAX_TOKENS);
  });
});

describe('chunkParts on the committed corpus', () => {
  let chunked: { document: ManifestDocument; pages: number | null; chunks: Chunk[] }[];

  beforeAll(async () => {
    const { documents } = await loadManifest();
    chunked = await Promise.all(
      documents.map(async (document) => {
        const { pages, parts } = await extract(document.kind, new Uint8Array(await readCorpusFile(document.filename)));
        return { document, pages, chunks: chunkParts(parts) };
      }),
    );
  }, 180_000);

  it('produces chunks for every document, none over 600 estimated tokens', () => {
    expect(chunked).toHaveLength(9);
    for (const { document, chunks } of chunked) {
      expect(chunks.length, document.filename).toBeGreaterThan(0);
      for (const { content } of chunks) expect(estimateTokens(content), document.filename).toBeLessThanOrEqual(MAX_TOKENS);
    }
  });

  it('gives every PDF chunk a p. N locator inside the document, every Markdown chunk a heading path and every text chunk a line range', () => {
    for (const { document, pages, chunks } of chunked)
      for (const { locator } of chunks)
        if (document.kind === 'pdf') {
          expect(locator, document.filename).toMatch(/^p\. \d+$/);
          expect(Number(locator.slice(3)), document.filename).toBeLessThanOrEqual(pages ?? 0);
        } else if (document.kind === 'md') expect(locator, document.filename).toMatch(/^§ \S/);
        else expect(locator, document.filename).toMatch(/^lines \d+–\d+$/);
  });

  it('leaves the CFPB guide and PSD2 running headers out of every chunk', () => {
    const chunksOf = (filename: string) => chunked.find(({ document }) => document.filename === filename)?.chunks ?? [];
    const guide = chunksOf('cfpb_remittance-transfers_small-entity-compliance-guide.pdf');
    expect(guide.length).toBeGreaterThan(0);
    for (const { content } of guide) expect(content).not.toContain('CONSUMER FINANCIAL PROTECTION BUREAU v 5.0');
    const psd2 = chunksOf('directive-eu-2015-2366-psd2.pdf');
    expect(psd2.length).toBeGreaterThan(0);
    for (const { content } of psd2) for (const line of content.split('\n')) expect(line).not.toMatch(/^EN.*Official Journal of the European Union/);
  });

  it('splits every chunk into sentence blocks that rejoin to the chunk text', () => {
    for (const { document, chunks } of chunked)
      for (const { content } of chunks) expect(splitSentences(content).join(' '), document.filename).toBe(collapse(content));
  });

  it('keeps each "12 CFR 1005.xx" and "§ 1005.xx" citation inside one block', () => {
    let seen = 0;
    for (const { chunks } of chunked)
      for (const { content } of chunks) {
        const blocks = splitSentences(content);
        for (const [citation] of collapse(content).matchAll(/12 (?:C\.F\.R\.|CFR) (?:§ ?)?1005\.\d+(?:\([a-z0-9]+\))*|§ 1005\.\d+(?:\([a-z0-9]+\))*/g)) {
          seen++;
          expect(
            blocks.some((block) => block.includes(citation)),
            citation,
          ).toBe(true);
        }
      }
    expect(seen).toBeGreaterThan(0);
  });
});
