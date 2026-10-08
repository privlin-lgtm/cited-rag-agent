# Spec: cited-rag-agent  (from intent.md, 2026-10-07) · Status: approved
Revised 2026-10-07 after the build session's review (`review-2026-10-07.md`); references such as (b.3) point to its items. Decisions D1–D6 at the end are confirmed by approving this spec.
Revised 2026-10-08 with the first-cut fixes (`fix/first-cut`): features 2, 7, 9, 10 and 13, and Screens / routes.

## Stack
- **App:** Next.js 16.4.0 (App Router, Route Handlers on the Node runtime), React 19.3.0, TypeScript `~5.9.3`, Tailwind CSS 4 with a few shadcn/ui components. Every version is pinned exactly except TypeScript (`~5.9.3`, patch updates only), and the lockfile is committed. Lint runs through the ESLint CLI, since `next lint` is gone in 16. Hosted on Vercel (Paul's Pro account), with functions in `fra1`.
- **Database:** Postgres with pgvector, one Neon Free project per environment in `aws-eu-central-1` (D1). The app connects over the pooled endpoint with `prepare: false`; migrations run over the direct endpoint, which is reachable over IPv4. Neon runs Postgres 18 with pgvector 0.8.6 (Sandbox: 18.6); tests run on PGlite 0.5.8, which is Postgres 18.3 with pgvector 0.8.1, and the schema uses nothing that differs between them. Both have the iterative HNSW scans that pgvector 0.8.0 added. `MIGRATION_DATABASE_URL` is read only by `scripts/migrate.ts`. `lib/db.ts` drops the `channel_binding` URL parameter, which postgres.js doesn't support; `sslmode=require` keeps TLS on.
  - **If D1 goes to Supabase instead:** the app uses the transaction pooler (port 6543, `prepare: false`), and migrations use the session pooler (port 5432, user `postgres.<ref>`, host copied from the dashboard). Never the direct host, which is IPv6-only and unreachable from GitHub runners and Vercel (c).
- **Storage interface** (a.1), the prototype's `VectorStore` idea at the right size:
  - `lib/db.ts` exports `type Db = { query<T>(text: string, params?: unknown[]): Promise<T[]>; transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T> }`.
  - It has two drivers: `postgres` (porsager) for real databases, and PGlite (`@electric-sql/pglite` 0.5.8 with `@electric-sql/pglite-pgvector` 0.0.9, pinned exactly and grouped in Dependabot) for tests.
  - Every query is plain SQL with `$n` parameters, so both drivers run the same queries and the same migrations.
- **Embeddings:** Voyage `voyage-4`, 1024 dimensions, `input_type` set to `document` or `query`, `truncation: false`. Batches hold at most 128 texts, well inside the API's 1,000-text and 320K-token request limits.
- **LLM:** Anthropic Messages API through `@anthropic-ai/sdk` 0.131.0, model `claude-sonnet-5-5`, overridable by `ANTHROPIC_MODEL`. That value must be a key in `lib/pricing.ts`, or the first request that reads the environment fails (b.14). Validation is lazy: a bad value surfaces on the first page or `/api/health` request, never silently.
- **Tests:** Vitest. Database tests run on PGlite through the `Db` interface, so CI needs no database service for unit tests.
- **Why this stack:** the posting names Node.js and React. Next.js keeps the API and UI in one deployable; pgvector keeps vectors beside the relational data; plain SQL keeps every retrieval query readable in an interview.

## Features
1. **Demo corpus.** The cross-border payments pack, committed under `corpus/files/` (D4).
   - **The manifest:** `corpus/manifest.json` records each file's id, title, filename, kind, source URL, licence, licence URL (when the licence has a page of its own), attribution line and SHA-256, plus an optional `note` for a fact a reader needs, such as the eCFR date or the Mojaloop commit. A licence file that ships with a source (Mojaloop's `LICENSE.md`) is listed with its hash under `licenceFiles`, because it is not a document to ingest.
   - **Contents:**
     - the CFPB Remittance Transfers Small Entity Compliance Guide, version 5.0 (PDF);
     - the CFPB Remittance Transfer Rule Examination Procedures (PDF);
     - 12 CFR part 1005 subpart B (Regulation E remittance transfers), as plain text built from the eCFR (txt);
     - Directive (EU) 2015/2366 (PSD2), the Official Journal PDF (PDF). It comes from the Publications Office's Cellar, because EUR-Lex answers scripted requests with a challenge; it is the same text as EUR-Lex CELEX:32015L2366;
     - five Mojaloop documentation pages on transfers, quotes, party lookup and settlement, from `mojaloop/documentation` at a pinned commit (md). The repository ships `LICENSE.md` and no NOTICE, so `LICENSE.md` sits beside them. One page, the FSPIOP generic transaction patterns, states CC BY-ND 4.0 in its own front matter, and the manifest says so.
   - **Refreshing:** `npm run corpus:fetch` downloads every file from its source URL and rewrites the hashes. It builds the pack once and refreshes it later; CI never calls it. A unit test checks every committed file against its manifest hash.
   - **In the UI:** each document's licence and source are shown.
