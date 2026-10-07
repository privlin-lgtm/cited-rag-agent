import type { Paragraph, Part } from './extract';

export const TARGET_TOKENS = 400;
export const MAX_TOKENS = 600;
export const OVERLAP_TOKENS = 80;

export type Chunk = { locator: string; content: string };

export const estimateTokens = (text: string) => Math.ceil(text.length / 4);

const SEPARATORS: [RegExp, string][] = [
  [/(?<=[.!?])\s+/, ' '],
  [/\n/, '\n'],
  [/\s+/, ' '],
];

const split = (text: string, limit: number): string[] => {
  if (estimateTokens(text) <= limit) return [text];
  const found = SEPARATORS.find(([pattern]) => pattern.test(text));
  if (!found) return text.match(new RegExp(`[\\s\\S]{1,${limit * 4}}`, 'g')) ?? [];
  const [pattern, joiner] = found;
  const out: string[] = [];
  let current = '';
  for (const piece of text.split(pattern).filter(Boolean).flatMap((part) => split(part, limit))) {
    if (current && estimateTokens(current + joiner + piece) > limit) {
      out.push(current);
      current = piece;
    } else current = current ? current + joiner + piece : piece;
  }
  return current ? [...out, current] : out;
};

const overlapOf = (paragraph: string) => {
  if (estimateTokens(paragraph) <= OVERLAP_TOKENS) return paragraph;
  let tail = '';
  for (const sentence of paragraph.split(/(?<=[.!?])\s+/).reverse()) {
    const next = tail ? `${sentence} ${tail}` : sentence;
    if (estimateTokens(next) > OVERLAP_TOKENS) break;
    tail = next;
  }
  return tail;
};

export const chunkParts = (parts: Part[]): Chunk[] =>
  parts.flatMap((part) => {
    const paragraphs = part.paragraphs.flatMap((paragraph) =>
      estimateTokens(paragraph.text) > MAX_TOKENS ? split(paragraph.text, TARGET_TOKENS).map((text) => ({ text, lines: paragraph.lines })) : [paragraph],
    );
    const chunks: Chunk[] = [];
    let items: Paragraph[] = [];
    let size = 0;
    let carry = '';
    let carryStart = 0;
    const flush = () => {
      if (!items.length) return;
      const overlap = carry && estimateTokens(carry) + size + 1 <= MAX_TOKENS ? carry : '';
      const last = items[items.length - 1];
      const first = overlap ? carryStart : items[0].lines[0];
      chunks.push({
        locator: part.locator ?? `lines ${first}–${last.lines[1]}`,
        content: [overlap, ...items.map(({ text }) => text)].filter(Boolean).join('\n\n'),
      });
      carry = overlapOf(last.text);
      carryStart = last.lines[0];
      items = [];
      size = 0;
    };
    for (const paragraph of paragraphs) {
      const tokens = estimateTokens(paragraph.text);
      if (items.length && size + tokens > TARGET_TOKENS) flush();
      items.push(paragraph);
      size += tokens;
    }
    flush();
    return chunks;
  });
