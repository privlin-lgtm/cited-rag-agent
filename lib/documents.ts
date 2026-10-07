import manifestJson from '../corpus/manifest.json';
import type { Db } from './db';
import { manifestSchema } from './manifest';

export const manifest = manifestSchema.parse(manifestJson);

const byFilename = new Map(manifest.documents.map((document) => [document.filename, document]));

export const titleOf = (filename: string) => byFilename.get(filename)?.title ?? filename;

export type DocumentView = {
  id: string;
  filename: string;
  title: string;
  kind: 'pdf' | 'md' | 'txt';
  origin: 'corpus' | 'upload';
  chunks: number;
  createdAt: string;
  licence?: string;
  licenceUrl?: string;
  attribution?: string;
  sourceUrl?: string;
};

const uploadCollection = (sessionId?: string) => (sessionId ? `upload:${sessionId}` : null);

export const listDocuments = async (db: Db, sessionId?: string): Promise<DocumentView[]> =>
  (
    await db.query<{ id: string; collection: string; filename: string; kind: DocumentView['kind']; created_at: string; chunks: number }>(
      `select d.id::text as id, d.collection, d.filename, d.kind, d.created_at::text as created_at,
              (select count(*) from chunks c where c.document_id = d.id)::int as chunks
       from documents d
       where d.collection = 'corpus' or d.collection = $1
       order by d.collection <> 'corpus', d.filename`,
      [uploadCollection(sessionId)],
    )
  ).map(({ id, collection, filename, kind, created_at, chunks }) => {
    const entry = byFilename.get(filename);
    return collection === 'corpus' && entry
      ? { id, filename, title: entry.title, kind, origin: 'corpus', chunks, createdAt: created_at, licence: entry.licence, licenceUrl: entry.licenceUrl, attribution: entry.attribution, sourceUrl: entry.sourceUrl }
      : { id, filename, title: filename, kind, origin: collection === 'corpus' ? 'corpus' : 'upload', chunks, createdAt: created_at };
  });

export const deleteExpiredUploads = async (db: Db, now: Date) =>
  (await db.query("delete from documents where collection like 'upload:%' and created_at <= $1::timestamptz - interval '24 hours' returning id", [now.toISOString()])).length;

export const deleteUpload = async (db: Db, sessionId: string, id: string) =>
  (await db.query('delete from documents where id = $1::uuid and collection = $2 returning id', [id, `upload:${sessionId}`])).length > 0;
