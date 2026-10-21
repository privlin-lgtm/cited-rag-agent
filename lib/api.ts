import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { runAgent, type AgentEvent, type ModelCall } from './agent/loop';
import type { Db } from './db';
import { deleteExpiredUploads, deleteUpload, listDocuments } from './documents';
import type { Embedder } from './embed';
import { addCost, addEmbedTokens, assertEmbedBudget, clientKey, deleteExpiredWindows, LimitError, releaseBudget, reserveBudget, reserveQuestion, reserveUpload } from './limits';
import { costUsd, type PricedModel } from './pricing';
import { ingestUpload, MAX_UPLOAD_BYTES, UploadError } from './upload';

export type ApiDeps = {
  db: Db;
  now: () => Date;
  sessionId: (options: { create: boolean }) => Promise<string | undefined>;
  ipSecret: string;
  cronSecret: string;
  budgetUsd: number;
  model: { id: PricedModel; call: ModelCall };
  queryEmbedder: Embedder;
  documentEmbedder: Embedder;
};

const askBody = z.object({ question: z.string().trim().min(1).max(500), documentIds: z.array(z.string().max(64)).min(1).max(100).optional() });
const BODY_SLACK_BYTES = 512 * 1024;

const crossSite = (request: Request) => {
  const site = request.headers.get('sec-fetch-site');
  if (site === 'cross-site' || site === 'same-site') return true;
  const origin = request.headers.get('origin');
  return origin !== null && (!URL.canParse(origin) || new URL(origin).host !== (request.headers.get('host') ?? new URL(request.url).host));
};

const guard = async (request: Request, deps: ApiDeps, run: () => Promise<Response>) => {
  if (crossSite(request)) return Response.json({ error: 'Cross-site requests are not allowed.' }, { status: 403 });
  try {
    return await run();
  } catch (error) {
    if (error instanceof LimitError)
      return Response.json(
        { error: error.message, resetsAt: error.resetsAt.toISOString() },
        { status: 429, headers: { 'Retry-After': String(Math.max(1, Math.ceil((error.resetsAt.getTime() - deps.now().getTime()) / 1000))) } },
      );
    if (error instanceof UploadError) return Response.json({ error: error.message }, { status: error.status });
    throw error;
  }
};

const debited =
  (embedder: Embedder, { db, now }: ApiDeps): Embedder =>
  (texts, inputType) =>
    embedder(texts, inputType, (tokens) => addEmbedTokens(db, tokens, now()));

