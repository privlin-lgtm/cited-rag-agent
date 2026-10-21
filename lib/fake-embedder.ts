import { EMBEDDING_DIMENSIONS, type Embedder } from './embed';

const bucket = (word: string) => {
  let hash = 2166136261;
  for (const char of word) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0;
  return hash % EMBEDDING_DIMENSIONS;
};

export const fakeVector = (text: string) => {
  const vector = new Array<number>(EMBEDDING_DIMENSIONS).fill(0);
  for (const word of text.toLowerCase().match(/[a-z0-9]+/g) ?? []) vector[bucket(word)] += 1;
  const norm = Math.hypot(...vector) || 1;
  return vector.map((value) => value / norm);
};

export const fakeEmbedder: Embedder = async (texts, _inputType, onBatch) => {
  const tokens = texts.reduce((sum, text) => sum + Math.ceil(text.length / 4), 0);
  await onBatch?.(tokens);
  return { embeddings: texts.map(fakeVector), tokens };
};
