import { beforeAll, describe, expect, it } from 'vitest';
import { loadManifest, readCorpusFile } from './corpus';
import { firstMatchRank, loadQuestions, pairMatches, scoreRanks, type Pair, type Question } from './evals';
import { chunkParts } from './ingest/chunk';
import { extract } from './ingest/extract';

const GUIDE = 'cfpb_remittance-transfers_small-entity-compliance-guide.pdf';
const pair = (filename: string, locator: string): Pair => ({ filename, locator });

describe('matching rules', () => {
  it('matches a PDF page exactly', () => {
    expect(pairMatches(pair('a.pdf', 'p. 10'), pair('a.pdf', 'p. 10'))).toBe(true);
    expect(pairMatches(pair('a.pdf', 'p. 100'), pair('a.pdf', 'p. 10'))).toBe(false);
    expect(pairMatches(pair('a.pdf', 'p. 1'), pair('a.pdf', 'p. 10'))).toBe(false);
    expect(pairMatches(pair('b.pdf', 'p. 10'), pair('a.pdf', 'p. 10'))).toBe(false);
  });

  it('matches a Markdown heading path that equals the expected one or sits under it', () => {
    const expected = pair('a.md', '§ A › B');
    expect(pairMatches(pair('a.md', '§ A › B'), expected)).toBe(true);
    expect(pairMatches(pair('a.md', '§ A › B › C › D'), expected)).toBe(true);
    expect(pairMatches(pair('a.md', '§ A › BC'), expected)).toBe(false);
    expect(pairMatches(pair('a.md', '§ A'), expected)).toBe(false);
    expect(pairMatches(pair('b.md', '§ A › B'), expected)).toBe(false);
  });

  it('matches a text chunk whose line range overlaps the expected range', () => {
    const expected = pair('a.txt', 'lines 21–33');
    expect(pairMatches(pair('a.txt', 'lines 21–33'), expected)).toBe(true);
    expect(pairMatches(pair('a.txt', 'lines 33–45'), expected)).toBe(true);
    expect(pairMatches(pair('a.txt', 'lines 5–21'), expected)).toBe(true);
    expect(pairMatches(pair('a.txt', 'lines 25–26'), expected)).toBe(true);
    expect(pairMatches(pair('a.txt', 'lines 1–20'), expected)).toBe(false);
    expect(pairMatches(pair('a.txt', 'lines 34–50'), expected)).toBe(false);
    expect(pairMatches(pair('a.txt', 'p. 25'), expected)).toBe(false);
  });
});

describe('rank and score arithmetic', () => {
  it('ranks the first matching hit from 1, or null for a miss', () => {
    const hits = [pair('a.pdf', 'p. 1'), pair('a.pdf', 'p. 2'), pair('a.pdf', 'p. 3')];
    expect(firstMatchRank(hits, [pair('a.pdf', 'p. 3'), pair('a.pdf', 'p. 2')])).toBe(2);
    expect(firstMatchRank(hits, [pair('a.pdf', 'p. 9')])).toBeNull();
  });

  it('counts hits at 1, 3 and 5 and averages reciprocal ranks, with a miss as 0', () => {
    expect(scoreRanks([1, 3, null, 5, 10])).toEqual({ total: 5, hit1: 1, hit3: 2, hit5: 3, mrr: (1 + 1 / 3 + 0 + 1 / 5 + 1 / 10) / 5 });
  });
});

describe('the committed question set', () => {
  const kinds = new Map<string, string>();
  const locators = new Map<string, string[]>();
  let questions: Question[];

  beforeAll(async () => {
    questions = await loadQuestions();
    for (const { filename, kind } of (await loadManifest()).documents) {
      kinds.set(filename, kind);
      locators.set(
        filename,
        chunkParts((await extract(kind, new Uint8Array(await readCorpusFile(filename)))).parts).map(({ locator }) => locator),
      );
    }
  }, 120_000);

  it('holds 12 to 15 questions with unique ids', () => {
    expect(questions.length).toBeGreaterThanOrEqual(12);
    expect(questions.length).toBeLessThanOrEqual(15);
    expect(new Set(questions.map(({ id }) => id)).size).toBe(questions.length);
  });

  it('asks the three M2 questions word for word', () => {
    const asked = questions.map(({ question }) => question);
    for (const text of [
      'How long does a sender have to cancel a remittance transfer?',
      'What is strong customer authentication?',
      'What are the phases of a Mojaloop transfer?',
    ])
      expect(asked).toContain(text);
  });

  it('expects at least one passage from every document in the corpus', () => {
    const expected = new Set(questions.flatMap((question) => question.expected.map(({ filename }) => filename)));
    expect([...locators.keys()].filter((filename) => !expected.has(filename))).toEqual([]);
  });

  it('has questions answered only by the p. 17 and p. 24 tables of the CFPB guide', () => {
    const only = (locator: string) => questions.some(({ expected }) => expected.every((entry) => entry.filename === GUIDE && entry.locator === locator));
    expect(only('p. 17')).toBe(true);
    expect(only('p. 24')).toBe(true);
  });

  it('names no expected pair that matches no chunk of the ingested corpus', () => {
    const missing = questions.flatMap(({ id, expected }) =>
      expected
        .filter((entry) => !(locators.get(entry.filename) ?? []).some((locator) => pairMatches({ filename: entry.filename, locator }, entry)))
        .map((entry) => `${id}: ${entry.filename} · ${entry.locator}`),
    );
    expect(missing).toEqual([]);
  });

  it('never expects a Markdown heading path so broad that it matches every chunk of its document', () => {
    for (const { expected } of questions)
      for (const entry of expected)
        if (kinds.get(entry.filename) === 'md') {
          const all = locators.get(entry.filename)!;
          expect(all.filter((locator) => pairMatches({ filename: entry.filename, locator }, entry)).length, entry.locator).toBeLessThan(all.length);
        }
  });
});
