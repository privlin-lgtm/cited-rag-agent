import type { Db } from './db';

export type Hit = { id: string; documentId: string; filename: string; locator: string; content: string; score: number };
export type SearchOptions = { k?: number; documentIds: string[] };

export const SEMANTIC_SQL = `with relaxed as materialized (
    select c.id, c.embedding <=> $1::vector as distance
    from chunks c
    where c.document_id::text in (select jsonb_array_elements_text($3::text::jsonb))
    order by c.embedding <=> $1::vector
    limit $2
  )
  select c.id::text as id, c.document_id::text as "documentId", d.filename, c.locator, c.content, 1 - r.distance as score
  from relaxed r
  join chunks c on c.id = r.id
  join documents d on d.id = c.document_id
  order by r.distance + 0`;

export const semanticSearch = async (db: Db, embedding: number[], { k = 5, documentIds }: SearchOptions): Promise<Hit[]> =>
  documentIds.length
    ? db.transaction(async (tx) => {
        await tx.query("select set_config('hnsw.iterative_scan', 'relaxed_order', true)");
        return tx.query<Hit>(SEMANTIC_SQL, [`[${embedding.join(',')}]`, k, JSON.stringify(documentIds)]);
      })
    : [];

export const keywordSearch = async (db: Db, terms: string, { k = 5, documentIds }: SearchOptions): Promise<Hit[]> =>
  documentIds.length
    ? db.query<Hit>(
        `select c.id::text as id, c.document_id::text as "documentId", d.filename, c.locator, c.content, ts_rank_cd(c.tsv, q)::float8 as score
         from chunks c
         join documents d on d.id = c.document_id,
         websearch_to_tsquery('english', $1) q
         where c.tsv @@ q and d.id::text in (select jsonb_array_elements_text($3::text::jsonb))
         order by score desc, c.id
         limit $2`,
        [terms, k, JSON.stringify(documentIds)],
      )
    : [];
