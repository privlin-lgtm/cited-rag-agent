import type { TextCitation } from '@anthropic-ai/sdk/resources/messages';
import type { Db } from '../db';
import { splitSentences } from './sentences';

export type SentResult = {
  index: number;
  chunkId: string;
  documentId: string;
  file: string;
  locator: string;
  score: number | null;
  blocks: string[];
  round: number;
};

export type CitationCheck =
  | { ok: true; excerpt: number; chunkId: string; blocks: [number, number] }
  | { ok: false; reason: 'index' | 'blocks' | 'chunk' | 'scope' | 'text' };

export type Excerpt = {
  n: number;
  chunkId: string;
  documentId: string;
  file: string;
  locator: string;
  sourceUrl: string | null;
  blocks: { text: string; cited: boolean }[];
};

const collapse = (text: string) => text.replace(/\s+/g, ' ').trim();
const fail = (reason: Extract<CitationCheck, { ok: false }>['reason']): CitationCheck => ({ ok: false, reason });

export const checkCitations = async (
  db: Db,
  sent: readonly SentResult[],
  scope: ReadonlySet<string>,
  citations: readonly TextCitation[],
  sourceUrlOf: (documentId: string) => string | null,
): Promise<{ results: CitationCheck[]; excerpts: Excerpt[] }> => {
  const checks: (CitationCheck | { pending: { sentIndex: number; start: number; end: number } })[] = citations.map((citation) => {
    if (citation.type !== 'search_result_location') return fail('index');
    const { search_result_index: index, start_block_index: start, end_block_index: end } = citation;
    if (!Number.isInteger(index) || index < 0 || index >= sent.length) return fail('index');
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || start >= end || end > sent[index].blocks.length) return fail('blocks');
    return { pending: { sentIndex: index, start, end } };
  });

  const chunkIds = [...new Set(checks.flatMap((check) => ('pending' in check ? [sent[check.pending.sentIndex].chunkId] : [])))];
  const rows = chunkIds.length
    ? await db.query<{ id: string; document_id: string; filename: string; locator: string; content: string }>(
        `select c.id::text as id, c.document_id::text as document_id, d.filename, c.locator, c.content
         from chunks c join documents d on d.id = c.document_id
         where c.id in (select (jsonb_array_elements_text($1::text::jsonb))::bigint)`,
        [JSON.stringify(chunkIds)],
      )
    : [];
  const byId = new Map(rows.map((row) => [row.id, { ...row, blocks: splitSentences(row.content), normalised: collapse(row.content) }]));

  const excerpts = new Map<string, Excerpt & { ranges: [number, number][] }>();
  const results = checks.map((check): CitationCheck => {
    if (!('pending' in check)) return check;
    const { sentIndex, start, end } = check.pending;
    const entry = sent[sentIndex];
    const row = byId.get(entry.chunkId);
    if (!row) return fail('chunk');
    if (!scope.has(row.document_id)) return fail('scope');
    for (let b = start; b < end; b++) if (entry.blocks[b] !== row.blocks[b] || !row.normalised.includes(entry.blocks[b])) return fail('text');
    const excerpt =
      excerpts.get(row.id) ??
      (() => {
        const created = {
          n: excerpts.size + 1,
          chunkId: row.id,
          documentId: row.document_id,
          file: row.filename,
          locator: row.locator,
          sourceUrl: sourceUrlOf(row.document_id),
          blocks: [],
          ranges: [],
        };
        excerpts.set(row.id, created);
        return created;
      })();
    excerpt.ranges.push([start, end]);
    return { ok: true, excerpt: excerpt.n, chunkId: row.id, blocks: [start, end] };
  });

  return {
    results,
    excerpts: [...excerpts.values()].map(({ ranges, ...excerpt }) => ({
      ...excerpt,
      blocks: byId.get(excerpt.chunkId)?.blocks.map((text, b) => ({ text, cited: ranges.some(([start, end]) => b >= start && b < end) })) ?? [],
    })),
  };
};
