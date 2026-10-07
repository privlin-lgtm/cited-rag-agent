const ABBREVIATION = /(?:U\.S\.C\.|C\.F\.R\.|U\.S\.|e\.g\.|i\.e\.|etc\.|No\.|Art\.|para\.|Inc\.|Ltd\.|§)$/;
const BARE_NUMBER = /^\(?\d+\.$/;
const LIST_MARKER = /^(?:[-*•●▪–]\s|\d{1,3}[.)](?:\s|$)|\((?:[a-z]{1,3}|\d{1,3})\)\s|[a-z]\)\s)/;
const TABLE_ROW = /\s\|\s|^\||\|$|\S(?: {2,}|\t)\S.*(?: {2,}|\t)\S/;
const MAX_WORDS = 80;
const SLICE_WORDS = 60;

const segmenter = new Intl.Segmenter('en', { granularity: 'sentence' });

const words = (text: string) => text.split(/\s+/).filter(Boolean);
const collapse = (text: string) => text.replace(/\s+/g, ' ').trim();

const sentences = (text: string) => {
  const out: string[] = [];
  let current = '';
  for (const { segment } of segmenter.segment(text)) {
    if (current && /\s$/.test(current) && !ABBREVIATION.test(current.trimEnd()) && !BARE_NUMBER.test(current.trim())) {
      out.push(current);
      current = segment;
    } else current += segment;
  }
  return [...out, current].map(collapse).filter(Boolean);
};

const shorten = (block: string) =>
  words(block).length <= MAX_WORDS
    ? [block]
    : block.split(/(?<=[;:])\s+/).flatMap((piece) => {
        const pieceWords = words(piece);
        return pieceWords.length <= MAX_WORDS
          ? [piece]
          : Array.from({ length: Math.ceil(pieceWords.length / SLICE_WORDS) }, (_, i) =>
              pieceWords.slice(i * SLICE_WORDS, (i + 1) * SLICE_WORDS).join(' '),
            );
      });

export const splitSentences = (text: string): string[] =>
  text.split(/\n\s*\n/).flatMap((paragraph) => {
    const groups: { text: string; row: boolean }[] = [];
    for (const line of paragraph.split('\n').map((raw) => raw.trim()).filter(Boolean)) {
      const row = TABLE_ROW.test(line);
      const last = groups[groups.length - 1];
      if (!last || row || last.row || LIST_MARKER.test(line)) groups.push({ text: line, row });
      else last.text += ` ${line}`;
    }
    return groups.flatMap(({ text: group, row }) => (row ? [collapse(group)] : sentences(group))).flatMap(shorten);
  });
