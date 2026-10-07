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

const pdfParagraphs = (page: string): Paragraph[] => {
  const groups: { text: string[]; first: number }[] = [];
  clean(page)
    .split('\n')
    .map((line) => line.trim())
    .forEach((line, i, all) => {
      if (!line) return;
      const previous = all.slice(0, i).findLast(Boolean);
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
    return {
      pages: totalPages,
      parts: text.map((page, i) => ({ locator: `p. ${i + 1}`, paragraphs: pdfParagraphs(page) })).filter(({ paragraphs }) => paragraphs.length),
    };
  }
  const source = clean(new TextDecoder().decode(data));
  return {
    pages: null,
    parts: kind === 'md' ? markdownParts(source) : [{ locator: null, paragraphs: blocks(source.split('\n')) }],
  };
};
