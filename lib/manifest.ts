import { z } from 'zod';

const sha256 = z.string().regex(/^[0-9a-f]{64}$/);
const filename = z.string().regex(/^(?!.*\.\.)[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/);

export const manifestSchema = z.object({
  documents: z
    .array(
      z.object({
        id: z.string().regex(/^[a-z0-9-]+$/),
        title: z.string().min(1),
        filename,
        kind: z.enum(['pdf', 'md', 'txt']),
        sourceUrl: z.url(),
        licence: z.string().min(1),
        licenceUrl: z.url().optional(),
        attribution: z.string().min(1),
        sha256,
        note: z.string().min(1).optional(),
      }),
    )
    .min(1),
  licenceFiles: z.array(z.object({ filename, sourceUrl: z.url(), sha256 })),
});

export type Manifest = z.infer<typeof manifestSchema>;
export type ManifestDocument = Manifest['documents'][number];
