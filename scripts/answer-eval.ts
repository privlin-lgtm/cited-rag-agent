import Anthropic from '@anthropic-ai/sdk';
import type { Usage } from '@anthropic-ai/sdk/resources/messages';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { z } from 'zod';
import type { CitationCheck, Excerpt } from '../lib/agent/citations';
import { anthropicModel, runAgent, type ModelCall } from '../lib/agent/loop';
import { loadManifest } from '../lib/corpus';
import { postgresDb, type Db } from '../lib/db';
import { createEmbedder, type Embedder } from '../lib/embed';
import { loadQuestions, pairMatches, type Pair, type Question } from '../lib/evals';
import { costUsd, usdPerMTok, type PricedModel } from '../lib/pricing';
import { askCag, cagContext, type Outcome } from './cag';
import { assertFresh, corpusState } from './eval';

export const arms = ['rag', 'cag'] as const;
export type Arm = (typeof arms)[number];
export type ArmDeps = { db: Db; model: ModelCall; modelId: PricedModel; embed: Embedder };

export const askRag = async ({ db, model, modelId, embed }: ArmDeps, scope: string[], question: string): Promise<Outcome> => {
  const started = performance.now();
  const usages: Usage[] = [];
  let toolCalls = 0;
  let ended: Omit<Outcome, 'usages' | 'latencyMs' | 'toolCalls'> = { status: 'error', error: 'the run ended without an answer', answer: '', results: [], excerpts: [] };
  await runAgent({ model, modelId, db, embed, scope, sourceUrlOf: () => null, signal: new AbortController().signal }, question, (event) => {
    if (event.type === 'usage') usages.push(event.anthropic);
    if (event.type === 'step') toolCalls++;
    if (event.type === 'error') ended = { status: 'error', error: event.message, answer: '', results: [], excerpts: event.excerpts };
    if (event.type === 'citations')
      ended = { status: event.status, answer: event.segments.map(({ text }) => text).join(''), results: event.results, excerpts: event.excerpts };
  });
  return { ...ended, usages, toolCalls, latencyMs: Math.round(performance.now() - started) };
};

export type AnswerRow = {
  id: string;
  question: string;
  expected: Pair[];
  status: Outcome['status'];
  error?: string;
  answer: string;
  citations: number;
  passed: number;
  rightSource: boolean;
  cited: { file: string; locator: string; expected: boolean }[];
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsd: number;
  cold: boolean;
  latencyMs: number;
  toolCalls: number;
};

const passingPairs = (results: CitationCheck[], excerpts: Excerpt[]) =>
  results.flatMap((result) => (result.ok ? excerpts.filter(({ n }) => n === result.excerpt).map(({ file, locator }) => ({ filename: file, locator })) : []));

export const scoreOutcome = (modelId: PricedModel, arm: Arm, { id, question, expected }: Question, outcome: Outcome): AnswerRow => {
  const counts = outcome.usages.reduce(
    (sum, usage) => ({
      inputTokens: sum.inputTokens + usage.input_tokens,
      outputTokens: sum.outputTokens + usage.output_tokens,
      cacheReadTokens: sum.cacheReadTokens + (usage.cache_read_input_tokens ?? 0),
      cacheWriteTokens: sum.cacheWriteTokens + (usage.cache_creation_input_tokens ?? 0),
    }),
    { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
  );
  const isExpected = (pair: Pair) => expected.some((want) => pairMatches(pair, want));
  return {
    id,
    question,
    expected,
    status: outcome.status,
    ...(outcome.error ? { error: outcome.error } : {}),
    answer: outcome.answer,
    citations: outcome.results.length,
    passed: outcome.results.filter(({ ok }) => ok).length,
    rightSource: passingPairs(outcome.results, outcome.excerpts).some(isExpected),
    cited: outcome.status === 'error' ? [] : outcome.excerpts.map(({ file, locator }) => ({ file, locator, expected: isExpected({ filename: file, locator }) })),
    ...counts,
    costUsd: costUsd(modelId, counts),
    cold: arm === 'cag' && counts.cacheWriteTokens > 0,
    latencyMs: outcome.latencyMs,
    toolCalls: outcome.toolCalls,
  };
};

export const runArm = async (
  deps: ArmDeps,
  arm: Arm,
  questions: Question[],
  documents: { filename: string; sha256: string }[],
  onRow: (rows: AnswerRow[]) => void = () => {},
) => {
  const state = await corpusState(deps.db);
  assertFresh(state, documents);
  const scope = state.map(({ id }) => id);
  const context = arm === 'cag' ? await cagContext(deps.db) : null;
  const rows: AnswerRow[] = [];
  for (const question of questions) {
    const outcome = context ? await askCag(deps, context, question.question) : await askRag(deps, scope, question.question);
    rows.push(scoreOutcome(deps.modelId, arm, question, outcome));
    onRow(rows);
    if (arm === 'cag' && rows.filter(({ cold }) => cold).length > 1)
      throw new Error(`Stopped after ${question.id}: a second CAG question wrote the cache again, so the cache is not being reused. Rows so far are saved.`);
  }
  return rows;
};

export type ArmFile = { arm: Arm; model: string; startedAt: string; rows: AnswerRow[] };

const usd = (value: number) => `$${value.toFixed(4)}`;
const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;
const mean = (values: number[]) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0);
const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? (sorted.length % 2 ? sorted[(sorted.length - 1) / 2] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2) : 0;
};

