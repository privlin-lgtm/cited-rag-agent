import type { ReactNode } from 'react';

const LIST_ITEM = /^\s*(?:[-*•]|\d+[.)])\s+/;

const bold = (text: string): ReactNode[] =>
  text.split(/(\*\*[^*]+\*\*)/g).map((part, i) => (part.startsWith('**') && part.endsWith('**') && part.length > 4 ? <strong key={i}>{part.slice(2, -2)}</strong> : part));

export const Prose = ({ pieces, className }: { pieces: ReactNode[]; className?: string }) => {
  const lines: ReactNode[][] = [[]];
  for (const piece of pieces) {
    if (typeof piece !== 'string') lines[lines.length - 1].push(piece);
    else
      piece.split('\n').forEach((part, i) => {
        if (i > 0) lines.push([]);
        if (part) lines[lines.length - 1].push(part);
      });
  }
  const content = lines.filter((line) => line.length);
  const out: ReactNode[] = [];
  let items: ReactNode[][] = [];
  const flush = () => {
    if (items.length)
      out.push(
        <ul key={`ul-${out.length}`} className="my-2 list-disc space-y-1 pl-5">
          {items.map((item, i) => (
            <li key={i}>{item}</li>
          ))}
        </ul>,
      );
    items = [];
  };
  content.forEach((line) => {
    const first = line[0];
    const isItem = typeof first === 'string' && LIST_ITEM.test(first);
    const rendered = line.map((piece, i) => (typeof piece === 'string' ? <span key={i}>{bold(i === 0 && isItem ? piece.replace(LIST_ITEM, '') : piece)}</span> : <span key={i}>{piece}</span>));
    if (isItem) items.push(rendered);
    else {
      flush();
      out.push(
        <p key={`p-${out.length}`} className="my-2 first:mt-0 last:mb-0">
          {rendered}
        </p>,
      );
    }
  });
  flush();
  return <div className={className}>{out}</div>;
};
