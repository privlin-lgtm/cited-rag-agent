import { createHash } from 'node:crypto';
import { extractText } from 'unpdf';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadManifest, readCorpusFile } from '../corpus';
import { chunkParts, type Chunk } from './chunk';
import { extract } from './extract';

const GUIDE = 'cfpb_remittance-transfers_small-entity-compliance-guide.pdf';
const EXAM = 'cfpb_remittance-transfer-examination-procedures.pdf';
const PSD2 = 'directive-eu-2015-2366-psd2.pdf';
const GUIDE_V2_HASH = 'b14e047fa1dff1553ae02ac6fccc0a8f604a0a53b2602e326e5599c54fc583f3';

const chunks = new Map<string, Chunk[]>();
const kinds = new Map<string, string>();

beforeAll(async () => {
  for (const { filename, kind } of (await loadManifest()).documents) {
    kinds.set(filename, kind);
    chunks.set(filename, chunkParts((await extract(kind, new Uint8Array(await readCorpusFile(filename)))).parts));
  }
}, 120_000);

describe('the committed corpus at ingest version 3', () => {
  it('has no running header from the exam procedures left in any passage', () => {
    expect(chunks.get(EXAM)!.filter(({ content }) => content.includes('CFPB February 2022 Procedures'))).toEqual([]);
  });

  it('keeps every line of PSD2 that starts with "Article 97"', async () => {
    const { text } = await extractText(new Uint8Array(await readCorpusFile(PSD2)), { mergePages: false });
    const lines = (value: string) => value.split(/\r\n?|\n/).filter((line) => line.trim().startsWith('Article 97')).length;
    const raw = text.reduce((sum, page) => sum + lines(page), 0);
    const kept = (await extract('pdf', new Uint8Array(await readCorpusFile(PSD2)))).parts.reduce(
      (sum, { paragraphs }) => sum + paragraphs.reduce((inner, { text: paragraph }) => inner + lines(paragraph), 0),
      0,
    );
    expect(raw).toBe(6);
    expect(kept).toBe(raw);
  });

  it('leaves the passages of the CFPB guide as they were at version 2', () => {
    expect(createHash('sha256').update(JSON.stringify(chunks.get(GUIDE))).digest('hex')).toBe(GUIDE_V2_HASH);
  });

  it('never repeats a heading segment back to back in a Markdown locator', () => {
    const markdown = [...chunks].filter(([filename]) => kinds.get(filename) === 'md');
    expect(markdown.length).toBeGreaterThan(0);
    for (const [filename, list] of markdown)
      for (const { locator } of list) {
        const segments = locator.replace(/^§ /, '').split(' › ');
        expect(segments.filter((segment, i) => segment === segments[i - 1]), `${filename} ${locator}`).toEqual([]);
      }
  });

  it('gives every PDF passage a page locator', () => {
    const pdf = [...chunks].filter(([filename]) => kinds.get(filename) === 'pdf');
    expect(pdf).toHaveLength(3);
    for (const [filename, list] of pdf) for (const { locator } of list) expect(locator, filename).toMatch(/^p\. \d+$/);
  });
});
