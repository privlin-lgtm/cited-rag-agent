import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { inlineMarkdown } from './inline-markdown';

const folder = new URL('../corpus/files/mojaloop/', import.meta.url);
const lines = readFileSync(new URL('generic-transaction-patterns.md', folder), 'utf8').split('\n');

const line = (start: string) => {
  const found = lines.find((candidate) => candidate.trimStart().startsWith(start));
  if (!found) throw new Error(`no line starts with ${start}`);
  return found;
};

const plain = (block: string) =>
  inlineMarkdown(block)
    .map(({ kind, text }) => (kind === 'br' ? '\n' : text))
    .join('');

describe('inlineMarkdown on lines of the Mojaloop generic transaction patterns', () => {
  it('renders **bold** as a bold part and [text](#anchor) as its text', () => {
    const parts = inlineMarkdown(line('**Note:**'));
    expect(parts).toHaveLength(2);
    expect(parts[0]).toEqual({ kind: 'bold', text: 'Note:' });
    expect(parts[1].text).toContain('(and therefore may not appear in) the generic transaction patterns identified in Generic Transaction Patterns.');
    expect(parts[1].text).not.toContain('](');
  });

  it('renders `code` as a code part', () => {
    const parts = inlineMarkdown(line('The logical API service request `Lookup Participant Information`'));
    expect(parts.map(({ kind }) => kind)).toEqual(['text', 'code', 'text']);
    expect(parts[1].text).toBe('Lookup Participant Information');
  });

  it('renders `code` inside **bold**', () => {
    expect(inlineMarkdown(line('**Loop for each `Payee FSP` to Calculate')).filter(({ text }) => text.trim())).toEqual([
      { kind: 'bold', text: 'Loop for each ' },
      { kind: 'code', text: 'Payee FSP' },
      { kind: 'bold', text: ' to Calculate Bulk Quote' },
    ]);
  });

  it('turns every link in a line into its text', () => {
    const text = plain(line('The logical API service response `Return Participant Information`'));
    expect(text).toContain('from the requests Lookup Participant Information, Create Participant Information and Delete Participant Information.');
    expect(text).not.toContain('(#');
    expect(plain('- [Logical Data Model](#)')).toBe('- Logical Data Model');
  });

  it.each(['### Conventions Used in This Document', '#### Logical Documents', '## Logical API Services'])('drops the heading marker of %s', (heading) => {
    expect(plain(line(heading)).trimEnd()).toBe(heading.replace(/^#+\s+/, ''));
  });

  it('keeps a # that is not a heading marker at the start of the block', () => {
    expect(plain('Resource #12 is listed under ## Logical API Services.')).toBe('Resource #12 is listed under ## Logical API Services.');
  });

  it('turns <br /> and <br/> into line breaks', () => {
    expect(inlineMarkdown(line('<br />'))).toEqual([{ kind: 'br', text: '' }]);
    expect(inlineMarkdown('End of the table. <br /> Next section. <br/> After.').map(({ kind }) => kind)).toEqual(['text', 'br', 'text', 'br', 'text']);
  });

  it('renders bold inside a table row and keeps its pipes', () => {
    expect(inlineMarkdown(line('|**Elements of the API'))).toEqual([
      { kind: 'text', text: '|' },
      { kind: 'bold', text: 'Elements of the API, such as resources' },
      { kind: 'text', text: '|Boldface|' },
      { kind: 'bold', text: '/authorization' },
      { kind: 'text', text: '|' },
    ]);
  });

  it('returns text it does not recognise unchanged', () => {
    expect(inlineMarkdown('Variables are _{ID}_ in italics, and 2 * 3 * 4 stays.')).toEqual([{ kind: 'text', text: 'Variables are _{ID}_ in italics, and 2 * 3 * 4 stays.' }]);
    expect(inlineMarkdown('')).toEqual([]);
  });
});

describe('inlineMarkdown on every line of the Mojaloop documents', () => {
  const files = readdirSync(folder).filter((name) => name.endsWith('.md') && name !== 'LICENSE.md');

  it.each(files)('leaves no bold, code, link, heading or <br> syntax in %s', (name) => {
    const leftovers = readFileSync(new URL(name, folder), 'utf8')
      .split('\n')
      .filter((candidate) => !candidate.trimStart().startsWith('```'))
      .map((candidate) => plain(candidate))
      .filter((rendered) => /\*\*[^*]+\*\*|`[^`]+`|\]\(|<br\s*\/?>|^\s*#{1,6}\s/i.test(rendered));
    expect(leftovers).toEqual([]);
  });
});
