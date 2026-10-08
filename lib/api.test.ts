import type { Message, StopReason } from '@anthropic-ai/sdk/resources/messages';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ModelCall, ModelParams } from './agent/loop';
import { setup, type Fixture } from './agent/test-setup';
import { handleAsk, handleCleanup, handleDelete, handleDocuments, handleUpload, type ApiDeps } from './api';
import { fakeEmbedder } from './fake-embedder';
import { addCost, addEmbedTokens, clientKey, EMBED_TOKENS_PER_DAY, reserveQuestion, reserveUpload } from './limits';
import { makePdf } from './test-pdf';
import { ingestUpload } from './upload';

const NOW = new Date('2026-10-07T14:30:00Z');
const IP = '203.0.113.9';
let fixture: Fixture;
let modelCalls: ModelParams[];
let script: (calls: ModelParams[]) => Message | Error;
let gate: Promise<void>;

const usage = { input_tokens: 100, output_tokens: 20, cache_creation_input_tokens: null, cache_read_input_tokens: null };
const reply = (content: unknown[], stopReason: StopReason) =>
  ({ id: 'msg', type: 'message', role: 'assistant', model: 'claude-sonnet-5-5', content, stop_reason: stopReason, stop_sequence: null, stop_details: null, usage }) as unknown as Message;
const text = (value: string, citations: unknown[] | null = null) => ({ type: 'text', text: value, citations });
const toolUse = (id: string, name: string, input: unknown) => ({ type: 'tool_use', id, name, input, caller: { type: 'direct' } });
const cite = (index: number, start: number) => ({
  type: 'search_result_location',
  search_result_index: index,
  start_block_index: start,
  end_block_index: start + 1,
  cited_text: 'ignored',
  source: 'chunk:0',
  title: null,
});

const model: ModelCall = async (params, onText) => {
  modelCalls.push(structuredClone(params));
  await gate;
  const next = script(modelCalls);
  if (next instanceof Error) throw next;
  for (const block of next.content) if (block.type === 'text') onText(block.text);
  return next;
};

const deps = (overrides: Partial<ApiDeps> = {}, session: string | null = 'sess1'): ApiDeps => ({
  db: fixture.db,
  now: () => NOW,
  sessionId: async ({ create }) => session ?? (create ? 'sess1' : undefined),
  ipSecret: 'ip-secret',
  cronSecret: 'cron-secret',
  budgetUsd: 1,
  model: { id: 'claude-sonnet-5-5', call: model },
  queryEmbedder: fakeEmbedder,
  documentEmbedder: fakeEmbedder,
  ...overrides,
});

