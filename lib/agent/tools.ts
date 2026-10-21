import type { SearchResultBlockParam, TextBlockParam, Tool } from '@anthropic-ai/sdk/resources/messages';
import { z } from 'zod';
import type { Db } from '../db';
import { titleOf } from '../documents';
import type { Embedder } from '../embed';
import { keywordSearch, semanticSearch, type Hit } from '../search';
import type { SentResult } from './citations';
import { splitSentences } from './sentences';

const documentIds = z.array(z.string()).optional().describe('Restrict the search to these document ids from list_documents. Omit to search every document in scope.');
const k = z.int().min(1).max(10).default(5).describe('How many passages to return, 1 to 10.');

export const inputs = {
  search_documents: z.object({
    query: z.string().min(1).max(500).describe('A natural-language description of the passage you need, in the documents\' own terms.'),
    k,
    document_ids: documentIds,
  }),
  keyword_search: z.object({
    terms: z.string().min(1).max(200).describe('One to three exact terms or a quoted phrase, such as "§ 1005.33" or "strong customer authentication". Every plain term must appear in a passage; write OR between alternatives.'),
    k,
    document_ids: documentIds,
  }),
  read_neighbours: z.object({
    chunk_id: z.string().regex(/^\d{1,18}$/).describe('The number after "chunk:" in a search result source.'),
    before: z.int().min(0).max(2).default(1).describe('Passages to read before it, 0 to 2.'),
    after: z.int().min(0).max(2).default(1).describe('Passages to read after it, 0 to 2.'),
  }),
  list_documents: z.object({}),
};

export type ToolName = keyof typeof inputs;

const descriptions: Record<ToolName, string> = {
  search_documents: 'Semantic search over the documents in scope. Use it for questions in plain language. Returns the best passages with their file and location.',
  keyword_search: 'Exact-term search over the documents in scope, for section numbers, defined terms and phrases. All plain terms must appear, so send one to three exact terms or a quoted phrase, and write OR between alternatives.',
  read_neighbours: 'Read the passages just before and after a passage, when a search result is cut off. Pass the chunk id from the result source.',
  list_documents: 'List the documents in scope with their ids, titles and sizes.',
};

export const tools: Tool[] = (Object.keys(inputs) as ToolName[]).map((name) => ({
  name,
  description: descriptions[name],
  input_schema: JSON.parse(JSON.stringify(z.toJSONSchema(inputs[name], { io: 'input' }), (key, value) => (key === '$schema' ? undefined : value))),
}));

export type ToolContext = { db: Db; embed: Embedder; scope: ReadonlySet<string> };

export type ToolRun = {
  content: (SearchResultBlockParam | TextBlockParam)[];
  entries: Omit<SentResult, 'index' | 'round'>[];
  hits: { file: string; locator: string; score: number | null }[];
  input: unknown;
  isError: boolean;
  fallback?: 'keyword';
  fallbackReason?: string;
  error?: string;
};

const text = (value: string): TextBlockParam => ({ type: 'text', text: value });

const failed = (input: unknown, message: string): ToolRun => ({ content: [text(message)], entries: [], hits: [], input, isError: true, error: message });

const asRun = (input: unknown, found: (Omit<Hit, 'score'> & { score: number | null })[], extra: Partial<ToolRun> = {}): ToolRun => {
  const usable = found.map((hit) => ({ hit, blocks: splitSentences(hit.content) })).filter(({ blocks }) => blocks.length);
  return {
    content: usable.length
      ? usable.map(({ hit, blocks }) => ({
          type: 'search_result' as const,
          source: `chunk:${hit.id}`,
          title: `${hit.filename} · ${hit.locator}`,
          content: blocks.map(text),
          citations: { enabled: true },
        }))
      : [text('No matching passages.')],
    entries: usable.map(({ hit, blocks }) => ({ chunkId: hit.id, documentId: hit.documentId, file: hit.filename, locator: hit.locator, score: hit.score, blocks })),
    hits: usable.map(({ hit }) => ({ file: hit.filename, locator: hit.locator, score: hit.score })),
    input,
    isError: false,
    ...extra,
  };
};

