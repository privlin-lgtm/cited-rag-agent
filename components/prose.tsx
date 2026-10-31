import type { ReactNode } from 'react';
import { cn } from '../lib/utils';

const LIST_ITEM = /^\s*(?:[-*•]|\d+[.)])\s+/;
const HEADING = /^#{1,6} +/;
const TABLE_ROW = /^\|.*\|$/;
const SEPARATOR = /^[\s|:-]+$/;

const bold = (text: string): ReactNode[] =>
  text.split(/(\*\*[^*]+\*\*)/g).map((part, i) => (part.startsWith('**') && part.endsWith('**') && part.length > 4 ? <strong key={i}>{part.slice(2, -2)}</strong> : part));

const render = (line: ReactNode[]) => line.map((piece, i) => <span key={i}>{typeof piece === 'string' ? bold(piece) : piece}</span>);

const textOf = (line: ReactNode[]) => line.filter((piece) => typeof piece === 'string').join('');

const strip = (line: ReactNode[], pattern: RegExp) => [(line[0] as string).replace(pattern, ''), ...line.slice(1)];

const cells = (row: ReactNode[]) => {
  const out: ReactNode[][] = [[]];
  for (const piece of row)
    if (typeof piece !== 'string') out[out.length - 1].push(piece);
    else
      piece.split('|').forEach((part, i) => {
        if (i > 0) out.push([]);
        if (part.trim()) out[out.length - 1].push(part);
      });
  const [before, ...inner] = out;
  const after = inner.pop() ?? [];
  inner[0]?.unshift(...before);
  inner.at(-1)?.push(...after);
  return inner;
};

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
  let rows: ReactNode[][] = [];
  const paragraph = (line: ReactNode[], heading = false) =>
    out.push(
      <p key={`p-${out.length}`} className={cn('my-2 first:mt-0 last:mb-0', heading && 'font-semibold')}>
        {render(line)}
      </p>,
    );
  const flush = () => {
    if (items.length)
      out.push(
        <ul key={`ul-${out.length}`} className="my-2 list-disc space-y-1 pl-5">
          {items.map((item, i) => (
            <li key={i}>{render(item)}</li>
          ))}
        </ul>,
      );
    items = [];
  };
  const flushRows = () => {
    if (rows.length === 1) paragraph(rows[0]);
    if (rows.length > 1) {
      const header = SEPARATOR.test(textOf(rows[1])) ? rows[0] : undefined;
      out.push(
        <div key={`table-${out.length}`} className="my-2 overflow-x-auto">
          <table className="border-collapse text-sm">
            {header && (
              <thead>
                <tr>
                  {cells(header).map((cell, i) => (
                    <th key={i} className="border border-zinc-300 px-2 py-1 text-left font-semibold dark:border-zinc-700">
                      {render(cell)}
                    </th>
                  ))}
                </tr>
              </thead>
            )}
            <tbody>
              {(header ? rows.slice(2) : rows).map((row, i) => (
                <tr key={i}>
                  {cells(row).map((cell, j) => (
                    <td key={j} className="border border-zinc-300 px-2 py-1 align-top dark:border-zinc-700">
                      {render(cell)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
    }
    rows = [];
  };
  content.forEach((line) => {
    const first = line[0];
    const isItem = typeof first === 'string' && LIST_ITEM.test(first);
    const isRow = TABLE_ROW.test(textOf(line).trim());
    if (!isRow) flushRows();
    if (!isItem) flush();
    if (isRow) rows.push(line);
    else if (isItem) items.push(strip(line, LIST_ITEM));
    else if (typeof first === 'string' && HEADING.test(first)) paragraph(strip(line, HEADING), true);
    else paragraph(line);
  });
  flushRows();
  flush();
  return <div className={className}>{out}</div>;
};
