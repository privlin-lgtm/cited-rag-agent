import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import { splitSentences } from '../agent/sentences';
import { chunkParts } from './chunk';
import { extract } from './extract';
import { INGEST_VERSION } from './index';

const section = (n: number) =>
  [
    `## Section ${n}`,
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

it('changes only together with INGEST_VERSION when extraction, chunking or sentence splitting changes', async () => {
  const bytes = (value: string) => new TextEncoder().encode(value);
  const chunks = [...chunkParts((await extract('md', bytes(markdown))).parts), ...chunkParts((await extract('txt', bytes(text))).parts)];
  const output = JSON.stringify({ chunks, blocks: chunks.map(({ content }) => splitSentences(content)) });
  expect({ version: INGEST_VERSION, hash: createHash('sha256').update(output).digest('hex') }).toEqual({
    version: 1,
    hash: '609fcc0dfce1f7021da34c3991c581532537c833b84020589d3c65abf8eb4525',
  });
});