const askRequest = (body: unknown, address = IP) =>
  new Request('http://test/api/ask', { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': address }, body: typeof body === 'string' ? body : JSON.stringify(body) });

type Line = { type: string; results?: unknown; costUsd: number; latencyMs: number; hits: { file: string }[] };
const events = async (response: Response) =>
  (await response.text())
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as Line);

const uploadRequest = (name: string, data: Uint8Array | string, field = 'file') => {
  const form = new FormData();
  form.set(field, new File([data as BlobPart], name));
  return new Request('http://test/api/upload', { method: 'POST', headers: { 'x-forwarded-for': IP }, body: form });
};

const spent = async (bucket: string) => (await fixture.db.query<{ count: number }>('select count::float8 as count from usage_windows where bucket = $1', [bucket]))[0]?.count ?? 0;

beforeEach(async () => {
  fixture = await setup();
  modelCalls = [];
  gate = Promise.resolve();
  script = () => reply([text('Nothing to cite.')], 'end_turn');
});

describe('POST /api/ask', () => {
  it.each([
    ['an empty question', { question: '' }],
    ['a blank question', { question: '   ' }],
    ['a question over 500 characters', { question: 'x'.repeat(501) }],
    ['a question that is not text', { question: 5 }],
    ['an empty document list', { question: 'ok', documentIds: [] }],
    ['a body that is not JSON', 'not json'],
  ])('answers %s with 400, calls no model and reserves nothing', async (_name, body) => {
    const response = await handleAsk(askRequest(body), deps());
    expect(response.status).toBe(400);
    expect(modelCalls).toHaveLength(0);
    expect(await fixture.db.query('select bucket from usage_windows')).toEqual([]);
  });

  it('streams step, answer, citations and done events, and records cost and embedding tokens', async () => {
    script = (calls) =>
      calls.length === 1
        ? reply([text('Looking.'), toolUse('t1', 'search_documents', { query: 'cancel a remittance transfer', k: 3 })], 'tool_use')
        : reply([text('Cancel within 30 minutes.', [cite(0, 0)])], 'end_turn');
    const response = await handleAsk(askRequest({ question: 'How long to cancel?' }), deps());
    expect(response.headers.get('content-type')).toContain('application/x-ndjson');
    const lines = await events(response);
    expect(lines.map(({ type }) => type)).toEqual(['answer', 'step', 'answer', 'citations', 'done']);
    expect(lines[1]).toMatchObject({ round: 1, tool: 'search_documents', reason: 'Looking.' });
    expect(lines[3].results).toMatchObject([{ ok: true }]);
    expect(lines[4]).toMatchObject({ model: 'claude-sonnet-5-5', inputTokens: 200, outputTokens: 40, cacheReadTokens: 0, cacheWriteTokens: 0 });
    expect(lines[4].costUsd).toBeCloseTo(0.0008, 8);
    expect(lines[4].latencyMs).toBeGreaterThanOrEqual(0);
    expect(await spent('anthropic:usd')).toBe(800);
    expect(await spent('embed:tokens')).toBeGreaterThan(0);
  });

  it('writes an error and done event when the model fails, and still charges the calls that returned', async () => {
    script = (calls) => (calls.length === 1 ? reply([toolUse('t1', 'list_documents', {})], 'tool_use') : new Error('Overloaded'));
    const lines = await events(await handleAsk(askRequest({ question: 'How long to cancel?' }), deps()));
    expect(lines.map(({ type }) => type)).toEqual(['step', 'error', 'done']);
    expect(lines[1]).toMatchObject({ message: 'Overloaded' });
    expect(await spent('anthropic:usd')).toBe(400);
  });

  it('refuses the 16th question in an hour with a 429 and its reset time, before any model call', async () => {
    const key = clientKey(new Headers({ 'x-forwarded-for': IP }), 'ip-secret');
    for (let i = 0; i < 15; i++) await reserveQuestion(fixture.db, key, NOW);
    const response = await handleAsk(askRequest({ question: 'One more?' }), deps());
    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('1800');
    expect(await response.json()).toMatchObject({ error: expect.stringContaining('15 questions an hour'), resetsAt: '2026-10-07T15:00:00.000Z' });
    expect(modelCalls).toHaveLength(0);
  });

  it("refuses a new question once today's budget is spent, before any model call", async () => {
    await addCost(fixture.db, 1, NOW);
    const response = await handleAsk(askRequest({ question: 'Anything?' }), deps());
    expect(response.status).toBe(429);
    expect(await response.json()).toMatchObject({ error: expect.stringContaining('Daily cost budget reached'), resetsAt: '2026-10-08T00:00:00.000Z' });
    expect(modelCalls).toHaveLength(0);
    expect(await spent('anthropic:usd')).toBe(1_000_000);
  });

  it('refuses a question with $0.95 spent, before any model call, and leaves the window at $0.95', async () => {
    await addCost(fixture.db, 0.95, NOW);
    const response = await handleAsk(askRequest({ question: 'Anything?' }), deps());
    expect(response.status).toBe(429);
    expect(await response.json()).toMatchObject({ error: expect.stringContaining('Daily cost budget reached'), resetsAt: '2026-10-08T00:00:00.000Z' });
    expect(modelCalls).toHaveLength(0);
    expect(await spent('anthropic:usd')).toBe(950_000);
  });

  it('starts exactly one of ten simultaneous questions from ten addresses when $0.85 is spent', async () => {
    await addCost(fixture.db, 0.85, NOW);
    let open!: () => void;
    gate = new Promise((resolve) => (open = resolve));
    const responses = await Promise.all(Array.from({ length: 10 }, (_, i) => handleAsk(askRequest({ question: 'How long to cancel?' }, `203.0.113.${i + 10}`), deps())));
    expect(responses.map(({ status }) => status).sort()).toEqual([200, 429, 429, 429, 429, 429, 429, 429, 429, 429]);
    expect(await spent('anthropic:usd')).toBe(950_000);
    open();
    await events(responses.find(({ status }) => status === 200) as Response);
    expect(modelCalls).toHaveLength(1);
    expect(await spent('anthropic:usd')).toBe(850_000 + 400);
  });

  it.each([
    ['a completed run', () => reply([text('Done.')], 'end_turn'), 400],
    ['a cut-off run', () => reply([text('Partial')], 'max_tokens'), 400],
    ['a run Claude declined', () => reply([], 'refusal'), 400],
    ['a model error', () => new Error('Overloaded'), 0],
    ['a thrown error', () => reply([text('?')], 'stop_sequence'), 400],
  ])('leaves exactly the actual cost in the window after %s', async (_name, next, cost) => {
    script = next;
    await events(await handleAsk(askRequest({ question: 'How long to cancel?' }), deps()));
    expect(await spent('anthropic:usd')).toBe(cost);
  });

  it('leaves exactly the actual cost in the window when the client disconnects mid-run', async () => {
    let open!: () => void;
    gate = new Promise((resolve) => (open = resolve));
    const response = await handleAsk(askRequest({ question: 'How long to cancel?' }), deps());
    expect(await spent('anthropic:usd')).toBe(100_000);
    await response.body?.cancel();
    open();
    await vi.waitFor(async () => expect(await spent('anthropic:usd')).toBe(400));
    expect(modelCalls).toHaveLength(1);
  });

  it("answers 400 for a document id outside the session, another session's upload included, and reserves no budget", async () => {
    const other = await ingestUpload(fixture.db, fakeEmbedder, 'sess2', 'theirs.txt', new TextEncoder().encode('Private notes.'));
    for (const documentIds of [[other.id], ['00000000-0000-0000-0000-000000000000'], [fixture.ids['cancel.md'], other.id]]) {
      const response = await handleAsk(askRequest({ question: 'Hello?', documentIds }), deps());
      expect(response.status).toBe(400);
    }
    expect(modelCalls).toHaveLength(0);
    expect(await spent('anthropic:usd')).toBe(0);
  });

  it('searches only the selected documents', async () => {
    script = (calls) => (calls.length === 1 ? reply([toolUse('t1', 'search_documents', { query: 'remittance transfer', k: 10 })], 'tool_use') : reply([text('Done.')], 'end_turn'));
    const lines = await events(await handleAsk(askRequest({ question: 'Hello?', documentIds: [fixture.ids['settlement.md']] }), deps()));
    const step = lines.find(({ type }) => type === 'step');
    expect(new Set(step?.hits.map(({ file }) => file))).toEqual(new Set(['settlement.md']));
  });

  it("keeps another session's upload out of the scope", async () => {
    const other = await ingestUpload(fixture.db, fakeEmbedder, 'sess2', 'theirs.txt', new TextEncoder().encode('Private notes about refunds.'));
    script = (calls) => (calls.length === 1 ? reply([toolUse('t1', 'list_documents', {})], 'tool_use') : reply([text('Done.')], 'end_turn'));
    await events(await handleAsk(askRequest({ question: 'What is there?' }), deps()));
    const listing = JSON.stringify(modelCalls[1].messages);
    expect(listing).toContain(fixture.ids['cancel.md']);
    expect(listing).not.toContain(other.id);
  });

  it('uses the keyword fallback for every search once the embedding budget is spent, and logs why', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await addEmbedTokens(fixture.db, EMBED_TOKENS_PER_DAY, NOW);
    script = (calls) =>
      calls.length === 1 ? reply([toolUse('t1', 'search_documents', { query: 'cancel a remittance transfer' })], 'tool_use') : reply([text('Done.')], 'end_turn');
    const lines = await events(await handleAsk(askRequest({ question: 'How long to cancel?' }), deps()));
    expect(lines.find(({ type }) => type === 'step')).toMatchObject({ fallback: 'keyword', fallbackReason: expect.stringContaining('Embedding budget reached') });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('search_documents fell back to keyword search: Embedding budget reached'));
  });
});

