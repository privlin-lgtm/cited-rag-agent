import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import { splitSentences } from '../agent/sentences';
import { chunkParts } from './chunk';
import { makePdf } from '../test-pdf';
import { extract } from './extract';
import { INGEST_VERSION } from './index';

const section = (n: number) =>
  [
    `## Section ${n}`,
    '![diagram](./a.svg)',
    `Under § 1005.3${n}(a), a provider must comply with 12 C.F.R. 1005.3${n} before payment. ${'The sender may cancel within 30 minutes. '.repeat(30)}`,
    '',
    '- first item;',
    '- second item',
    '',
    'Fee | Amount',
    '--- | ---',
    `Wire | $${n}.00`,
  ].join('\n');

const markdown = `---\ntitle: fixture\n---\n# Fixture\n${[1, 2, 3, 4].map(section).join('\n\n')}`;
const text = Array.from({ length: 12 }, (_, i) => `Paragraph ${i}. ${'Remittance transfers are covered. '.repeat(25)}`).join('\n\n');

const pdfPages = Array.from({ length: 6 }, (_, i) => [
  `GUIDE HEADER v 1.0 page ${i + 1}`,
  ...Array.from({ length: 8 }, (_, j) => `Line ${j} of ${String.fromCharCode(97 + i).repeat(5)} says that a sender may cancel a transfer.`),
  `Footer ${String.fromCharCode(97 + i).repeat(4)} note.`,
]);

it('changes only together with INGEST_VERSION when extraction, chunking or sentence splitting changes', async () => {
  const bytes = (value: string) => new TextEncoder().encode(value);
  const chunks = [
    ...chunkParts((await extract('md', bytes(markdown))).parts),
    ...chunkParts((await extract('txt', bytes(text))).parts),
    ...chunkParts((await extract('pdf', makePdf(pdfPages))).parts),
  ];
  const output = JSON.stringify({ chunks, blocks: chunks.map(({ content }) => splitSentences(content)) });
  expect({ version: INGEST_VERSION, hash: createHash('sha256').update(output).digest('hex') }).toEqual({
    version: 2,
    hash: '0c8706ab0416ad653814d8796a31b5bd790f4517f86ed462653eb7554e53ca0e',
  });
});
