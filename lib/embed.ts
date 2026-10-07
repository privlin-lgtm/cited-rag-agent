import { z } from 'zod';

export const EMBEDDING_MODEL = 'voyage-4';
export const EMBEDDING_DIMENSIONS = 1024;
export const MAX_BATCH = 128;
const MAX_RETRIES = 6;
const MAX_BACKOFF_MS = 30_000;

export type InputType = 'document' | 'query';
export type Embedder = (texts: string[], inputType: InputType) => Promise<{ embeddings: number[][]; tokens: number }>;

const response = z.object({
  data: z.array(z.object({ index: z.number(), embedding: z.array(z.number()).length(EMBEDDING_DIMENSIONS) })),
  usage: z.object({ total_tokens: z.number() }),
});

export const createEmbedder = ({
  apiKey,
  fetchImpl = fetch,
  sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
  now = Date.now,
  maxBatchTokens = Infinity,
  minIntervalMs = 0,
}: {
  apiKey: string;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  maxBatchTokens?: number;
  minIntervalMs?: number;
}): Embedder => {
  let lastRequestAt = -Infinity;

  const batches = (texts: string[]) => {
    const out: string[][] = [];
    let tokens = 0;
    for (const text of texts) {
      const cost = Math.ceil(text.length / 4);
      const last = out[out.length - 1];
      if (last && last.length < MAX_BATCH && tokens + cost <= maxBatchTokens) {
        last.push(text);
        tokens += cost;
      } else {
        out.push([text]);
        tokens = cost;
      }
    }
    return out;
  };

  const post = async (input: string[], inputType: InputType) => {
    for (let attempt = 0; ; attempt++) {
      const wait = lastRequestAt + minIntervalMs - now();
      if (wait > 0) await sleep(wait);
      lastRequestAt = now();
      const res = await fetchImpl('https://api.voyageai.com/v1/embeddings', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ input, model: EMBEDDING_MODEL, input_type: inputType, truncation: false, output_dimension: EMBEDDING_DIMENSIONS }),
      });
      if (res.status === 429 && attempt < MAX_RETRIES) {
        await sleep(Math.min(2 ** attempt * 1000, MAX_BACKOFF_MS));
        continue;
      }
      if (!res.ok) throw new Error(`Voyage embeddings failed with HTTP ${res.status}: ${await res.text()}`);
      const body = response.parse(await res.json());
      if (body.data.length !== input.length) throw new Error(`Voyage returned ${body.data.length} embeddings for ${input.length} texts`);
      return { embeddings: body.data.sort((a, b) => a.index - b.index).map(({ embedding }) => embedding), tokens: body.usage.total_tokens };
    }
  };

  return async (texts, inputType) => {
    const embeddings: number[][] = [];
    let tokens = 0;
    for (const batch of batches(texts)) {
      const result = await post(batch, inputType);
      embeddings.push(...result.embeddings);
      tokens += result.tokens;
    }
    return { embeddings, tokens };
  };
};
