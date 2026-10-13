import { appendFileSync, existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import { loadManifest } from '../lib/corpus';
import { postgresDb, type Db } from '../lib/db';
import { createEmbedder, type Embedder } from '../lib/embed';
import { firstMatchRank, loadQuestions, scoreRanks, type Question } from '../lib/evals';
import { INGEST_VERSION } from '../lib/ingest';
import { semanticSearch, type Hit } from '../lib/search';

const K = 10;
const thresholdUrl = new URL('../evals/threshold.json', import.meta.url);

const thresholdSchema = z.object({
  hitAt5: z.number().int().nonnegative(),
  of: z.number().int().positive(),
  date: z.string().min(1),
  commit: z.string().min(1),
});

export type Threshold = z.infer<typeof thresholdSchema>;
export type EvalRow = { id: string; question: string; rank: number | null; top: Hit[] };
export type EvalReport = { rows: EvalRow[]; score: ReturnType<typeof scoreRanks>; tokens: number };
export type CorpusState = Awaited<ReturnType<typeof corpusState>>;

export const loadThreshold = async () => (existsSync(thresholdUrl) ? thresholdSchema.parse(JSON.parse(await readFile(thresholdUrl, 'utf8'))) : null);

export const corpusState = (db: Db) =>
  db.query<{ id: string; filename: string; sha256: string; ingest_version: number }>(
    "select id::text as id, filename, sha256, ingest_version from documents where collection = 'corpus' order by filename",
  );

export const assertFresh = (state: CorpusState, documents: { filename: string; sha256: string }[]) => {
  const byName = new Map(state.map((row) => [row.filename, row]));
  const problems = documents.flatMap(({ filename, sha256 }) => {
    const row = byName.get(filename);
    if (!row) return [`${filename}: not in the database`];
    return [
      ...(row.ingest_version === INGEST_VERSION ? [] : [`${filename}: ingest version ${row.ingest_version}, expected ${INGEST_VERSION}`]),
      ...(row.sha256 === sha256 ? [] : [`${filename}: sha256 ${row.sha256.slice(0, 12)}, manifest has ${sha256.slice(0, 12)}`]),
    ];
  });
  if (problems.length) throw new Error(`The database does not match the manifest at ingest version ${INGEST_VERSION}; run npm run ingest:corpus.\n${problems.join('\n')}`);
};

export const runEval = async (
  db: Db,
  embed: Embedder,
  questions: Question[],
  documents: { filename: string; sha256: string }[],
): Promise<EvalReport> => {
  const state = await corpusState(db);
  assertFresh(state, documents);
  const documentIds = state.map(({ id }) => id);
  const { embeddings, tokens } = await embed(
    questions.map(({ question }) => question),
    'query',
  );
  const rows: EvalRow[] = [];
  for (const [i, { id, question, expected }] of questions.entries()) {
    const hits = await semanticSearch(db, embeddings[i], { k: K, documentIds });
    rows.push({ id, question, rank: firstMatchRank(hits, expected), top: hits.slice(0, 3) });
  }
  return { rows, score: scoreRanks(rows.map(({ rank }) => rank)), tokens };
};

export const verdict = ({ score }: EvalReport, threshold: Threshold | null) => {
  if (!threshold) return { code: 0, text: 'No evals/threshold.json: reporting only.' };
  const pass = score.hit5 * threshold.of >= threshold.hitAt5 * score.total;
  return {
    code: pass ? 0 : 1,
    text: `hit@5 ${score.hit5}/${score.total} ${pass ? 'meets' : 'is below'} the threshold ${threshold.hitAt5}/${threshold.of} (set ${threshold.date} from ${threshold.commit})`,
  };
};

const share = (n: number, total: number) => `${n}/${total} (${((n / total) * 100).toFixed(0)}%)`;
const hitText = ({ filename, locator, score }: Hit) => `${filename} · ${locator} · ${score.toFixed(3)}`;
const metricRows = ({ score, tokens }: EvalReport) => [
  ['hit@1', share(score.hit1, score.total)],
  ['hit@3', share(score.hit3, score.total)],
  ['hit@5', share(score.hit5, score.total)],
  [`MRR (top ${K})`, score.mrr.toFixed(3)],
  ['Voyage tokens', String(tokens)],
];

export const consoleText = (report: EvalReport, { text }: { text: string }) =>
  [
    ...report.rows.flatMap(({ id, rank, top }) => [`${id.padEnd(32)} ${rank === null ? 'miss' : `rank ${rank}`}`, ...top.map((hit, i) => `    ${i + 1}. ${hitText(hit)}`)]),
    '',
    ...metricRows(report).map(([name, value]) => `${name.padEnd(14)} ${value}`),
    text,
  ].join('\n');

export const markdown = (report: EvalReport, { text }: { text: string }) =>
  [
    '### Retrieval eval',
    '',
    '| Metric | Value |',
    '|---|---|',
    ...metricRows(report).map(([name, value]) => `| ${name} | ${value} |`),
    '',
    text,
    '',
    '| Question | First match | Top 3 |',
    '|---|---|---|',
    ...report.rows.map(({ id, rank, top }) => `| ${id} | ${rank ?? 'miss'} | ${top.map((hit) => hitText(hit).replaceAll('|', '\\|')).join('<br>')} |`),
    '',
  ].join('\n');

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const missing = ['DATABASE_URL', 'VOYAGE_API_KEY'].filter((name) => !process.env[name]?.trim());
  if (missing.length) {
    console.error(`${missing.join(' and ')} ${missing.length > 1 ? 'are' : 'is'} missing or empty`);
    process.exit(1);
  }
  const report = await runEval(
    postgresDb(process.env.DATABASE_URL!),
    createEmbedder({ apiKey: process.env.VOYAGE_API_KEY! }),
    await loadQuestions(),
    (await loadManifest()).documents,
  );
  const result = verdict(report, await loadThreshold());
  console.log(consoleText(report, result));
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdown(report, result));
  process.exit(result.code);
}
