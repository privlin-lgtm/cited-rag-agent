# cited-rag-agent

An agent that answers questions about a pack of cross-border payments documents and shows how it got there. Claude searches the documents with tools and cites passages, and every citation is checked against the stored text before it is marked checked.

**Live:** https://cited-rag-agent.vercel.app · **Preview (Sandbox):** https://cited-rag-agent-git-sandbox-privlin.vercel.app

![The cancellation question answered with checked citations: the steps the agent took, the answer, and the cited excerpts with the cited sentences highlighted](docs/screenshot.png)

On a phone:

<img src="docs/screenshot-390.png" width="300" alt="The cancellation question answered on a 390 px phone screen, with the checked-citations header and the answer">

## Architecture

```mermaid
flowchart LR
  browser["Browser"] -- "POST /api/ask" --> route["Route handler: cross-site guard, rate limit, budget hold"]
  route --> loop["Agent loop: Claude Sonnet 5.5, up to 6 tool rounds"]
  loop -- "tool calls" --> tools["search_documents, keyword_search, read_neighbours, list_documents"]
  tools -- "query embedding" --> voyage["Voyage voyage-4"]
  tools --> db[("Postgres 18 + pgvector on Neon")]
  loop -- "final answer" --> check["Citation check, block by block"]
  check -- "stored chunks" --> db
  route -- "NDJSON: steps, answer, citations, done" --> browser
```

One Next.js app on Vercel serves the page and the API. The question route takes its limits before any model call, runs the loop, checks every citation against the chunks stored in Postgres and streams each step to the page as it happens. Ingest (`npm run ingest:corpus`, and each upload) extracts, chunks and embeds documents into the same database.

## How a citation is checked

1. The search tools return passages to Claude as `search_result` blocks, one per chunk, each holding the chunk's sentences as separate content blocks, with citations enabled. A citation names a result by index and a range of sentence blocks inside it.
2. The server keeps one list of every `search_result` it sent in the run. A citation's index points into that list, across all rounds.
3. For each cited sentence block the check confirms that the index is in range, that the result's chunk exists and belongs to a document in scope, and that the block text equals the block at the same position when the stored chunk is split again and appears in the stored chunk text. It compares block by block and never uses `cited_text` as one string.
4. The file and page shown come from the database row, never from the model's text. A citation that fails shows as "unchecked".

**What "checked" proves:** the cited sentences are in the stored text of a passage retrieved in that run. **What it does not prove:** that the sentence supports the claim it is attached to, or that the passage answers the question asked. The highlighted excerpt is there for a reader to judge that, and the retrieval evals below measure how often the passages that answer a question are found.

## The agent loop

Claude Sonnet 5.5 runs a tool loop of at most six rounds with four tools: `search_documents` (semantic), `keyword_search` (exact terms), `read_neighbours` and `list_documents`. Search results come back as `search_result` blocks, and the loop keeps one global block index across rounds. Each step streams to the page as newline-delimited JSON. When the model stops, the check runs. If embedding the query fails, the search falls back to keywords and the step says so.

Document text is data, not instructions. A hostile document can steer the prose of an answer but cannot forge a checked citation, because the check runs in code on the stored text.

## Decisions

