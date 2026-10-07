import { describe, expect, it, vi } from 'vitest';
import { createEmbedder, EMBEDDING_DIMENSIONS } from './embed';

const vector = (seed: number) => Array.from({ length: EMBEDDING_DIMENSIONS }, (_, i) => (i === seed % EMBEDDING_DIMENSIONS ? 1 : 0));

const ok = (input: string[], reverse = false) => {
  const data = input.map((text, index) => ({ index, embedding: vector(Number(text.replace(/\D/g, '') || 0)) }));
  return new Response(JSON.stringify({ data: reverse ? data.reverse() : data, usage: { total_tokens: input.length * 10 } }));
};

const requestOf = (call: unknown[]) => JSON.parse((call[1] as RequestInit).body as string) as { input: string[]; [key: string]: unknown };

describe('createEmbedder', () => {
  it('sends voyage-4 at 1024 dimensions without truncation, and returns embeddings and token usage', async () => {
    const fetchImpl = vi.fn(async (_url: unknown, init?: RequestInit) => ok(JSON.parse(init?.body as string).input));
    const result = await createEmbedder({ apiKey: 'test-key', fetchImpl })(['text 1', 'text 2'], 'query');
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(fetchImpl.mock.calls[0][0]).toBe('https://api.voyageai.com/v1/embeddings');
    const init = fetchImpl.mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer test-key');
    expect(requestOf(fetchImpl.mock.calls[0])).toEqual({
      input: ['text 1', 'text 2'],
      model: 'voyage-4',
      input_type: 'query',
      truncation: false,
      output_dimension: 1024,
    });
    expect(result.tokens).toBe(20);
    expect(result.embeddings).toEqual([vector(1), vector(2)]);
  });

  it('sends at most 128 texts per request and sums the usage', async () => {
    const fetchImpl = vi.fn(async (_url: unknown, init?: RequestInit) => ok(JSON.parse(init?.body as string).input));
    const texts = Array.from({ length: 300 }, (_, i) => `text ${i}`);
    const result = await createEmbedder({ apiKey: 'k', fetchImpl })(texts, 'document');
    expect(fetchImpl.mock.calls.map((call) => requestOf(call).input.length)).toEqual([128, 128, 44]);
    expect(result.tokens).toBe(3000);
    expect(result.embeddings).toHaveLength(300);
    expect(result.embeddings[299]).toEqual(vector(299));
  });

  it('starts a new request when a batch would pass maxBatchTokens, and sends an oversize text alone', async () => {
    const fetchImpl = vi.fn(async (_url: unknown, init?: RequestInit) => ok(JSON.parse(init?.body as string).input));
    const texts = ['a'.repeat(400), 'b'.repeat(400), 'c'.repeat(400), 'd'.repeat(40)];
    await createEmbedder({ apiKey: 'k', fetchImpl, maxBatchTokens: 250 })(texts, 'document');
    expect(fetchImpl.mock.calls.map((call) => requestOf(call).input.length)).toEqual([2, 2]);
    fetchImpl.mockClear();
    await createEmbedder({ apiKey: 'k', fetchImpl, maxBatchTokens: 50 })(texts, 'document');
    expect(fetchImpl.mock.calls.map((call) => requestOf(call).input.length)).toEqual([1, 1, 1, 1]);
  });

  it('keeps requests at least minIntervalMs apart', async () => {
    let clock = 0;
    const waits: number[] = [];
    const sleep = async (ms: number) => {
      waits.push(ms);
      clock += ms;
    };
    const fetchImpl = vi.fn(async (_url: unknown, init?: RequestInit) => ok(JSON.parse(init?.body as string).input));
    const texts = ['a'.repeat(400), 'b'.repeat(400), 'c'.repeat(400)];
    await createEmbedder({ apiKey: 'k', fetchImpl, sleep, now: () => clock, maxBatchTokens: 100, minIntervalMs: 20_000 })(texts, 'document');
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(waits).toEqual([20_000, 20_000]);
  });

  it('puts embeddings back in input order', async () => {
    const fetchImpl = vi.fn(async (_url: unknown, init?: RequestInit) => ok(JSON.parse(init?.body as string).input, true));
    const result = await createEmbedder({ apiKey: 'k', fetchImpl })(['text 1', 'text 2', 'text 3'], 'document');
    expect(result.embeddings).toEqual([vector(1), vector(2), vector(3)]);
  });

  it('backs off exponentially on 429 and then succeeds', async () => {
    const responses = [new Response('slow down', { status: 429 }), new Response('slow down', { status: 429 })];
    const fetchImpl = vi.fn(async (_url: unknown, init?: RequestInit) => responses.shift() ?? ok(JSON.parse(init?.body as string).input));
    const sleep = vi.fn<(ms: number) => Promise<void>>(async () => {});
    const result = await createEmbedder({ apiKey: 'k', fetchImpl, sleep })(['text 1'], 'document');
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([1000, 2000]);
    expect(result.tokens).toBe(10);
  });

  it('waits at least as long as Retry-After asks', async () => {
    const responses = [new Response('slow', { status: 429, headers: { 'retry-after': '45' } })];
    const fetchImpl = vi.fn(async (_url: unknown, init?: RequestInit) => responses.shift() ?? ok(JSON.parse(init?.body as string).input));
    const sleep = vi.fn<(ms: number) => Promise<void>>(async () => {});
    await createEmbedder({ apiKey: 'k', fetchImpl, sleep })(['text 1'], 'document');
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([45_000]);
  });

  it('gives up after repeated 429s and reports the status', async () => {
    const fetchImpl = vi.fn(async () => new Response('rate limited', { status: 429 }));
    const sleep = vi.fn<(ms: number) => Promise<void>>(async () => {});
    await expect(createEmbedder({ apiKey: 'k', fetchImpl, sleep })(['text 1'], 'document')).rejects.toThrow('HTTP 429: rate limited');
    expect(fetchImpl).toHaveBeenCalledTimes(7);
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([1000, 2000, 4000, 8000, 16000, 30000]);
  });

  it('fails at once on other errors, with the API message and no retry', async () => {
    const fetchImpl = vi.fn(async () => new Response('{"detail":"Request to model is too large"}', { status: 400 }));
    const sleep = vi.fn(async () => {});
    await expect(createEmbedder({ apiKey: 'k', fetchImpl, sleep })(['text 1'], 'document')).rejects.toThrow(
      'HTTP 400: {"detail":"Request to model is too large"}',
    );
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(sleep).not.toHaveBeenCalled();
  });

  it('makes one attempt with maxRetries 0, so a 429 throws at once', async () => {
    const fetchImpl = vi.fn(async () => new Response('rate limited', { status: 429 }));
    const sleep = vi.fn<(ms: number) => Promise<void>>(async () => {});
    await expect(createEmbedder({ apiKey: 'k', fetchImpl, sleep, maxRetries: 0 })(['text 1'], 'query')).rejects.toThrow('HTTP 429: rate limited');
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(sleep).not.toHaveBeenCalled();
  });

  it('passes a deadline signal to fetch when timeoutMs is set, and none otherwise', async () => {
    const fetchImpl = vi.fn(async (_url: unknown, init?: RequestInit) => ok(JSON.parse(init?.body as string).input));
    await createEmbedder({ apiKey: 'k', fetchImpl, timeoutMs: 5000 })(['text 1'], 'query');
    await createEmbedder({ apiKey: 'k', fetchImpl })(['text 1'], 'query');
    expect((fetchImpl.mock.calls[0][1] as RequestInit).signal).toBeInstanceOf(AbortSignal);
    expect((fetchImpl.mock.calls[1][1] as RequestInit).signal).toBeUndefined();
  });

  it('rejects a response with the wrong dimension or count', async () => {
    const wrongDimension = vi.fn(async () => new Response(JSON.stringify({ data: [{ index: 0, embedding: [1, 2, 3] }], usage: { total_tokens: 1 } })));
    await expect(createEmbedder({ apiKey: 'k', fetchImpl: wrongDimension })(['a'], 'document')).rejects.toThrow();
    const wrongCount = vi.fn(async () => ok(['text 1']));
    await expect(createEmbedder({ apiKey: 'k', fetchImpl: wrongCount })(['a', 'b'], 'document')).rejects.toThrow('1 embeddings for 2 texts');
  });

  it('makes no request for no texts', async () => {
    const fetchImpl = vi.fn();
    expect(await createEmbedder({ apiKey: 'k', fetchImpl })([], 'document')).toEqual({ embeddings: [], tokens: 0 });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