2. **Upload.**
   - **Limits:** one md, pdf or txt file at a time, at most 4 MB and 40 pages.
   - **Token cap:** a file of any kind whose estimated tokens exceed 100,000 is refused with a 413 that names the estimate and the cap. The estimate is the sum of `Math.ceil(chars / 4)` over the chunks, taken after extraction and chunking and before any embedding call. An upload whose estimate would take today's `embed:tokens` past 2M is refused with the reset time (feature 10).
   - **Scope:** the visitor's anonymous session (an httpOnly cookie). Uploads are deleted after 24 hours, and a second upload with the same filename in the same session replaces the first.
   - **Scanned PDFs:** a PDF that yields no text is rejected with a message saying OCR is out of scope.
3. **Ingest.**
   - **Extraction:** PDFs through `unpdf` `extractText(data, { mergePages: false })`, which returns per-page text and `totalPages`; add `serverExternalPackages: ['unpdf']` only if the bundler needs it. Markdown is split by headings, plain text by paragraphs.
   - **Cleanup (ingest version 2):**
     - Markdown lines that hold only an image (also when wrapped in a link) are dropped, and a section left with only headings merges into the next one, as a heading-only section always does.
     - In a PDF, take the first three and last three non-empty lines of every page, collapse their whitespace and replace each run of digits with `#`. A line found that way on at least a third of the pages, and on at least three, is a running header or footer, and it is dropped wherever it appears on a page, because extraction sometimes puts a header mid-page. (One half of the pages missed PSD2, whose odd and even pages carry two mirrored headers.)
     - Tables stay as extracted; the eval decides whether they need more.
   - **Chunking:** paragraphs are packed into chunks of about 400 estimated tokens, with a ceiling of 600 and an overlap of one paragraph (capped at about 80 tokens). A chunk never crosses a PDF page.
     - **Token estimate:** `Math.ceil(chars / 4)`. The ceiling sets retrieval granularity, not the embedder's limit (b.7).
     - **Locator:** every chunk has exactly one: `p. N` for PDF, the heading path for Markdown, `lines A–B` for text.
   - **Embedder guard:** `truncation: false` makes an over-length input fail the ingest loudly. Chunks sit far below voyage-4's 32K context, so the guard is the API flag rather than a local count (b.7).
   - **Versioning** (b.1): an `INGEST_VERSION` constant in `lib/ingest/index.ts` is bumped whenever extraction, chunking, sentence splitting or the embedding model changes.
     - A document is skipped when its (collection, filename) row has the same SHA-256 and ingest version.
     - Otherwise, in one transaction, the old row is deleted (its chunks cascade) and the document is ingested again.
   - **Report:** for each document, its pages, chunks and the Voyage `usage.total_tokens`.
4. **Retrieval.**
   - **Semantic search:** cosine distance over an HNSW index. It runs in a transaction with `hnsw.iterative_scan = relaxed_order` and re-orders its results (a materialized CTE ordered by `distance + 0`), so a filter to one small, distant document still returns `k` hits, or all its chunks when it has fewer.
   - **Keyword search:** Postgres full text (`websearch_to_tsquery`) over a generated `tsvector`. It ANDs plain terms, so the tool asks Claude for one to three exact terms or a quoted phrase, and allows `OR` between alternatives.
   - **Both:** take a required list of document ids, so no caller can search every collection by leaving the list out (an empty list returns no hits without a query), and return chunk ID, document ID, filename, locator, content and score.
