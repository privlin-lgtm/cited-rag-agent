import type { TextCitation } from '@anthropic-ai/sdk/resources/messages';
import { beforeEach, describe, expect, it } from 'vitest';
import { checkCitations, type SentResult } from './citations';
import { setup, type Fixture } from './test-setup';
import { runTool } from './tools';
import { fakeEmbedder } from '../fake-embedder';

let fixture: Fixture;
let sent: SentResult[];
let firstRound: number;

const cite = (search_result_index: number, start: number, end = start + 1): TextCitation => ({
  type: 'search_result_location',
  search_result_index,
  start_block_index: start,
  end_block_index: end,
  cited_text: 'ignored',
  source: 'chunk:0',
  title: null,
});

const search = async (name: string, input: unknown, round: number) => {
  const run = await runTool({ db: fixture.db, embed: fakeEmbedder, scope: new Set(fixture.all) }, name, input);
  for (const entry of run.entries) sent.push({ ...entry, index: sent.length, round });
  return run.entries.length;
};

const check = (citations: TextCitation[], scope = new Set(fixture.all)) => checkCitations(fixture.db, sent, scope, citations, (id) => `https://example.test/${id}`);

beforeEach(async () => {
  fixture = await setup();
  sent = [];
  firstRound = await search('search_documents', { query: 'cancel a remittance transfer', k: 3 }, 1);
  await search('keyword_search', { terms: '1005.33' }, 2);
});

describe('checkCitations', () => {
  it('accepts a one-block and a two-block citation, from either round, by the global index', async () => {
    const cancel = sent.findIndex(({ file, locator }) => file === 'cancel.md' && locator === '§ Cancellation');
    const rule = sent.findIndex(({ file, round }) => file === 'rule.txt' && round === 2);
    expect(rule).toBeGreaterThanOrEqual(firstRound);
    const { results } = await check([cite(cancel, 0), cite(cancel, 0, 2), cite(rule, 0)]);
    expect(results.map((result) => result.ok)).toEqual([true, true, true]);
    expect(results[2]).toMatchObject({ ok: true, chunkId: sent[rule].chunkId, blocks: [0, 1] });
  });

  it('fails an index outside the run', async () => {
    expect((await check([cite(99, 0), cite(-1, 0)])).results).toEqual([
      { ok: false, reason: 'index' },
      { ok: false, reason: 'index' },
    ]);
  });

  it('fails a block range outside the sent blocks, or empty or reversed', async () => {
    const cancel = sent.findIndex(({ file, locator }) => file === 'cancel.md' && locator === '§ Cancellation');
    const count = sent[cancel].blocks.length;
    const { results } = await check([cite(cancel, 0, count + 1), cite(cancel, count), cite(cancel, 1, 1), cite(cancel, 2, 1)]);
    expect(results.every((result) => !result.ok && result.reason === 'blocks')).toBe(true);
  });

  it('fails a citation of any type other than a search result location', async () => {
    const other = { type: 'char_location', cited_text: 'x', document_index: 0, document_title: null, start_char_index: 0, end_char_index: 1, file_id: null } as unknown as TextCitation;
    expect((await check([other])).results).toEqual([{ ok: false, reason: 'index' }]);
  });

  it('fails when a sentence of the stored chunk no longer matches the block Claude saw', async () => {
    const cancel = sent.findIndex(({ file, locator }) => file === 'cancel.md' && locator === '§ Cancellation');
    await fixture.db.query("update chunks set content = replace(content, '30 minutes', '45 minutes') where id = $1::bigint", [sent[cancel].chunkId]);
    expect((await check([cite(cancel, 0)])).results).toEqual([{ ok: false, reason: 'text' }]);
  });

  it('fails when the chunk no longer exists', async () => {
    const cancel = sent.findIndex(({ file, locator }) => file === 'cancel.md' && locator === '§ Cancellation');
    await fixture.db.query('delete from chunks where id = $1::bigint', [sent[cancel].chunkId]);
    expect((await check([cite(cancel, 0)])).results).toEqual([{ ok: false, reason: 'chunk' }]);
  });

  it('fails a chunk of a document outside the run', async () => {
    const cancel = sent.findIndex(({ file, locator }) => file === 'cancel.md' && locator === '§ Cancellation');
    const without = new Set(fixture.all.filter((id) => id !== fixture.ids['cancel.md']));
    expect((await check([cite(cancel, 0)], without)).results).toEqual([{ ok: false, reason: 'scope' }]);
  });

  it('shows a chunk cited through several indices once, with every cited sentence highlighted', async () => {
    await search('search_documents', { query: 'cancel a remittance transfer', k: 3 }, 3);
    const indices = sent.flatMap(({ file, locator }, i) => (file === 'cancel.md' && locator === '§ Cancellation' ? [i] : []));
    expect(indices.length).toBeGreaterThanOrEqual(2);
    const { results, excerpts } = await check([cite(indices[0], 0), cite(indices[1], 2)]);
    expect(results.map((result) => result.ok)).toEqual([true, true]);
    const excerpt = excerpts.find(({ file }) => file === 'cancel.md');
    expect(excerpts.filter(({ file }) => file === 'cancel.md')).toHaveLength(1);
    expect(excerpt?.blocks.map(({ cited }) => cited)).toEqual([true, false, true]);
    expect(excerpt).toMatchObject({ n: 1, locator: '§ Cancellation', sourceUrl: `https://example.test/${fixture.ids['cancel.md']}` });
    expect(results[0]).toMatchObject({ excerpt: 1 });
    expect(results[1]).toMatchObject({ excerpt: 1 });
  });

  it('numbers excerpts in order of first citation and gives failed citations none', async () => {
    const cancel = sent.findIndex(({ file, locator }) => file === 'cancel.md' && locator === '§ Cancellation');
    const rule = sent.findIndex(({ file }) => file === 'rule.txt');
    const { results, excerpts } = await check([cite(rule, 0), cite(99, 0), cite(cancel, 0)]);
    expect(excerpts.map(({ n, file }) => [n, file])).toEqual([
      [1, 'rule.txt'],
      [2, 'cancel.md'],
    ]);
    expect(results[1]).toEqual({ ok: false, reason: 'index' });
  });
});
