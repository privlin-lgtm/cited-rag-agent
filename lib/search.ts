import type { Db } from './db';

export type Hit = { id: string; filename: string; locator: string; content: string; score: number };
export type SearchOptions = { k?: number; documentIds?: string[] };

const inScope = (n: number) => `($${n}::jsonb is null or d.id::text in (select jsonb_array_elements_text($${n}::jsonb)))`;
const scopeParam = (documentIds?: string[]) => (documentIds ? JSON.stringify(documentIds) : null);

export const semanticSearch = (db: Db, embedding: number[], { k = 5, documentIds }: SearchOptions = {}) =>
  db.query<Hit>(
    `select c.id::text as id, d.filename, c.locator, c.content, 1 - (c.embedding <=> $1::vector) as score
     from chunks c join documents d on d.id = c.document_id
     where ${inScope(3)}
     order by c.embedding <=> $1::vector
     limit $2`,
    [`[${embedding.join(',')}]`, k, scopeParam(documentIds)],
  );

export const keywordSearch = (db: Db, terms: string, { k = 5, documentIds }: SearchOptions = {}) =>
  db.query<Hit>(
    `select c.id::text as id, d.filename, c.locator, c.content, ts_rank_cd(c.tsv, q)::float8 as score
     from chunks c
     join documents d on d.id = c.document_id,
     websearch_to_tsquery('english', $1) q
     where c.tsv @@ q and ${inScope(3)}
     order by score desc, c.id
     limit $2`,
    [terms, k, scopeParam(documentIds)],
  );
