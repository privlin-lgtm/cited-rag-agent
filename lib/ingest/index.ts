import { createHash } from 'node:crypto';
import type { Db } from '../db';
import type { Embedder } from '../embed';
import { chunkParts } from './chunk';
import { extract, type Kind } from './extract';

export const INGEST_VERSION = 2;
const INSERT_BATCH = 100;

export type IngestInput = { collection: string; filename: string; kind: Kind; data: Uint8Array };
export type IngestReport =
  | { status: 'skipped'; chunks: number }
  | { status: 'ingested'; pages: number | null; chunks: number; tokens: number };

export const ingestDocument = async (
  db: Db,
  embed: Embedder,
  { collection, filename, kind, data }: IngestInput,
  version = INGEST_VERSION,
): Promise<IngestReport> => {
  const sha256 = createHash('sha256').update(data).digest('hex');
  const [existing] = await db.query<{ sha256: string; ingest_version: number; chunks: number }>(
    `select d.sha256, d.ingest_version, (select count(*) from chunks c where c.document_id = d.id)::int as chunks
     from documents d where d.collection = $1 and d.filename = $2`,
    [collection, filename],
  );
  if (existing?.sha256 === sha256 && existing.ingest_version === version) return { status: 'skipped', chunks: existing.chunks };

  const { pages, parts } = await extract(kind, data);
  const chunks = chunkParts(parts);
  if (!chunks.length) throw new Error(`${filename} has no extractable text`);
  const { embeddings, tokens } = await embed(
    chunks.map(({ content }) => content),
    'document',
  );
  if (embeddings.length !== chunks.length) throw new Error(`${filename}: ${embeddings.length} embeddings for ${chunks.length} chunks`);

  await db.transaction(async (tx) => {
    await tx.query('delete from documents where collection = $1 and filename = $2', [collection, filename]);
    const [{ id }] = await tx.query<{ id: string }>(
      'insert into documents (collection, filename, kind, sha256, ingest_version) values ($1, $2, $3, $4, $5) returning id',
      [collection, filename, kind, sha256, version],
    );
    for (let i = 0; i < chunks.length; i += INSERT_BATCH)
      await tx.query(
        `insert into chunks (document_id, ord, locator, content, embedding)
         select $1::uuid, (r->>'ord')::int, r->>'locator', r->>'content', (r->>'embedding')::vector
         from jsonb_array_elements($2::text::jsonb) with ordinality as t(r, i)
         order by i`,
        [
          id,
          JSON.stringify(
            chunks.slice(i, i + INSERT_BATCH).map(({ locator, content }, offset) => ({
              ord: i + offset,
              locator,
              content,
              embedding: `[${embeddings[i + offset].join(',')}]`,
            })),
          ),
        ],
      );
  });
  return { status: 'ingested', pages, chunks: chunks.length, tokens };
};
