import { readFile } from 'node:fs/promises';
import { z } from 'zod';

export const questionsSchema = z.array(
  z.object({
    id: z.string().regex(/^[a-z0-9-]+$/),
    question: z.string().min(1),
    expected: z.array(z.object({ filename: z.string().min(1), locator: z.string().min(1) })).min(1),
  }),
);

export type Question = z.infer<typeof questionsSchema>[number];
export type Pair = Question['expected'][number];

export const loadQuestions = async () =>
  questionsSchema.parse(JSON.parse(await readFile(new URL('../evals/questions.json', import.meta.url), 'utf8')));

const lineRange = (locator: string) => {
  const match = /^lines (\d+)–(\d+)$/.exec(locator);
  return match ? [Number(match[1]), Number(match[2])] : null;
};

const locatorMatches = (found: string, expected: string) => {
  const [a, b] = [lineRange(found), lineRange(expected)];
  if (a || b) return !!a && !!b && a[0] <= b[1] && b[0] <= a[1];
  return found === expected || (expected.startsWith('§ ') && found.startsWith(`${expected} › `));
};

export const pairMatches = (found: Pair, expected: Pair) => found.filename === expected.filename && locatorMatches(found.locator, expected.locator);

export const firstMatchRank = (found: Pair[], expected: Pair[]) => {
  const index = found.findIndex((hit) => expected.some((pair) => pairMatches(hit, pair)));
  return index < 0 ? null : index + 1;
};

export const scoreRanks = (ranks: (number | null)[]) => {
  const within = (k: number) => ranks.filter((rank) => rank !== null && rank <= k).length;
  return {
    total: ranks.length,
    hit1: within(1),
    hit3: within(3),
    hit5: within(5),
    mrr: ranks.reduce<number>((sum, rank) => sum + (rank ? 1 / rank : 0), 0) / ranks.length,
  };
};