const effectiveIds = (requested: string[] | undefined, scope: ReadonlySet<string>) => (requested?.length ? requested.filter((id) => scope.has(id)) : [...scope]);
const NOT_IN_SCOPE = 'None of the requested document_ids are in scope. Call list_documents to see the ids you can use.';

const orQuery = (query: string) => (query.match(/[\p{L}\p{N}][\p{L}\p{N}.§-]{2,}/gu) ?? []).join(' or ');

export const runTool = async ({ db, embed, scope }: ToolContext, name: string, rawInput: unknown): Promise<ToolRun> => {
  if (!(name in inputs)) return failed(rawInput, `Unknown tool "${name}". Use search_documents, keyword_search, read_neighbours or list_documents.`);
  const parsed = inputs[name as ToolName].safeParse(rawInput);
  if (!parsed.success) return failed(rawInput, `Invalid input for ${name}: ${parsed.error.issues.map((issue) => `${issue.path.join('.') || 'input'} ${issue.message}`).join('; ')}`);

  if (name === 'search_documents' || name === 'keyword_search') {
    const args = parsed.data as { query?: string; terms?: string; k: number; document_ids?: string[] };
    const ids = effectiveIds(args.document_ids, scope);
    const input = { ...args, document_ids: args.document_ids?.length ? ids : undefined };
    if (args.document_ids?.length && !ids.length) return failed(input, NOT_IN_SCOPE);
    if (name === 'keyword_search') return asRun(input, await keywordSearch(db, args.terms ?? '', { k: args.k, documentIds: ids }));
    let fallbackReason = '';
    const embedded = await embed([args.query ?? ''], 'query').then(
      (result) => result,
      (error: unknown) => {
        fallbackReason = error instanceof Error ? error.message : String(error);
        return null;
      },
    );
    return embedded
      ? asRun(input, await semanticSearch(db, embedded.embeddings[0], { k: args.k, documentIds: ids }))
      : asRun(input, await keywordSearch(db, orQuery(args.query ?? ''), { k: args.k, documentIds: ids }), { fallback: 'keyword', fallbackReason });
  }

  if (name === 'read_neighbours') {
    const args = parsed.data as { chunk_id: string; before: number; after: number };
    const rows = await db.query<Hit & { ord: number }>(
      `select c.id::text as id, c.document_id::text as "documentId", d.filename, c.locator, c.content, c.ord
       from chunks c join documents d on d.id = c.document_id
       where c.document_id = (select document_id from chunks where id = $1::bigint)
         and c.ord between (select ord from chunks where id = $1::bigint) - $2::int and (select ord from chunks where id = $1::bigint) + $3::int
         and c.id <> $1::bigint
         and c.document_id::text in (select jsonb_array_elements_text($4::text::jsonb))
       order by c.ord`,
      [args.chunk_id, args.before, args.after, JSON.stringify([...scope])],
    );
    return asRun(args, rows.map((row) => ({ ...row, score: null })));
  }

  const rows = await db.query<{ id: string; collection: string; filename: string; kind: string; chunks: number }>(
    `select d.id::text as id, d.collection, d.filename, d.kind, count(c.id)::int as chunks
     from documents d left join chunks c on c.document_id = d.id
     where d.id::text in (select jsonb_array_elements_text($1::text::jsonb))
     group by d.id order by d.filename`,
    [JSON.stringify([...scope])],
  );
  return {
    content: [text(rows.length ? rows.map((row) => `${row.id} · ${row.collection === 'corpus' ? titleOf(row.filename) : row.filename} · ${row.kind} · ${row.chunks} passages`).join('\n') : 'No documents are in scope.')],
    entries: [],
    hits: [],
    input: {},
    isError: false,
  };
};
