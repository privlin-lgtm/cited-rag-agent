import { beforeEach, describe, expect, it } from 'vitest';
import type { Embedder } from '../embed';
import { fakeEmbedder } from '../fake-embedder';
import { splitSentences } from './sentences';
import { setup, type Fixture } from './test-setup';
import { runTool, tools, type ToolContext } from './tools';

let fixture: Fixture;
const context = (scope: string[], embed: Embedder = fakeEmbedder): ToolContext => ({ db: fixture.db, embed, scope: new Set(scope) });
const blocksOf = (run: Awaited<ReturnType<typeof runTool>>) => run.content.map((block) => block.type);

beforeEach(async () => {
  fixture = await setup();
});

describe('tool definitions', () => {
  it('describe the four tools with object input schemas and no $schema key', () => {
    expect(tools.map(({ name }) => name)).toEqual(['search_documents', 'keyword_search', 'read_neighbours', 'list_documents']);
    for (const tool of tools) {
      expect(tool.input_schema.type).toBe('object');
      expect(tool.input_schema).not.toHaveProperty('$schema');
    }
    const keyword = tools.find(({ name }) => name === 'keyword_search');
    expect(keyword?.description).toContain('All plain terms must appear');
    expect(keyword?.description).toContain('OR');
  });
});

describe('search tools', () => {
  it('return one search_result block per hit, with the chunk as source, the file and locator as title, and sentence blocks as content', async () => {
    const run = await runTool(context(fixture.all), 'search_documents', { query: 'cancel a remittance transfer', k: 2 });
    expect(run.isError).toBe(false);
    expect(blocksOf(run).every((type) => type === 'search_result')).toBe(true);
    const [first] = run.content;
    if (first.type !== 'search_result') throw new Error('expected a search_result block');
    expect(first.source).toMatch(/^chunk:\d+$/);
    expect(first.title).toBe('cancel.md · § Cancellation');
    expect(first.citations).toEqual({ enabled: true });
    expect(first.content.map(({ text }) => text)).toEqual(run.entries[0].blocks);
    expect(run.entries[0].blocks).toEqual(splitSentences(run.entries[0].blocks.join(' ')));
    expect(run.entries).toHaveLength(run.content.length);
    expect(run.entries[0]).toMatchObject({ file: 'cancel.md', locator: '§ Cancellation', documentId: fixture.ids['cancel.md'] });
    expect(run.hits[0]).toMatchObject({ file: 'cancel.md', locator: '§ Cancellation' });
    expect(run.embedTokens).toBeGreaterThan(0);
  });

  it('answer an empty result with plain text and no entries', async () => {
    const run = await runTool(context(fixture.all), 'keyword_search', { terms: 'blockchain' });
    expect(run.content).toEqual([{ type: 'text', text: 'No matching passages.' }]);
    expect(run.entries).toEqual([]);
    expect(run.isError).toBe(false);
  });

  it('find a section number with keyword_search', async () => {
    const run = await runTool(context(fixture.all), 'keyword_search', { terms: '1005.33', k: 3 });
    expect(run.hits[0]).toMatchObject({ file: 'rule.txt' });
  });

  it('fall back to keyword search when the embedder fails, and say so', async () => {
    const failing: Embedder = async () => {
      throw new Error('Voyage is down');
    };
    const run = await runTool(context(fixture.all, failing), 'search_documents', { query: 'how long to cancel a remittance transfer?' });
    expect(run.fallback).toBe('keyword');
    expect(run.embedTokens).toBeUndefined();
    expect(run.hits.length).toBeGreaterThan(0);
    expect(run.hits[0].file).toBe('cancel.md');
  });
});