- **A hand-written agent loop, not a framework.** The loop is about 170 lines in [lib/agent/loop.ts](lib/agent/loop.ts). It is the part worth reading, and a framework would hide the round cap, the final call that sends `tool_choice: none`, and the citation index that runs across rounds.
- **Native search-result citations, not markers parsed from the text.** Claude cites a `search_result` block by index and a range of its sentence blocks, so code can check each citation against the stored chunk. A prompted `[source: file p. N]` marker can be invented; an index into what was sent can be checked.
- **A cost budget, not a question cap.** Each question holds $0.10 of the day's budget before its first model call and settles to its real cost, from each response's `usage`, when it ends. With $0.85 of a $1.00 budget spent, exactly one of ten simultaneous questions starts (there is a test). A $0.25 hold would stop a burst from ever passing the budget, but it would also refuse the last $0.25 of every day; at $0.10, runs that start together can pass it by at most (budget ÷ $0.10) × (a run's cost − $0.10).
- **Degrade, don't fail.** If Voyage fails or the day's 2M embedding tokens are spent, semantic search falls back to Postgres full text and the step says so. If the visitor leaves, the run stops before its next model call; the call already running finishes, so its cost is still counted.
- **One database for vectors and rows.** pgvector keeps the embeddings beside the documents, chunks and limit windows: one fewer service, and every retrieval query is plain SQL.
- **Tests on PGlite, checked on Neon.** Unit tests run on PGlite through the same `Db` interface. postgres.js encodes a JSON string parameter twice and PGlite doesn't, so every JSON parameter goes through `$n::text::jsonb`, and `npm run smoke:sql` runs every statement on a real Neon database and rolls it back.
- **Production is built by Vercel, after approval.** Vercel's secret values are write-only, so a build in GitHub couldn't use them. The Release workflow waits for approval, migrates and ingests, then has Vercel build and deploy the commit and checks `/api/health`.

## Stack

Next.js 16 (App Router) and React 19 on Vercel; TypeScript; Tailwind 4. Postgres 18 with pgvector on Neon: HNSW for semantic search and a generated `tsvector` for keywords. Voyage `voyage-4` embeddings. The Anthropic Messages API through `@anthropic-ai/sdk`. Vitest, with PGlite standing in for Postgres.

## Limits and cost

- Per address: 15 questions an hour and 10 uploads a day.
- Uploads: one `.md`, `.pdf` or `.txt` file of at most 4 MB, 40 pages and 100,000 estimated tokens, deleted after 24 hours.
- Spend: a daily model budget, $1 by default and raised on demo days, with $0.10 held for each question while it runs, and 2M embedding tokens a day.
- Measured over 12 runs of the four example questions: $0.0365 and 7.8 s per question on average.

## Environments and releases

Three environments, each with its own Neon database: Sandbox (the `sandbox` branch and every feature preview), QA (`qa`) and production (`master`). A change merges into `sandbox`, then travels by pull request to `qa` and on to `master`. Every Vercel build first checks its environment variables and fails with the name of any that is missing or points at the wrong environment; preview builds then migrate their database before `next build`. Production waits for approval in GitHub: the Release workflow migrates, ingests the corpus, has Vercel build and deploy the commit, and checks `/api/health`. Migrations are additive, so the code already running works with the new schema.

The workflow: [.github/workflows/pipeline.yml](.github/workflows/pipeline.yml)

## Running locally

Copy `.env.example` to `.env.local`, fill in the keys, then run these from the repo root.

```bash
npm ci
npm run migrate        # apply db/migrations to the database in .env.local
npm run ingest:corpus  # embed the nine documents (needs Voyage)
npm run dev            # http://localhost:3000
npm run lint && npm run typecheck && npm test && npm run build
npm run smoke:sql      # every SQL statement through postgres.js, rolled back
```

`npm run corpus:fetch` re-downloads the documents from their sources and rewrites the manifest.

## Corpus

Nine documents, committed under `corpus/files/` with their sources, licences and hashes in [corpus/manifest.json](corpus/manifest.json): three US federal texts on remittance transfers (public domain), the PSD2 directive (EU reuse, source acknowledged), and five Mojaloop documentation pages (Apache-2.0, except the generic transaction patterns page, which states CC BY-ND 4.0). The PSD2 text is reused under EUR-Lex's legal notice, which applies the Commission's reuse policy (Decision 2011/833/EU), with the acknowledgement: "© European Union, https://eur-lex.europa.eu/, 1998–2026. Only the Official Journal of the European Union is authentic."

## The chain

[Intent](intent/2026-10-07-mvp/intent.md) · [Spec](intent/2026-10-07-mvp/spec.md) · [Plan](intent/2026-10-07-mvp/plan.md) · [Review of the first spec and plan drafts](intent/2026-10-07-mvp/review-2026-10-07.md)

The Python prototype this repo started as is kept at the tag `python-prototype`.

## Retrieval evals

`npm run eval` scores semantic search on 14 questions in [evals/questions.json](evals/questions.json). Each question lists every file and page or heading whose text answers it, written after reading the ingested documents. A question is a hit at k when one of the top k passages is one of those. Two of the questions are answered only by a table in the CFPB guide, and several use plain words that the answering passage does not.

First honest run, on the Sandbox corpus, 13 Oct 2026:

| hit@1 | hit@3 | hit@5 | MRR (top 10) |
|---|---|---|---|
| 9/14 | 11/14 | 13/14 | 0.750 |

The check fails when hit@5 falls below 12 of 14 ([evals/threshold.json](evals/threshold.json), one question under the first run). [The evals workflow](.github/workflows/evals.yml) ingests the corpus into a fresh pgvector service, so it tests ingest as well as search, and runs on pull requests that touch ingest, search, the agent, the corpus or the eval set. One run spends about 178,000 Voyage tokens (178,185 to ingest the corpus and 267 for the questions), which is free inside Voyage's 200M free tokens, and makes no Anthropic calls.

## Demo

A five-minute walk-through, with the questions to ask and what to point at: [docs/demo.md](docs/demo.md).

## Status

Sandbox, QA and production are live, with retrieval evals in CI and a release pipeline gated on approval. Production went live on 21 October 2026, promoted through QA by PR #28 and PR #29. Every change reaches production through `sandbox` and `qa`.

## Local secrets

<!-- yanshuf-secrets -->

`.env.local` holds Sandbox credentials only and is kept in Paul's encrypted secrets archive. The key names are in `.env.example`.