export const summarise = (rows: AnswerRow[]) => {
  const cold = rows.filter((row) => row.cold);
  const warm = rows.filter((row) => !row.cold);
  const citations = rows.reduce((sum, row) => sum + row.citations, 0);
  const passed = rows.reduce((sum, row) => sum + row.passed, 0);
  return {
    questions: rows.length,
    rightSource: rows.filter((row) => row.rightSource).length,
    citations,
    passed,
    passRate: citations ? passed / citations : 0,
    errors: rows.filter((row) => row.status === 'error').length,
    totalUsd: rows.reduce((sum, row) => sum + row.costUsd, 0),
    coldCount: cold.length,
    coldUsd: cold.reduce((sum, row) => sum + row.costUsd, 0),
    warmCount: warm.length,
    warmMeanUsd: mean(warm.map((row) => row.costUsd)),
    meanLatencyMs: mean(rows.map((row) => row.latencyMs)),
    medianLatencyMs: median(rows.map((row) => row.latencyMs)),
  };
};

export const summaryLines = (arm: Arm, rows: AnswerRow[]) => {
  const s = summarise(rows);
  return [
    ['right source', `${s.rightSource}/${s.questions}`],
    ['citations pass', `${s.passed}/${s.citations} (${(s.passRate * 100).toFixed(0)}%)`],
    ['errors', String(s.errors)],
    ['total cost', usd(s.totalUsd)],
    ...(arm === 'cag'
      ? [
          ['cold questions', `${s.coldCount}, ${usd(s.coldUsd)} in all`],
          ['warm questions', `${s.warmCount}, ${usd(s.warmMeanUsd)} each on average`],
        ]
      : [['cost per question', usd(s.totalUsd / Math.max(1, s.questions))]]),
    ['latency', `mean ${seconds(s.meanLatencyMs)}, median ${seconds(s.medianLatencyMs)}`],
  ];
};

export const consoleText = ({ arm, model, rows }: ArmFile) =>
  [
    `${arm.toUpperCase()} arm, ${model}`,
    ...rows.map(
      (row) =>
        `${row.id.padEnd(32)} ${row.status.padEnd(8)} ${row.rightSource ? 'right source' : 'no right source'}  ${row.passed}/${row.citations} cited  ${usd(row.costUsd)}${row.cold ? ' cold' : ''}  ${seconds(row.latencyMs)}${row.error ? `  ${row.error}` : ''}`,
    ),
    '',
    ...summaryLines(arm, rows).map(([name, value]) => `${name.padEnd(18)} ${value}`),
  ].join('\n');

const cell = (text: string) => text.replaceAll('|', '\\|').replace(/\r?\n/g, '<br>');

