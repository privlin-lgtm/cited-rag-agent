import { readFile } from 'node:fs/promises';
import { manifestSchema } from './manifest';

export { manifestSchema, type Manifest, type ManifestDocument } from './manifest';

export const corpusDir = new URL('../corpus/', import.meta.url);

export const loadManifest = async () =>
  manifestSchema.parse(JSON.parse(await readFile(new URL('manifest.json', corpusDir), 'utf8')));

export const readCorpusFile = (filename: string) => readFile(new URL(`files/${filename}`, corpusDir));