describe('POST /api/upload', () => {
  it('stores a text file for the session and records the embedding tokens', async () => {
    const response = await handleUpload(uploadRequest('notes.md', '# Refunds\nRefunds arrive within 12 days.'), deps());
    expect(response.status).toBe(200);
    expect((await response.json()).document).toMatchObject({ filename: 'notes.md', origin: 'upload', kind: 'md', chunks: 1 });
    expect(await spent('embed:tokens')).toBeGreaterThan(0);
  });

  it('replaces an earlier upload of the same filename in the same session', async () => {
    await handleUpload(uploadRequest('notes.md', '# Refunds\nRefunds arrive within 12 days.'), deps());
    await handleUpload(uploadRequest('notes.md', '# Refunds\nRefunds arrive within 30 days.'), deps());
    const { documents } = await (await handleDocuments(deps())).json();
    expect(documents.filter(({ origin }: { origin: string }) => origin === 'upload')).toHaveLength(1);
    expect(await fixture.db.query("select content from chunks c join documents d on d.id = c.document_id where d.collection = 'upload:sess1'")).toEqual([
      { content: '# Refunds\nRefunds arrive within 30 days.' },
    ]);
  });

  it('refuses the 11th upload in a day with a 429', async () => {
    const key = clientKey(new Headers({ 'x-forwarded-for': IP }), 'ip-secret');
    for (let i = 0; i < 10; i++) await reserveUpload(fixture.db, key, NOW);
    const response = await handleUpload(uploadRequest('notes.md', '# A\nText.'), deps());
    expect(response.status).toBe(429);
    expect(await response.json()).toMatchObject({ error: expect.stringContaining('10 uploads a day'), resetsAt: '2026-10-08T00:00:00.000Z' });
  });

  it('refuses uploads, with the reset time, once the embedding budget is spent', async () => {
    await addEmbedTokens(fixture.db, EMBED_TOKENS_PER_DAY, NOW);
    const response = await handleUpload(uploadRequest('notes.md', '# A\nText.'), deps());
    expect(response.status).toBe(429);
    expect((await response.json()).error).toContain('Embedding budget reached');
  });

  it('rejects a missing file, a wrong type, an empty file, a file over 4 MB, a scanned PDF and a PDF over 40 pages', async () => {
    expect((await handleUpload(uploadRequest('notes.md', 'x', 'other'), deps())).status).toBe(400);
    expect((await handleUpload(uploadRequest('malware.exe', 'x'), deps())).status).toBe(400);
    expect((await handleUpload(uploadRequest('empty.txt', ''), deps())).status).toBe(400);
    expect((await handleUpload(uploadRequest('big.txt', new Uint8Array(4 * 1024 * 1024 + 1)), deps())).status).toBe(413);
    const scanned = await handleUpload(uploadRequest('scan.pdf', makePdf([[], []])), deps());
    expect(scanned.status).toBe(422);
    expect((await scanned.json()).error).toContain('OCR is out of scope');
    const pages = Array.from({ length: 41 }, (_, i) => [`Topic ${String.fromCharCode(65 + (i % 26))}${String.fromCharCode(97 + Math.floor(i / 26))} text.`]);
    expect((await handleUpload(uploadRequest('long.pdf', makePdf(pages)), deps())).status).toBe(413);
    expect(await spent('embed:tokens')).toBe(0);
  });

  it('refuses a body that announces more than the limit without reading it', async () => {
    const request = { headers: new Headers({ 'content-length': '9999999' }), formData: async () => Promise.reject(new Error('should not be read')) } as unknown as Request;
    expect((await handleUpload(request, deps())).status).toBe(413);
  });
});

