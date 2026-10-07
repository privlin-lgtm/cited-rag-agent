import { readFile } from 'node:fs/promises';
import { z } from 'zod';

export const corpusDir = new URL('../corpus/', import.meta.url);

const sha256 = z.string().regex(/^[0-9a-f]{64}$/);

export const manifestSchema = z.object({
  documents: z
    .array(
      z.object({
        id: z.string().regex(/^[a-z0-9-]+$/),
        title: z.string().min(1),
        filename: z.string().min(1),
        kind: z.enum(['pdf', 'md', 'txt']),
        sourceUrl: z.url(),
        licence: z.string().min(1),
        attribution: z.string().min(1),
        sha256,
        note: z.string().min(1).optional(),
      }),
    )
    .min(1),
  licenceFiles: z.array(z.object({ filename: z.string().min(1), sourceUrl: z.url(), sha256 })),
});

export type Manifest = z.infer<typeof manifestSchema>;
export type ManifestDocument = Manifest['documents'][number];

export const loadManifest = async () =>
  manifestSchema.parse(JSON.parse(await readFile(new URL('manifest.json', corpusDir), 'utf8')));

export const readCorpusFile = (filename: string) => readFile(new URL(`files/${filename}`, corpusDir));
