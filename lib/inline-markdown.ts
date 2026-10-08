export type Inline = { kind: 'text' | 'bold' | 'code' | 'br'; text: string };

const TOKEN = /\*\*([^*]+)\*\*|`([^`]+)`|\[([^\]]*)\]\([^)]*\)|<br\s*\/?>/gi;
const HEADING = /^\s*#{1,6}\s+/;

const parse = (source: string): Inline[] => {
  const parts: Inline[] = [];
  const push = (part: Inline) => {
    const last = parts[parts.length - 1];
    if (last?.kind === 'text' && part.kind === 'text') last.text += part.text;
    else parts.push(part);
  };
  let end = 0;
  for (const match of source.matchAll(TOKEN)) {
    const [whole, bold, code, link] = match;
    if (match.index > end) push({ kind: 'text', text: source.slice(end, match.index) });
    if (bold !== undefined) for (const part of parse(bold)) push(part.kind === 'text' ? { kind: 'bold', text: part.text } : part);
    else if (code !== undefined) push({ kind: 'code', text: code });
    else if (link !== undefined) push({ kind: 'text', text: link });
    else push({ kind: 'br', text: '' });
    end = match.index + whole.length;
  }
  if (end < source.length) push({ kind: 'text', text: source.slice(end) });
  return parts;
};

export const inlineMarkdown = (block: string) => parse(block.replace(HEADING, ''));