describe('GET /api/documents and DELETE /api/documents/:id', () => {
  it("lists the corpus and this session's uploads only", async () => {
    await ingestUpload(fixture.db, fakeEmbedder, 'sess1', 'mine.txt', new TextEncoder().encode('Mine.'));
    await ingestUpload(fixture.db, fakeEmbedder, 'sess2', 'theirs.txt', new TextEncoder().encode('Theirs.'));
    const { documents } = await (await handleDocuments(deps())).json();
    expect(documents.map(({ filename }: { filename: string }) => filename).sort()).toEqual(['cancel.md', 'mine.txt', 'rule.txt', 'sca.md', 'settlement.md']);
    const { documents: anonymous } = await (await handleDocuments(deps({}, null))).json();
    expect(anonymous.some(({ origin }: { origin: string }) => origin === 'upload')).toBe(false);
  });

  it("deletes the session's own upload, and nothing else", async () => {
    const mine = await ingestUpload(fixture.db, fakeEmbedder, 'sess1', 'mine.txt', new TextEncoder().encode('Mine.'));
    const theirs = await ingestUpload(fixture.db, fakeEmbedder, 'sess2', 'theirs.txt', new TextEncoder().encode('Theirs.'));
    expect((await handleDelete(theirs.id, deps())).status).toBe(404);
    expect((await handleDelete(fixture.ids['cancel.md'], deps())).status).toBe(404);
    expect((await handleDelete('not-a-uuid', deps())).status).toBe(400);
    expect((await handleDelete(mine.id, deps())).status).toBe(204);
    expect((await handleDelete(mine.id, deps())).status).toBe(404);
    expect(await fixture.db.query('select count(*)::int as n from documents')).toEqual([{ n: 5 }]);
  });

  it('answers 404 when the request has no session', async () => {
    const mine = await ingestUpload(fixture.db, fakeEmbedder, 'sess1', 'mine.txt', new TextEncoder().encode('Mine.'));
    expect((await handleDelete(mine.id, deps({}, null))).status).toBe(404);
  });
});

