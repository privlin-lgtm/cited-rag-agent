import { extractText } from 'unpdf';

export type Kind = 'pdf' | 'md' | 'txt';
export type Paragraph = { text: string; lines: [number, number] };
export type Part = { locator: string | null; paragraphs: Paragraph[] };
export type Extracted = { pages: number | null; parts: Part[] };

const SENTENCE_END = /[.!?:;]["”')\]]*$/;
const PARAGRAPH_START = /^(?:[A-Z0-9•●▪"“(]|[-–]\s)/;
const MARKER = /^(?:[•●▪]|[-–]\s|\d{1,3}[.)]\s|\(?[a-z0-9]{1,3}\)\s)/;
const FENCE = /^\s*(?:```|~~~)/;
const HEADING = /^#{1,6}\s/;
const IMAGE_ONLY = /^\s*(?:\[\s*)?!\[[^\]]*\]\([^)]*\)(?:\s*\]\([^)]*\))?\s*$/;
const EDGE_LINES = 3;
const FRONT_MATTER = /^---\n(?:[A-Za-z_][\w-]*:.*\n|[ \t].*\n|-\s.*\n|\n)*?---\n/;

const clean = (text: string) => text.replaceAll('\0', '').replace(/\r\n?/g, '\n');

const blocks = (lines: string[], fenceAware = false): Paragraph[] => {
  const out: Paragraph[] = [];
  let start = -1;
  let fenced = false;
  const close = (end: number) => {
    if (start >= 0) out.push({ text: lines.slice(start, end).map((line) => line.trimEnd()).join('\n').trim(), lines: [start + 1, end] });
    start = -1;
  };
  lines.forEach((line, i) => {
    if (fenceAware && FENCE.test(line)) fenced = !fenced;
    if (!fenced && !line.trim()) close(i);
    else if (start < 0) start = i;
  });
  close(lines.length);
  return out.filter(({ text }) => text);
};

const normalizeLine = (line: string) => line.replace(/\s+/g, ' ').replace(/\d+/g, '#');
const isEdge = (i: number, count: number) => i < EDGE_LINES || i >= count - EDGE_LINES;

const runningLines = (pages: string[][]) => {
  const counts = new Map<string, number>();
  for (const lines of pages)
    for (const line of new Set(lines.filter((_, i) => isEdge(i, lines.length)).map(normalizeLine))) counts.set(line, (counts.get(line) ?? 0) + 1);
  const threshold = Math.max(3, Math.ceil(pages.length / 3));
  return new Set([...counts].filter(([, count]) => count >= threshold).map(([line]) => line));
};

const pdfParagraphs = (lines: string[]): Paragraph[] => {
  const groups: { text: string[]; first: number }[] = [];
  lines.forEach((line, i) => {
    const previous = lines[i - 1];
    if (!previous || (SENTENCE_END.test(previous) && PARAGRAPH_START.test(line)) || MARKER.test(line)) groups.push({ text: [line], first: i + 1 });
    else groups[groups.length - 1].text.push(line);
  });
  return groups.map(({ text, first }) => ({ text: text.join('\n'), lines: [first, first + text.length - 1] }));
};

const headingText = (raw: string) => raw.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/[`*_]/g, '').trim();

const markdownParts = (source: string): Part[] => {
  const path: string[] = [];
  const parts: Part[] = [];
  let buffer: string[] = [];
  let fenced = false;
  const flush = () => {
    const paragraphs = blocks(buffer, true);
    if (paragraphs.length) parts.push({ locator: `§ ${path.filter(Boolean).join(' › ') || 'Preamble'}`, paragraphs });
    buffer = [];
  };
  for (const line of source.replace(FRONT_MATTER, '').split('\n')) {
    if (FENCE.test(line)) fenced = !fenced;
    if (!fenced && IMAGE_ONLY.test(line)) continue;
    const heading = !fenced && /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (heading) {
      if (buffer.some((previous) => previous.trim() && !HEADING.test(previous))) flush();
      path.length = heading[1].length - 1;
      path[heading[1].length - 1] = headingText(heading[2]);
    }
    buffer.push(line);
  }
  flush();
  return parts;
};

export const extract = async (kind: Kind, data: Uint8Array): Promise<Extracted> => {
  if (kind === 'pdf') {
    const { totalPages, text } = await extractText(new Uint8Array(data), { mergePages: false });
    const pages = text.map((page) => clean(page).split('\n').map((line) => line.trim()).filter(Boolean));
    const running = runningLines(pages);
    return {
      pages: totalPages,
      parts: pages
        .map((lines, i) => ({
          locator: `p. ${i + 1}`,
          paragraphs: pdfParagraphs(lines.filter((line) => !running.has(normalizeLine(line)))),
        }))
        .filter(({ paragraphs }) => paragraphs.length),
    };
  }
  const source = clean(new TextDecoder().decode(data));
  return {
    pages: null,
    parts: kind === 'md' ? markdownParts(source) : [{ locator: null, paragraphs: blocks(source.split('\n')) }],
  };
};
