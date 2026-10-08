import type { Db } from './db';
import type { Embedder } from './embed';
import { ingestDocument } from './ingest';
import { extract, type Kind } from './ingest/extract';

export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
export const MAX_UPLOAD_PAGES = 40;
export const MAX_UPLOAD_TOKENS = 100_000;
const KINDS: Record<string, Kind> = { md: 'md', pdf: 'pdf', txt: 'txt' };

export class UploadError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export const uploadFilename = (name: string) => {
  const base = name.split(/[\\/]/).pop()?.trim() ?? '';
  if (!/^[\w][\w .()-]{0,118}\.(?:md|pdf|txt)$/i.test(base)) throw new UploadError('The file name must be 1 to 120 characters of letters, digits, spaces, dots, dashes or brackets, ending in .md, .pdf or .txt.', 400);
  return base;
};

export const prepareUpload = async (name: string, data: Uint8Array) => {
  const filename = uploadFilename(name);
  const kind = KINDS[filename.slice(filename.lastIndexOf('.') + 1).toLowerCase()];
  if (data.length === 0) throw new UploadError('The file is empty.', 400);
  if (data.length > MAX_UPLOAD_BYTES) throw new UploadError('The file is larger than 4 MB.', 413);
  if (kind === 'pdf') {
    const { pages, parts } = await extract('pdf', data);
    if ((pages ?? 0) > MAX_UPLOAD_PAGES) throw new UploadError(`The PDF has ${pages} pages; the limit is ${MAX_UPLOAD_PAGES}.`, 413);
    if (!parts.length) throw new UploadError('The PDF has no text. It may be scanned; OCR is out of scope.', 422);
  }
  return { filename, kind };
};

export const ingestUpload = async (db: Db, embed: Embedder, sessionId: string, name: string, data: Uint8Array, withinBudget?: (estimatedTokens: number) => Promise<void>) => {
  const { filename, kind } = await prepareUpload(name, data);
  const report = await ingestDocument(db, embed, {
    collection: `upload:${sessionId}`,
    filename,
    kind,
    data,
    beforeEmbed: async (estimatedTokens) => {
      if (estimatedTokens > MAX_UPLOAD_TOKENS)
        throw new UploadError(
          `The file is about ${estimatedTokens.toLocaleString('en-US')} tokens (characters / 4); the limit is ${MAX_UPLOAD_TOKENS.toLocaleString('en-US')} tokens.`,
          413,
        );
      await withinBudget?.(estimatedTokens);
    },
  });
  const [{ id }] = await db.query<{ id: string }>('select id::text as id from documents where collection = $1 and filename = $2', [`upload:${sessionId}`, filename]);
  return { id, filename, kind, report };
};