const ndjson = (events: ReadableStream<Uint8Array>) =>
  new Response(events, { headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' } });

export const handleAsk = (request: Request, deps: ApiDeps) =>
  guard(request, deps, async () => {
    const parsed = askBody.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return Response.json({ error: 'Send { "question": 1 to 500 characters, "documentIds": optional list of document ids }.' }, { status: 400 });
    const { question, documentIds } = parsed.data;
    await reserveQuestion(deps.db, clientKey(request.headers, deps.ipSecret), deps.now());
    const sessionId = await deps.sessionId({ create: true });
    const documents = await listDocuments(deps.db, sessionId);
    const allowed = new Set(documents.map(({ id }) => id));
    if (documentIds?.some((id) => !allowed.has(id))) return Response.json({ error: 'A selected document is not available to this session.' }, { status: 400 });

    const reservedAt = deps.now();
    await reserveBudget(deps.db, deps.budgetUsd, reservedAt);

    const sourceUrls = new Map(documents.flatMap(({ id, sourceUrl }) => (sourceUrl ? [[id, sourceUrl] as const] : [])));
    const started = performance.now();
    const encoder = new TextEncoder();
    let closed = false;

    return ndjson(
      new ReadableStream<Uint8Array>({
        cancel() {
          closed = true;
        },
        async start(controller) {
          const write = (event: object) => {
            if (!closed) controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
          };
          const totals = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
          let cost = 0;
          const run = { status: 'error' as 'complete' | 'cut_off' | 'declined' | 'error', rounds: 0, toolCalls: 0, keywordFallbacks: 0 };
          const result = () => ({ model: deps.model.id, ...totals, costUsd: cost, latencyMs: Math.round(performance.now() - started) });
          let recording: Promise<unknown> = Promise.resolve();
          const record = ({ anthropic: usage }: Extract<AgentEvent, { type: 'usage' }>) => {
            const counts = {
              inputTokens: usage.input_tokens,
              outputTokens: usage.output_tokens,
              cacheReadTokens: usage.cache_read_input_tokens ?? 0,
              cacheWriteTokens: usage.cache_creation_input_tokens ?? 0,
            };
            const usd = costUsd(deps.model.id, counts);
            cost += usd;
            for (const key of Object.keys(totals) as (keyof typeof totals)[]) totals[key] += counts[key];
            recording = recording.then(() => addCost(deps.db, usd, deps.now()));
          };
          const queryEmbed = debited(deps.queryEmbedder, deps);
          try {
            try {
              await runAgent(
                {
                  model: deps.model.call,
                  modelId: deps.model.id,
                  db: deps.db,
                  embed: async (texts, inputType) => {
                    await assertEmbedBudget(deps.db, deps.now());
                    return queryEmbed(texts, inputType);
                  },
                  scope: documentIds ?? [...allowed],
                  sourceUrlOf: (documentId) => sourceUrls.get(documentId) ?? null,
                },
                question,
                (event) => {
                  if (event.type === 'usage') return record(event);
                  if (event.type === 'citations') run.status = event.status;
                  if (event.type === 'step') {
                    run.rounds = event.round;
                    run.toolCalls++;
                    if (event.fallback) {
                      run.keywordFallbacks++;
                      console.warn(`${event.tool} fell back to keyword search: ${event.fallbackReason}`);
                    }
                  }
                  write(event);
                },
              );
              await recording;
            } catch (error) {
              run.status = 'error';
              write({ type: 'error', message: error instanceof Error ? error.message : String(error), excerpts: [] });
              await recording;
            }
          } finally {
            console.info(JSON.stringify({ event: 'ask', ...run, ...result() }));
            await releaseBudget(deps.db, reservedAt);
          }
          write({ type: 'done', ...result() });
          if (!closed) controller.close();
        },
      }),
    );
  });

export const handleUpload = (request: Request, deps: ApiDeps) =>
  guard(request, deps, async () => {
    if (Number(request.headers.get('content-length') ?? 0) > MAX_UPLOAD_BYTES + BODY_SLACK_BYTES) return Response.json({ error: 'The file is larger than 4 MB.' }, { status: 413 });
    const file = (await request.formData().catch(() => null))?.get('file');
    if (!(file instanceof File)) return Response.json({ error: 'Send one file in the "file" field of a multipart form.' }, { status: 400 });
    const sessionId = (await deps.sessionId({ create: true })) ?? '';
    await reserveUpload(deps.db, clientKey(request.headers, deps.ipSecret), deps.now());
    await assertEmbedBudget(deps.db, deps.now());
    const result = await ingestUpload(deps.db, debited(deps.documentEmbedder, deps), sessionId, file.name, new Uint8Array(await file.arrayBuffer()), (estimatedTokens) =>
      assertEmbedBudget(deps.db, deps.now(), estimatedTokens),
    );
    const document = (await listDocuments(deps.db, sessionId)).find(({ id }) => id === result.id);
    return Response.json({ document });
  });

export const handleDocuments = async (deps: ApiDeps) =>
  Response.json({ documents: await listDocuments(deps.db, await deps.sessionId({ create: false })) });

export const handleDelete = (request: Request, id: string, deps: ApiDeps) =>
  guard(request, deps, async () => {
    if (!z.uuid().safeParse(id).success) return Response.json({ error: 'That is not a document id.' }, { status: 400 });
    const sessionId = await deps.sessionId({ create: false });
    if (!sessionId || !(await deleteUpload(deps.db, sessionId, id))) return Response.json({ error: 'No upload with that id in this session.' }, { status: 404 });
    return new Response(null, { status: 204 });
  });

export const handleCleanup = async (request: Request, deps: ApiDeps) => {
  const expected = Buffer.from(`Bearer ${deps.cronSecret}`);
  const given = Buffer.from(request.headers.get('authorization') ?? '');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return new Response('Unauthorized', { status: 401 });
  return Response.json({
    uploadsDeleted: await deleteExpiredUploads(deps.db, deps.now()),
    windowsDeleted: await deleteExpiredWindows(deps.db, deps.now()),
  });
};
