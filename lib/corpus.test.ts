import { createHash } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { corpusDir, loadManifest, manifestSchema, readCorpusFile } from './corpus';

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

describe('corpus', () => {
  it('has every committed file matching its manifest hash', async () => {
    const { documents, licenceFiles } = await loadManifest();
    for (const { filename, sha256: expected } of [...documents, ...licenceFiles])
      expect(sha256(await readCorpusFile(filename)), filename).toBe(expected);
  });

  it('lists every file under corpus/files in the manifest, and nothing else', async () => {
    const { documents, licenceFiles } = await loadManifest();
    const root = fileURLToPath(new URL('files/', corpusDir));
    const onDisk = (await readdir(root, { recursive: true, withFileTypes: true }))
      .filter((entry) => entry.isFile())
      .map((entry) => relative(root, join(entry.parentPath, entry.name)).replaceAll('\\', '/'))
      .sort();
    expect(onDisk).toEqual([...documents, ...licenceFiles].map(({ filename }) => filename).sort());
  });

  it('rejects manifest filenames that could leave corpus/files', () => {
    const entry = { id: 'a', title: 'A', filename: 'a.pdf', kind: 'pdf', sourceUrl: 'https://example.test/a.pdf', licence: 'L', attribution: 'A', sha256: 'a'.repeat(64) };
    expect(manifestSchema.safeParse({ documents: [entry], licenceFiles: [] }).success).toBe(true);
    for (const filename of ['../a.pdf', 'x/../a.pdf', '/a.pdf', 'a b.pdf', 'a#b.pdf', 'a?.pdf', 'a%2e.pdf'])
      expect(manifestSchema.safeParse({ documents: [{ ...entry, filename }], licenceFiles: [] }).success, filename).toBe(false);
  });

  it('gives every document a unique id and a file extension that matches its kind', async () => {
    const { documents } = await loadManifest();
    expect(new Set(documents.map(({ id }) => id)).size).toBe(documents.length);
    for (const { filename, kind } of documents) expect(filename.endsWith(`.${kind}`), filename).toBe(true);
  });
});