export const reportMarkdown = (files: Partial<Record<Arm, ArmFile>>) => {
  const present = arms.filter((arm) => files[arm]);
  const ids = [...new Set(present.flatMap((arm) => files[arm]!.rows.map(({ id }) => id)))];
  const rowOf = (arm: Arm, id: string) => files[arm]?.rows.find((row) => row.id === id);
  const metric = (name: string, value: (row: AnswerRow) => string, id: string) => `| ${name} | ${present.map((arm) => { const row = rowOf(arm, id); return row ? cell(value(row)) : 'not run'; }).join(' | ')} |`;
  const header = `| | ${present.map((arm) => arm.toUpperCase()).join(' | ')} |`;
  const rule = `|---|${present.map(() => '---').join('|')}|`;
  const summaries = present.map((arm) => Object.fromEntries(summaryLines(arm, files[arm]!.rows)));
  const names = [...new Set(present.flatMap((arm) => summaryLines(arm, files[arm]!.rows).map(([name]) => name)))];
  return [
    '# RAG vs CAG answer eval',
    '',
    ...present.map((arm) => `- ${arm.toUpperCase()}: ${files[arm]!.model}, started ${files[arm]!.startedAt}`),
    '',
    '## Summary',
    '',
    header,
    rule,
    ...names.map((name) => `| ${name} | ${summaries.map((summary) => summary[name] ?? 'n/a').join(' | ')} |`),
    '',
    '## Marking',
    '',
    'Put an x in one column per arm after reading the answers below.',
    '',
    `| Question | ${present.flatMap((arm) => [`${arm.toUpperCase()} right`, `${arm.toUpperCase()} partly`, `${arm.toUpperCase()} wrong`]).join(' | ')} |`,
    `|---|${present.flatMap(() => ['---', '---', '---']).join('|')}|`,
    ...ids.map((id) => `| ${id} | ${present.flatMap(() => [' ', ' ', ' ']).join(' | ')} |`),
    '',
    '## Answers',
    ...ids.flatMap((id) => {
      const first = present.map((arm) => rowOf(arm, id)).find(Boolean)!;
      return [
        '',
        `### ${id}`,
        '',
        first.question,
        '',
        `Expected: ${first.expected.map(({ filename, locator }) => `${filename} · ${locator}`).join('; ')}`,
        '',
        header,
        rule,
        metric('Status', (row) => (row.error ? `${row.status}: ${row.error}` : row.status), id),
        metric('Right source', (row) => (row.rightSource ? 'yes' : 'no'), id),
        metric('Citations passed', (row) => `${row.passed}/${row.citations}`, id),
        metric('Cost', (row) => `${usd(row.costUsd)}${row.cold ? ' (cold)' : ''}`, id),
        metric('Latency', (row) => seconds(row.latencyMs), id),
        metric('Tool calls', (row) => String(row.toolCalls), id),
        metric('Excerpts', (row) => row.cited.map(({ file, locator, expected }) => `${expected ? '✓ ' : ''}${file} · ${locator}`).join('\n') || 'none', id),
        metric('Answer', (row) => row.answer || '(none)', id),
      ];
    }),
    '',
  ].join('\n');
};

export const readArmFiles = (dir: string) =>
  Object.fromEntries(arms.flatMap((arm) => (existsSync(join(dir, `${arm}.json`)) ? [[arm, JSON.parse(readFileSync(join(dir, `${arm}.json`), 'utf8')) as ArmFile]] : []))) as Partial<Record<Arm, ArmFile>>;

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { values } = parseArgs({ options: { arm: { type: 'string' }, out: { type: 'string', default: 'evals/answers' } } });
  const arm = z.enum(arms).safeParse(values.arm);
  if (!arm.success) {
    console.error('Pass --arm rag or --arm cag');
    process.exit(1);
  }
  const missing = ['DATABASE_URL', 'ANTHROPIC_API_KEY', ...(arm.data === 'rag' ? ['VOYAGE_API_KEY'] : [])].filter((name) => !process.env[name]?.trim());
  if (missing.length) {
    console.error(`${missing.join(' and ')} ${missing.length > 1 ? 'are' : 'is'} missing or empty`);
    process.exit(1);
  }
  const modelId = process.env.ANTHROPIC_MODEL?.trim() || 'claude-sonnet-5-5';
  if (!Object.hasOwn(usdPerMTok, modelId)) {
    console.error(`ANTHROPIC_MODEL ${modelId} is not a key of lib/pricing.ts`);
    process.exit(1);
  }
  const out = values.out;
  mkdirSync(out, { recursive: true });
  const file: ArmFile = { arm: arm.data, model: modelId, startedAt: new Date().toISOString(), rows: [] };
  const save = (rows: AnswerRow[]) => {
    writeFileSync(join(out, `${arm.data}.json`), `${JSON.stringify({ ...file, rows }, null, 2)}\n`);
    const last = rows[rows.length - 1];
    console.log(`${String(rows.length).padStart(2)} ${last.id.padEnd(32)} ${last.status} ${usd(last.costUsd)}${last.cold ? ' cold' : ''} ${seconds(last.latencyMs)}`);
  };
  file.rows = await runArm(
    {
      db: postgresDb(process.env.DATABASE_URL!),
      model: anthropicModel(new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })),
      modelId: modelId as PricedModel,
      embed: createEmbedder({ apiKey: process.env.VOYAGE_API_KEY ?? '' }),
    },
    arm.data,
    await loadQuestions(),
    (await loadManifest()).documents,
    save,
  );
  console.log(`\n${consoleText(file)}`);
  writeFileSync(join(out, 'report.md'), reportMarkdown(readArmFiles(out)));
  console.log(`\nwrote ${join(out, `${arm.data}.json`)} and ${join(out, 'report.md')}`);
  process.exit(0);
}