describe('scope', () => {
  const scoped = () => context([fixture.ids['cancel.md']]);

  it('rejects document_ids that are all outside the scope, without searching', async () => {
    const run = await runTool(scoped(), 'search_documents', { query: 'settlement windows', document_ids: [fixture.ids['settlement.md']] });
    expect(run.isError).toBe(true);
    expect(run.error).toContain('None of the requested document_ids are in scope');
    expect(run.entries).toEqual([]);
    expect(run.hits).toEqual([]);
  });

  it('narrows a mixed list to the ids in scope and reports the effective list', async () => {
    const run = await runTool(scoped(), 'search_documents', { query: 'remittance', k: 10, document_ids: [fixture.ids['cancel.md'], fixture.ids['settlement.md']] });
    expect(run.isError).toBe(false);
    expect(new Set(run.hits.map(({ file }) => file))).toEqual(new Set(['cancel.md']));
    expect(run.input).toMatchObject({ document_ids: [fixture.ids['cancel.md']] });
  });

  it('drops a malformed id', async () => {
    const run = await runTool(scoped(), 'keyword_search', { terms: 'remittance', document_ids: ['not-a-uuid'] });
    expect(run.isError).toBe(true);
    const mixed = await runTool(scoped(), 'keyword_search', { terms: 'remittance', document_ids: ['not-a-uuid', fixture.ids['cancel.md']] });
    expect(mixed.hits.length).toBeGreaterThan(0);
  });

  it('searches the whole scope, and nothing more, for an empty or omitted list', async () => {
    for (const document_ids of [undefined, []]) {
      const run = await runTool(scoped(), 'search_documents', { query: 'settlement windows net positions', k: 10, document_ids });
      expect(run.isError).toBe(false);
      expect(new Set(run.hits.map(({ file }) => file))).toEqual(new Set(['cancel.md']));
    }
  });

  it('keeps read_neighbours inside the scope', async () => {
    const [settlement] = await fixture.db.query<{ id: string }>('select id::text as id from chunks where document_id = $1::uuid', [fixture.ids['settlement.md']]);
    const outside = await runTool(scoped(), 'read_neighbours', { chunk_id: settlement.id });
    expect(outside.content).toEqual([{ type: 'text', text: 'No matching passages.' }]);
    expect(outside.isError).toBe(false);
  });

  it('lists only the documents in scope', async () => {
    const run = await runTool(scoped(), 'list_documents', {});
    const [block] = run.content;
    if (block.type !== 'text') throw new Error('expected text');
    expect(block.text).toContain(fixture.ids['cancel.md']);
    expect(block.text).not.toContain(fixture.ids['settlement.md']);
    expect(await runTool(context([]), 'list_documents', {})).toMatchObject({ content: [{ type: 'text', text: 'No documents are in scope.' }] });
  });
});

describe('read_neighbours', () => {
  it('returns the passages around a chunk, without the chunk itself, as search results with no score', async () => {
    const [first] = await fixture.db.query<{ id: string }>('select id::text as id from chunks where document_id = $1::uuid order by ord limit 1', [fixture.ids['cancel.md']]);
    const run = await runTool(context(fixture.all), 'read_neighbours', { chunk_id: first.id, before: 0, after: 2 });
    expect(run.entries.map(({ locator }) => locator)).toEqual(['§ Errors']);
    expect(run.entries[0].score).toBeNull();
    expect(run.entries.every(({ chunkId }) => chunkId !== first.id)).toBe(true);
  });
});

describe('bad calls', () => {
  it('answer an unknown tool and invalid input with an error result instead of throwing', async () => {
    const unknown = await runTool(context(fixture.all), 'drop_tables', {});
    expect(unknown).toMatchObject({ isError: true });
    expect(unknown.error).toContain('Unknown tool "drop_tables"');
    const invalid = await runTool(context(fixture.all), 'search_documents', { query: 'x', k: 50 });
    expect(invalid.isError).toBe(true);
    expect(invalid.error).toContain('Invalid input for search_documents');
    const badChunk = await runTool(context(fixture.all), 'read_neighbours', { chunk_id: '1; drop table chunks' });
    expect(badChunk.isError).toBe(true);
  });
});