describe('GET /api/cron/cleanup', () => {
  const cleanup = (authorization?: string) => new Request('http://test/api/cron/cleanup', { headers: authorization ? { authorization } : {} });

  it('refuses a call without the cron secret', async () => {
    for (const authorization of [undefined, 'Bearer wrong', 'Bearer cron-secret-and-more', 'cron-secret']) expect((await handleCleanup(cleanup(authorization), deps())).status).toBe(401);
  });

  it('deletes uploads older than 24 hours and expired windows, and keeps the rest', async () => {
    const old = await ingestUpload(fixture.db, fakeEmbedder, 'sess1', 'old.txt', new TextEncoder().encode('Old.'));
    await ingestUpload(fixture.db, fakeEmbedder, 'sess1', 'fresh.txt', new TextEncoder().encode('Fresh.'));
    await fixture.db.query("update documents set created_at = $2::timestamptz - interval '25 hours' where id = $1::uuid", [old.id, NOW.toISOString()]);
    await reserveQuestion(fixture.db, 'abc', new Date('2026-10-07T11:00:00Z'));
    await reserveQuestion(fixture.db, 'abc', NOW);
    const response = await handleCleanup(cleanup('Bearer cron-secret'), deps());
    expect(await response.json()).toEqual({ uploadsDeleted: 1, windowsDeleted: 1 });
    expect(await fixture.db.query("select filename from documents where collection like 'upload:%'")).toEqual([{ filename: 'fresh.txt' }]);
    expect(await fixture.db.query('select count(*)::int as n from usage_windows')).toEqual([{ n: 1 }]);
  });
});