5. **Sentence blocks** (b.2). `splitSentences(text)` in `lib/agent/sentences.ts` is pure and deterministic:
   - **Base:** `Intl.Segmenter('en', { granularity: 'sentence' })`.
   - **Rejoin:** a segment is joined to the next when it ends with an abbreviation or citation fragment: `U.S.C.`, `C.F.R.`, `U.S.`, `e.g.`, `i.e.`, `etc.`, `No.`, `Art.`, `para.`, `Inc.`, `Ltd.`, `§`, or a segment that is itself a bare number followed by a period (a list numeral such as `1.`; a sentence that merely ends in a number does not join the next one).
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
   - `citations`: `{ status, segments, results, excerpts }`: the final answer in text segments, each with the citations attached to it, the check result of every citation, and the excerpts. The client keeps streamed `answer` text as pending until the first `step` of a round arrives (that text was the step's reason) and replaces it with the segments at `citations`.
   - `done`: `{ model, inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, costUsd, latencyMs }`, with the cost taken from `lib/pricing.ts`.
   - `error`.
   The UI renders them as a live timeline.
   - **Scores are labelled:** a hit's score reads "similarity" (cosine similarity, `search_documents`) or "keyword rank" (`ts_rank_cd`, `keyword_search` and the keyword fallback). `read_neighbours` hits have no score.
   - **Status line:** after the first `step` and until the `citations` or `error` event arrives, whenever no streamed text is showing, the Answer section reads "Reading the passages and writing the answer…".
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
     - The answer header reads "N of M citations checked". An answer that cites nothing (a refusal, or a plain "the documents don't cover this") reads "no citations" in a neutral badge; red is kept for answers whose citations were given and none passed the check.
9. **Excerpts.** Beside the answer, each cited chunk shows its file, its locator and the chunk text with the cited sentences highlighted, plus a link to the source document.
   - **Markdown documents:** for a file whose name ends in `.md`, the excerpt renders inline Markdown for display only: `**bold**`, `` `code` `` (also inside bold), `[text](target)` as its text, `<br />` as a line break, `<sup>…</sup>` as superscript with a link inside shown as its text, and a heading marker (`#` to `######`) at the start of a block dropped. The highlighted blocks, the stored text and the citation check are unchanged. Other files show the stored text as it is.
10. **Abuse and spend limits** (b.8, c).
    - **Windows:** fixed. `window_start` is the start of the UTC hour or UTC day.
    - **Buckets:**
      - `ask:ip:<hash>`: 15 an hour.
      - `upload:ip:<hash>`: 10 a day.
      - `anthropic:usd`: daily cost budget `DAILY_ANTHROPIC_BUDGET_USD`, default 1.00 (D2).
      - `embed:tokens`: 2M a day. Once it is reached, uploads are refused with the reset time, and `search_documents` uses keyword search for the rest of the day.
    - **Counting:** one atomic `insert … on conflict (bucket, window_start) do update set count = usage_windows.count + $n returning count`.
      - Questions and uploads are reserved before any model call, and they still count if the call fails. The question is reserved right after the body validates and before the session and document lookup, so a flood does no unthrottled database work.
      - **Budget reservation:** after the scope check, a question adds $0.10 (100,000 micro-dollars) to `anthropic:usd` with the same upsert. If the returned total passes the budget, it takes the $0.10 back and is refused with the reset time. A question therefore starts only while the day's total plus $0.10 stays within the budget, however many start together.
      - **True-up:** cost (in micro-dollars) is added after each model call, from the response's `usage`, and the $0.10 is released when the run ends on any path (complete, cut off, declined, model error, a thrown error, a client that left). The window then holds the actual cost. A run killed by the platform before it ends leaves its $0.10 held until the window expires.
      - **Overshoot bound:** runs that start together can pass the budget by at most (budget ÷ $0.10) × (a run's cost − $0.10). The 15-an-hour limit per address and the 120 s function cap make that implausible for a demo.
      - **Embedding tokens** are debited as each Voyage response arrives, batch by batch, for uploads and questions alike, so tokens spent before a failure still count. An upload's estimate (feature 2) is checked against the day's total before the first batch.
    - **Server log:** when a run ends, `handleAsk` writes one `console.info` line of JSON: `event` ("ask"), `status` (`complete`, `cut_off`, `declined` or `error`), `model`, `rounds` (tool rounds run), `toolCalls`, `keywordFallbacks`, the four token counts, `costUsd` and `latencyMs`. It never holds the question, document ids, the session id or the address hash.
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
    - **Header:** a link to the GitHub repository, and one line under the description: "Claude searches the documents with tools and cites passages; each citation is checked against the stored text before it is marked checked."
    - **Footer links:** the Intent, Spec and Plan links point at `blob/HEAD/intent/2026-10-07-mvp/…`, so they follow the repository's default branch.
    - **Page metadata:** `app/icon.svg` (an indigo rounded square with a check mark) is the favicon, so `/favicon.ico` is never requested; the layout carries a description and Open Graph tags (title, description, type website), with no image.
14. **Preview access** (c, D5). Vercel Deployment Protection is off for this project, so the Sandbox preview opens at its stable branch URL without a Vercel login. The limits in feature 10 protect the keys.

## Screens / routes
- `/`: one responsive page. On desktop it has three columns: documents (corpus with licence badges, session uploads, scope checkboxes); the question with the agent timeline and the answer; excerpts. Below 1024 px they stack, with excerpts opening under the answer.
- **Cross-site guard:** `POST /api/ask`, `POST /api/upload` and `DELETE /api/documents/:id` answer 403 before any reservation or database work when `Sec-Fetch-Site` is `cross-site` or `same-site`, or when an `Origin` header is present and its host differs from the request's host (the `Host` header). A request with neither header, such as curl or a test, passes. A third-party page therefore cannot make its visitors' browsers ask questions or upload.
- `POST /api/ask`: `{ question (1–500 chars), documentIds? }` → NDJSON stream. Input is validated with zod, and the limits are checked before any model call.
- `POST /api/upload`: multipart, one file → `{ document }` once ingested, or a 4xx with the reason.
- `GET /api/documents`: the corpus plus this session's uploads.
- `DELETE /api/documents/:id`: the session's own uploads only.
- `GET /api/health`: `{ env, database, lastMigration }`, where `database` is the first 12 hex characters of the SHA-256 of `DATABASE_URL`'s host name, so environments are told apart without publishing the host.
- `GET /api/cron/cleanup`: a Vercel Cron job, run hourly, that deletes uploads older than 24 h and expired limit windows. It is protected by `CRON_SECRET`. Vercel calls cron jobs on the production deployment only, so on Sandbox the job is triggered hourly (minute 17) by the GitHub Actions workflow `cleanup.yml`, which sends `SANDBOX_CRON_SECRET` as the bearer token and writes the JSON response to the job summary. GitHub runs scheduled workflows from the default branch only, so the schedule starts once `sandbox` is the default branch. M5 adds QA to the workflow.

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
- **Ceilings:** the app's daily budget of $1.00 is about 30 to 50 questions a day. The Anthropic workspace's monthly limit of $20 is the hard stop (D2).
- **Embeddings:** the corpus is about 0.19M Voyage tokens once (185,476 measured in M2), at $0 inside Voyage's 200M free tokens. Questions cost a few hundred tokens each.

## Out of scope
OCR; MongoDB; accounts and logins; storing agent runs or chat history; re-ranking models; streaming partial citations; i18n; native mobile.

## Concerns
1. **Public demo on paid keys.** Covered by the limits in feature 10 and the workspace limit. Voyage has budget alerts, not hard caps. The account now has a payment method, which unlocks the standard rate limits; the 200M free tokens still apply. Spend is controlled by the app's 2M-token daily embedding budget (feature 10) and the project's $5 monthly alert (email only); Voyage itself has no hard cap.
2. **Licences.**
   - CFPB and eCFR texts are US federal works in the public domain (17 U.S.C. §105).
   - PSD2 is reused from EUR-Lex with the source acknowledged. The manifest records the acknowledgement wording and links EUR-Lex's legal notice; the wording is still to be checked against that notice, and repeated in the README, before M6.
   - Mojaloop's docs are Apache-2.0 apart from the one page noted under feature 1. The repository ships `LICENSE.md` and no NOTICE, so `LICENSE.md` goes beside the files.
3. **Corpus sources that refuse scripted downloads.** Paul downloads that file once in a browser. The file is committed, so CI never depends on the source.
4. **Vercel request limit.** Bodies are capped at 4.5 MB, hence the 4 MB upload limit.
5. **Paul's constraint block** applies to app code and hook scripts alike.
6. **Next.js 16.4.0 is one day old** (published 2026-10-06). It is pinned exactly; if the build hits a 16.4.0 bug, drop to the latest 16.3.x.
7. **Many small `search_result` blocks per round raise input tokens.** Prompt caching on the growing prefix offsets most of that; it is measured at the first cut.
8. **Neon cold starts.** Free projects suspend after 5 idle minutes, so the first query afterwards takes about a second longer. That's acceptable for a demo.

## Decisions confirmed by approving this spec
- **D1 Hosting:** Neon Free, one project per environment, $0 a month. The alternative was Supabase: Sandbox on the free slot, plus QA and production on Pro in a separate organisation at about $35 a month. Supabase's free projects also pause after a week without traffic.
- **D2 Anthropic spend:** the workspace monthly limit is $20, set at setup to leave room in the organisation's $50 limit for Paul's other projects, and the app's daily budget is $1.00 (`DAILY_ANTHROPIC_BUDGET_USD`), raised through that env var on interview days.
- **D3 Production release:** the pipeline migrates and then deploys, after Paul approves in GitHub. Vercel's automatic deploys from `master` are off.
- **D4 Corpus files:** committed to the repo (3.4 MB), with their licences beside them.
- **D5 Preview protection:** Vercel Deployment Protection is off for this project.
- **D6 Uploads on production:** open, within the limits in feature 10.
