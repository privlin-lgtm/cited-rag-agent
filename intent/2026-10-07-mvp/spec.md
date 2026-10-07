# Spec: cited-rag-agent  (from intent.md, 2026-10-07) · Status: approved
Revised 2026-10-07 after the build session's review (`review-2026-10-07.md`); references such as (b.3) point to its items. Decisions D1–D6 at the end are confirmed by approving this spec.

## Stack
- **App:** Next.js 16.4.0 (App Router, Route Handlers on the Node runtime), React 19.3.0, TypeScript `~5.9.3`, Tailwind CSS 4 with a few shadcn/ui components. Every version is pinned exactly and the lockfile is committed. Lint runs through the ESLint CLI, since `next lint` is gone in 16. Hosted on Vercel (Paul's Pro account), with functions in `fra1`.
- **Database:** Postgres 17 with pgvector, one Neon Free project per environment in `aws-eu-central-1` (D1). The app connects over the pooled endpoint with `prepare: false`; migrations run over the direct endpoint, which is reachable over IPv4.
  - **If D1 goes to Supabase instead:** the app uses the transaction pooler (port 6543, `prepare: false`), and migrations use the session pooler (port 5432, user `postgres.<ref>`, host copied from the dashboard). Never the direct host, which is IPv6-only and unreachable from GitHub runners and Vercel (c).
- **Storage interface** (a.1), the prototype's `VectorStore` idea at the right size:
  - `lib/db.ts` exports `type Db = { query<T>(text: string, params?: unknown[]): Promise<T[]>; transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T> }`.
  - It has two drivers: `postgres` (porsager) for real databases, and PGlite (`@electric-sql/pglite` 0.5.8 with `@electric-sql/pglite-pgvector` 0.0.9, pinned exactly and grouped in Dependabot) for tests.
  - Every query is plain SQL with `$n` parameters, so both drivers run the same queries and the same migrations.
- **Embeddings:** Voyage `voyage-4`, 1024 dimensions, `input_type` set to `document` or `query`, `truncation: false`. Batches hold at most 128 texts, well inside the API's 1,000-text and 320K-token request limits.
- **LLM:** Anthropic Messages API through `@anthropic-ai/sdk` 0.131.0, model `claude-sonnet-5-5`, overridable by `ANTHROPIC_MODEL`. That value must be a key in `lib/pricing.ts`, or startup fails (b.14).
- **Tests:** Vitest. Database tests run on PGlite through the `Db` interface, so CI needs no database service for unit tests.
- **Why this stack:** the posting names Node.js and React. Next.js keeps the API and UI in one deployable; pgvector keeps vectors beside the relational data; plain SQL keeps every retrieval query readable in an interview.

## Features
1. **Demo corpus.** The cross-border payments pack, committed under `corpus/files/` (D4).
   - **The manifest:** `corpus/manifest.json` records each file's title, filename, kind, source URL, licence, attribution line and SHA-256.
   - **Contents:**
     - the CFPB Remittance Transfers Small Entity Compliance Guide, version 5.0 (PDF);
     - the CFPB Remittance Transfer Rule Examination Procedures (PDF);
     - 12 CFR part 1005 subpart B (Regulation E remittance transfers), as plain text built from the eCFR (txt);
     - Directive (EU) 2015/2366 (PSD2), the Official Journal PDF from EUR-Lex (PDF);
     - four or five Mojaloop documentation pages on transfers, quotes, party lookup and settlement, from `mojaloop/documentation` at a pinned commit (md). Mojaloop's `LICENSE` and `NOTICE` sit beside them.
   - **Refreshing:** `npm run corpus:fetch` downloads every file from its source URL and rewrites the hashes. It builds the pack once and refreshes it later; CI never calls it. A unit test checks every committed file against its manifest hash.
   - **In the UI:** each document's licence and source are shown.
2. **Upload.**
   - **Limits:** one md, pdf or txt file at a time, at most 4 MB and 40 pages.
   - **Scope:** the visitor's anonymous session (an httpOnly cookie). Uploads are deleted after 24 hours, and a second upload with the same filename in the same session replaces the first.
   - **Scanned PDFs:** a PDF that yields no text is rejected with a message saying OCR is out of scope.
3. **Ingest.**
   - **Extraction:** PDFs through `unpdf` `extractText(data, { mergePages: false })`, which returns per-page text and `totalPages`; add `serverExternalPackages: ['unpdf']` only if the bundler needs it. Markdown is split by headings, plain text by paragraphs.
   - **Chunking:** paragraphs are packed into chunks of about 400 estimated tokens, with a ceiling of 600 and an overlap of one paragraph (capped at about 80 tokens). A chunk never crosses a PDF page.
     - **Token estimate:** `Math.ceil(chars / 4)`. The ceiling sets retrieval granularity, not the embedder's limit (b.7).
     - **Locator:** every chunk has exactly one: `p. N` for PDF, the heading path for Markdown, `lines A–B` for text.
   - **Embedder guard:** `truncation: false` makes an over-length input fail the ingest loudly. Chunks sit far below voyage-4's 32K context, so the guard is the API flag rather than a local count (b.7).
   - **Versioning** (b.1): an `INGEST_VERSION` constant in `lib/ingest/index.ts` is bumped whenever extraction, chunking, sentence splitting or the embedding model changes.
     - A document is skipped when its (collection, filename) row has the same SHA-256 and ingest version.
     - Otherwise, in one transaction, the old row is deleted (its chunks cascade) and the document is ingested again.
   - **Report:** for each document, its pages, chunks and the Voyage `usage.total_tokens`.
4. **Retrieval.**
   - **Semantic search:** cosine distance over an HNSW index.
   - **Keyword search:** Postgres full text (`websearch_to_tsquery`) over a generated `tsvector`.
   - **Both:** can be filtered to selected documents, and return chunk ID, filename, locator, content and score.
5. **Sentence blocks** (b.2). `splitSentences(text)` in `lib/agent/sentences.ts` is pure and deterministic:
   - **Base:** `Intl.Segmenter('en', { granularity: 'sentence' })`.
   - **Rejoin:** a segment is joined to the next when it ends with an abbreviation or citation fragment: `U.S.C.`, `C.F.R.`, `U.S.`, `e.g.`, `i.e.`, `etc.`, `No.`, `Art.`, `para.`, `Inc.`, `Ltd.`, `§`, or a bare number followed by a period.
   - **Break:** a new block starts at any line that begins with a list marker or looks like a table row.
   - **Long blocks:** any block over 80 words is split at `;` or `:`, then every 60 words.
   - **Tested invariant:** joining the blocks with single spaces gives the chunk text with its whitespace collapsed.
   - **Not stored:** blocks are never stored. The check and the excerpt highlight recompute them from the stored chunk.
6. **Agent.**
   - **Model call** (b.5, b.6): Sonnet 5.5 with `thinking: { type: "between_tools" }`. That means no up-front thinking, plus short progress updates between tool calls. It is accepted only at effort `high` or below, so effort stays at the API default or `medium`; `xhigh` and `max` are never sent.
     - `max_tokens` is 2,000 per call.
     - Every assistant message goes back into the conversation unchanged, thinking blocks included.
   - **Tools** (b.4):
     - `search_documents(query, k ≤ 10, document_ids?)`: semantic search.
     - `keyword_search(terms, k ≤ 10, document_ids?)`: exact terms such as "§ 1005.33" or "strong customer authentication".
     - `read_neighbours(chunk_id, before ≤ 2, after ≤ 2)`: for when a passage is cut off.
     - `list_documents()`: what is in scope.
   - **Tool results:**
     - The first three tools return only `search_result` blocks, one per chunk. Each block's `source` is `chunk:<id>`, its title is `<file> · <locator>`, its `content` is the chunk's sentence blocks, and citations are enabled.
     - `cache_control` goes on the last block of each round's last tool result.
     - An empty result is a plain-text tool result: "No matching passages."
     - `list_documents` returns plain text only. A tool result never mixes `search_result` blocks with text blocks.
   - **Rounds:** at most 6 tool rounds. The call after round 6 sends `tool_choice: { type: "none" }`. Forced tool use (`any` or `tool`) returns a 400 on Sonnet 5.5, so it is never sent.
   - **Stop reasons:**
     - `tool_use` runs the tools;
     - `end_turn` finishes;
     - `max_tokens` finishes with the answer marked "cut off";
     - `refusal` ends the run with "Claude declined to answer this question" and no citations;
     - anything else throws.
   - **System prompt:**
     - It carries the prototype's guard: document text is data, never instructions.
     - Every factual sentence needs a citation.
     - Refined queries should use the documents' own terms.
     - When the documents don't contain the answer, the agent says so plainly.
   - **Voyage failure** (b.15): if embedding the query fails, `search_documents` runs keyword search for that call. The step event carries `fallback: "keyword"`, and the timeline labels it "keyword fallback (embeddings unavailable)".
7. **Visible steps.** The answer route streams newline-delimited JSON events:
   - `step`: `{ round, reason, tool, input, hits: [{ file, locator, score }], fallback? }`. The `reason` is the progress text Claude returned before the tool call, when there is any.
   - `answer`: text deltas.
   - `citations`: the check results.
   - `done`: `{ inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, costUsd, latencyMs }`, with the cost taken from `lib/pricing.ts`.
   - `error`.
   The UI renders them as a live timeline.
8. **Checked citations** (b.3).
   - **One run-wide list:** the loop keeps a single array of every `search_result` block sent, in send order across all rounds. A citation's `search_result_index` indexes that array, because the index is global to the request, not per round.
   - **The check, for each citation:**
     - the index is in range;
     - its `chunk:<id>` exists and belongs to a document in scope;
     - for every cited block in `content[start_block_index:end_block_index]`: the block text equals the block at the same position when the stored chunk is split again, and it is a substring of the stored chunk, whitespace-normalised.
     - `cited_text` is never compared as one string, because its joiner is unspecified.
   - **Display:**
     - File and locator come from the database, never from the model's text.
     - A chunk cited through several indices is shown once, with all its cited sentences highlighted.
     - A failed citation shows in red as "unchecked", never as checked.
     - The answer header reads "N of M citations checked".
9. **Excerpts.** Beside the answer, each cited chunk shows its file, its locator and the chunk text with the cited sentences highlighted, plus a link to the source document.
10. **Abuse and spend limits** (b.8, c).
    - **Windows:** fixed. `window_start` is the start of the UTC hour or UTC day.
    - **Buckets:**
      - `ask:ip:<hash>`: 15 an hour.
      - `upload:ip:<hash>`: 10 a day.
      - `anthropic:usd`: daily cost budget `DAILY_ANTHROPIC_BUDGET_USD`, default 1.00 (D2).
      - `embed:tokens`: 2M a day.
    - **Counting:** one atomic `insert … on conflict (bucket, window_start) do update set count = usage_windows.count + $n returning count`.
      - Questions and uploads are reserved before any model call, and they still count if the call fails.
      - Cost (in micro-dollars) and embedding tokens are added after each API call, from the response's `usage`.
      - A new question is refused once today's cost reaches the budget.
    - **IP:** the first address in `x-forwarded-for`, which Vercel sets. The hash is HMAC-SHA256 keyed with `IP_HASH_SECRET`, first 16 hex characters.
    - **Messages:** each refusal says which limit was hit and when it resets.
11. **Evals** (M4, b.9).
    - **Questions:** `evals/questions.json` holds 12 to 15 questions, each with the set of (filename, locator) pairs that answer it, written after reading the ingested corpus.
    - **Hit:** a question is a hit at k when any of the top k chunks from `search_documents` (semantic only, no document filter) has a pair in its expected set.
    - **Metrics:** `npm run eval` reports hit@1, hit@3 and hit@5, plus MRR from the rank of the first matching chunk. `keyword_search` isn't scored in M4.
    - **CI:** runs on every PR that touches ingest, retrieval, prompts or the eval set. Results go in the job summary, and the job fails below a hit@5 threshold set from the first honest run.
12. **Environments** (M5, b.11, b.12, D3).
    - **Branches:** `sandbox` → `qa` → `master`. Feature PRs merge into `sandbox`, and promotion is by PR.
    - **Databases:** one Neon project per environment (D1).
    - **Migrations:** every migration is additive and works with the code already deployed (expand now, contract in a later release). The rule lives in `AGENTS.md` and `REVIEW.md`.
    - **Sandbox and QA:** Vercel builds run `npm run migrate` before `next build`, through the `vercel-build` script, using that environment's `MIGRATION_DATABASE_URL`. A feature preview therefore applies its own schema change to Sandbox before its code runs.
    - **Production:** Vercel's automatic deploys from `master` are off (`git.deploymentEnabled.master: false` in `vercel.json`). On a push to `master`, `pipeline.yml` waits for Paul's approval in the GitHub `production` environment, then migrates, then runs `vercel deploy --prebuilt --prod`.
    - **Vercel env vars:** Preview points at Sandbox by default, with a branch override pointing `qa` at QA; Production points at production.
    - **GitHub Environments:** each holds its database's migration URL, and `production` also holds the Vercel token.
    - **Credentials stay off the dev machine:** QA and production credentials live only in GitHub and Vercel, and `.env.local` holds Sandbox only.
    - **Corpus:** the pipeline ingests it after migrating when the manifest or `INGEST_VERSION` changed.
13. **Home page demo aids.** Four example questions under the input; a footer with the model, tokens, cost and latency of the last answer; and an environment badge from `APP_ENV`.
14. **Preview access** (c, D5). Vercel Deployment Protection is off for this project, so the Sandbox preview opens at its stable branch URL without a Vercel login. The limits in feature 10 protect the keys.

## Screens / routes
- `/`: one responsive page. On desktop it has three columns: documents (corpus with licence badges, session uploads, scope checkboxes); the question with the agent timeline and the answer; excerpts. Below 1024 px they stack, with excerpts opening under the answer.
- `POST /api/ask`: `{ question (1–500 chars), documentIds? }` → NDJSON stream. Input is validated with zod, and the limits are checked before any model call.
- `POST /api/upload`: multipart, one file → `{ document }` once ingested, or a 4xx with the reason.
- `GET /api/documents`: the corpus plus this session's uploads.
- `DELETE /api/documents/:id`: the session's own uploads only.
- `GET /api/health`: `{ env, database, lastMigration }`, which shows per environment that each has its own database.
- `GET /api/cron/cleanup`: a Vercel Cron job, run hourly, that deletes uploads older than 24 h and expired limit windows. It is protected by `CRON_SECRET`.

## Schema
Every column below serves a feature above; nothing is "just in case".
```sql
create extension if not exists vector;

create table schema_migrations (     -- created by scripts/migrate.ts before anything else (b.10)
  name text primary key,             -- migration file applied
  applied_at timestamptz not null default now()
);

create table documents (
  id uuid primary key default gen_random_uuid(),
  collection text not null,          -- 'corpus' or 'upload:<session id>'  (features 1, 2, scope)
  filename text not null,            -- shown in citations; joins to corpus/manifest.json; replace-on-reupload key
  kind text not null check (kind in ('pdf', 'md', 'txt')),   -- picks the extractor and the locator style
  sha256 text not null,              -- skip unchanged files
  ingest_version int not null,       -- re-ingest when extraction, chunking or embedding changes (b.1)
  created_at timestamptz not null default now(),             -- 24 h upload expiry
  unique (collection, filename)
);

create table chunks (
  id bigint generated always as identity primary key,       -- the chunk:<id> Claude cites
  document_id uuid not null references documents (id) on delete cascade,
  ord int not null,                  -- neighbour reads
  locator text not null,             -- 'p. 12', '§ Transfers › Phases', 'lines 40–58'
  content text not null,             -- what is embedded, cited and checked against
  embedding vector(1024) not null,
  tsv tsvector generated always as (to_tsvector('english', content)) stored,
  unique (document_id, ord)
);
create index on chunks using hnsw (embedding vector_cosine_ops);
create index on chunks using gin (tsv);

create table usage_windows (
  bucket text not null,              -- 'ask:ip:<hash>', 'upload:ip:<hash>', 'anthropic:usd', 'embed:tokens'
  window_start timestamptz not null,
  count bigint not null default 0,   -- requests, micro-dollars or tokens, by bucket
  primary key (bucket, window_start)
);
```
- `0001_init.sql` holds everything except `schema_migrations`.
- `scripts/migrate.ts` creates `schema_migrations` if it's missing, then applies each pending `db/migrations/*.sql` file in name order, each in one transaction together with its `schema_migrations` row.
- `chunks.tokens` from the first draft is dropped (d): the ingest report takes its numbers from Voyage's `usage`.
- Corpus titles, source URLs and licences live in `corpus/manifest.json`, not in the database. Agent runs are not stored.

## AI features
| Feature | Type | Details |
|---|---|---|
| Agentic answer with checked citations | LLM (Claude Sonnet 5.5, tool use + native search-result citations, `between_tools` thinking) | At most 6 tool rounds, at most 2,000 tokens per call. The check is deterministic code, not a model. |
| Retrieval | Pipeline (Voyage embeddings + pgvector, Postgres full text) | No model judgement; measured by hit@k in CI. |

- **Below threshold:** the citation check is pass or fail, with no confidence band. Failures show as "unchecked", and an answer with no checked citation says so at the top.
- **When the answer isn't in the documents:** the agent says it couldn't find it, and the answer still shows the steps it took.
- **Fallback:** if the Anthropic API fails, the route returns the error and the top retrieved excerpts, labelled "no answer generated". If Voyage fails, see feature 6.
- **Cost per question** (estimate, to be replaced by measured numbers at the first cut):
  - about 15 to 25K input tokens across 3 to 4 calls, plus about 800 output tokens, which comes to roughly $0.04 to $0.06;
  - prompt caching on the growing prefix should take that to about $0.02 to $0.03;
  - `between_tools` keeps thinking tokens to the short progress updates.
- **Ceilings:** the app's daily budget of $1.00 is about 30 to 50 questions a day. The Anthropic workspace's monthly limit of $30 is the hard stop (D2).
- **Embeddings:** the corpus is about 0.4M tokens once, at $0 inside Voyage's 200M free tokens. Questions cost a few hundred tokens each.

## Out of scope
OCR; MongoDB; accounts and logins; storing agent runs or chat history; re-ranking models; streaming partial citations; i18n; native mobile.

## Concerns
1. **Public demo on paid keys.** Covered by the limits in feature 10 and the workspace limit. Voyage has no spend-limit setting: the key stays on the free tier with no card, a $0 ceiling, against 200M free tokens.
2. **Licences.**
   - CFPB and eCFR texts are US federal works in the public domain (17 U.S.C. §105).
   - PSD2 is reused from EUR-Lex with the source acknowledged. The exact acknowledgement wording is confirmed against EUR-Lex's legal notice and recorded in the manifest and README before the file is committed.
   - Mojaloop's docs are Apache-2.0, so its `LICENSE` and `NOTICE` go beside the files.
3. **Corpus sources that refuse scripted downloads.** Paul downloads that file once in a browser. The file is committed, so CI never depends on the source.
4. **Vercel request limit.** Bodies are capped at 4.5 MB, hence the 4 MB upload limit.
5. **Paul's constraint block** applies to app code and hook scripts alike.
6. **Next.js 16.4.0 is one day old** (published 2026-10-06). It is pinned exactly; if the build hits a 16.4.0 bug, drop to the latest 16.3.x.
7. **Many small `search_result` blocks per round raise input tokens.** Prompt caching on the growing prefix offsets most of that; it is measured at the first cut.
8. **Neon cold starts.** Free projects suspend after 5 idle minutes, so the first query afterwards takes about a second longer. That's acceptable for a demo.

## Decisions confirmed by approving this spec
- **D1 Hosting:** Neon Free, one project per environment, $0 a month. The alternative was Supabase: Sandbox on the free slot, plus QA and production on Pro in a separate organisation at about $35 a month. Supabase's free projects also pause after a week without traffic.
- **D2 Anthropic spend:** the workspace monthly limit is $30, and the app's daily budget is $1.00 (`DAILY_ANTHROPIC_BUDGET_USD`), raised through that env var on interview days.
- **D3 Production release:** the pipeline migrates and then deploys, after Paul approves in GitHub. Vercel's automatic deploys from `master` are off.
- **D4 Corpus files:** committed to the repo (about 5 MB), with their licences beside them.
- **D5 Preview protection:** Vercel Deployment Protection is off for this project.
- **D6 Uploads on production:** open, within the limits in feature 10.
