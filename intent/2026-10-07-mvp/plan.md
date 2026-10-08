# Plan: cited-rag-agent  (from spec.md, 2026-10-07) · Status: approved
Revised 2026-10-07 after the build session's review (`review-2026-10-07.md`).

Times are Israel time. The build runs in Claude Code on Paul's machine, from the repo root `C:\Users\privlin\Projects\personal-knowledge-RAG-system`. The planning session writes the prompts and Paul runs them. Each milestone is one PR; the agent pushes named branches and opens PRs, and Paul's merge is the release.

## Milestones
| # | What | Branch → target | When | Paul |
|---|---|---|---|---|
| M0 | Intent, spec, plan, plus the build session's review of the spec and plan (`review-2026-10-07.md`) and these revisions; gate commits on `flow/mvp` | `flow/mvp` → `master` (PR #9) | Wed 7 Oct 12:00–14:00 | **Accept the intent; approve the spec (with decisions D1–D6) and the plan; merge** |
| M1 | Scaffold and guardrails (workflow Phase 3a): the `sandbox` branch; the Python code leaves the tree; Next.js app; one command each for lint, typecheck, test and build; the `Db` interface with both drivers; `0001_init.sql` and `scripts/migrate.ts`; `/api/health`; the agent files in the appendix; CI; Dependabot | `m1-scaffold` → `sandbox` | Wed 14:00–16:30 | **Manual approvals until the hooks are proven; review and merge by 17:30, then close Dependabot PRs #1–#8 (or let the M2 session do it)** |
| S1 | Accounts and keys: Neon Sandbox project; Anthropic workspace (limit $20) and key; Voyage key (no card); Vercel project (region `fra1`, protection off, env vars); `.env.local` copied into the secrets archive | n/a | Wed 16:30–17:45, or 20:00 before M2 | **About 30 min, steps from the planning session** |
| M2 | The corpus pack committed with manifest and hashes; extractors, chunker, sentence splitter, Voyage client, versioned ingest; semantic and keyword search; the real corpus ingested into Sandbox | `m2-ingest` → `sandbox` | Wed 7 Oct, about 16:30–18:00 (it ran in the afternoon, before class) | **Start the session, approve its plan, merge** |
| M3 | Agent loop (Fable designs it in plan mode, Sonnet builds it), NDJSON stream, citation check, three-column UI, example questions, limits and budgets, upload, cleanup cron, environment badge; deployed to the Sandbox preview | `m3-agent` → `sandbox` | Thu 8 Oct 08:30–12:30 | **Start the session, review, merge** |
| ★ | **FIRST CUT:** M1–M3 on the Sandbox preview URL with the real corpus | | **Thu 8 Oct ~13:00** | **Walk-through 13:00–16:00 with same-day fixes; apply Thu evening** |
| Fix | First-cut hardening and portfolio quick wins, from the walk-through and the validate review: a $0.10 budget reservation per question, a 100,000-token upload cap with per-batch embedding debits, a cross-site write guard, one server log line per run, interface fixes (status line, rendered Markdown in excerpts, labelled scores, header and footer links, favicon, Open Graph tags), the README, and an hourly Sandbox cleanup workflow | `fix/first-cut` → `sandbox` | Thu 8 Oct | **Review and merge; switch the default branch to `sandbox`; run `cleanup.yml` once by hand** |
| Polish | Second validate pass fixes: a neutral "no citations" badge, AnswerPanel tests (T5), <sup> in Markdown excerpts, the README spend line, and a concurrency group in cleanup.yml that re-registers its schedule | `fix/sandbox-polish` → `sandbox` | Fri 9 Oct | **Review and merge; confirm a scheduled cleanup run** |
| M4 | Eval set (12–15 questions), `npm run eval` (hit@1/3/5, MRR), CI job with a pgvector service, job-summary table, threshold set from the first run | `m4-evals` → `sandbox` | Mon 12 Oct | **About 1.5 h of sessions plus review** |
| M5 | Neon QA and production projects; GitHub Environments with production gated on Paul's approval; Vercel env scoping and `git.deploymentEnabled.master: false`; `pipeline.yml` (migrate, then ingest; production migrate, then deploy), plus QA in `cleanup.yml`, the GitHub Actions trigger for `/api/cron/cleanup` that the fix PR adds for Sandbox, because Vercel runs cron jobs on production only; first promotion sandbox → qa → master | `m5-environments` → `sandbox`, then promotion PRs | Mon 12 – Tue 13 Oct | **About 40 min of setup, plus the approvals in each promotion** |
| M6 | README (architecture, running locally, "Local secrets" with `<!-- yanshuf-secrets -->`), demo script, responsive and Lighthouse pass, Claude PR review (`/install-github-app`) | `m6-readme` → `sandbox` → promotion | Tue 13 – Wed 14 Oct | **Final walk-through Wed 14 Oct** |

The full set is due Wed 14 Oct, with Thu 15 as buffer. Sunday 11 is TriviaFoundry's launch, so nothing is planned here that day.

**Wednesday 7 October had no class,** so S1 was done by 15:45 and M2 started straight after; M3 can follow the same evening. The first cut is due on Thursday 8 October in the morning, leaving the afternoon for Paul's walk-through and the application.

Until the first promotion in M5, `master` holds only the chain. The first cut lives on `sandbox`, the integration branch. Vercel builds `master` as production when the project is imported in S1; that build fails harmlessly, because `master` has no app yet. The Dependabot PRs for the Python code (#1–#8) close when M1 merges, the same day the code leaves (a.3).

## Files that change
- **Removed** (kept at tag `python-prototype`): `rag/`, `tests/`, `data/`, `docs/decisions/`, `pyproject.toml`, `pytest.ini`, `requirements.txt`, `requirements-dev.txt`, `.github/workflows/ci.yml` and `.github/dependabot.yml` (both replaced), `.env.example` (replaced). The untracked `.venv/`, `.mypy_cache/` and `.ruff_cache/` folders are deleted from disk.
- **App:**
  - `app/layout.tsx`, `app/page.tsx`, `app/icon.svg`, `components/*`
  - `app/api/{ask,upload,documents,documents/[id],health,cron/cleanup}/route.ts`
- **Library:**
  - `lib/{env,db,embed,search,limits,pricing}.ts`
  - `lib/{corpus,manifest,documents,session,upload,api,deps,run-state,inline-markdown,utils}.ts`, the test helpers `lib/{fake-embedder,test-pdf}.ts` and `lib/agent/test-setup.ts`, and the upload fixture `lib/fixtures/acme-pay-terms.pdf`
  - `lib/ingest/{extract,chunk,index}.ts`
  - `lib/agent/{loop,tools,prompt,sentences,citations}.ts`
- **Data:**
  - `db/migrations/0001_init.sql`
  - `corpus/manifest.json`, `corpus/files/*` (committed), plus the Mojaloop `LICENSE.md` (the repository ships no NOTICE)
  - `evals/questions.json`
- **Scripts:** `scripts/{migrate,corpus-fetch,ingest-corpus,retrieval-check,smoke-sql,eval}.ts`
- **Pipelines:** `.github/workflows/{ci,cleanup,evals,pipeline}.yml`, `.github/dependabot.yml`
- **Agent setup:** `AGENTS.md`, `CLAUDE.md`, `REVIEW.md`, `.claude/settings.json`, `.claude/hooks/{no-placeholders,production-gate}.mjs`, `.claude/agents/{verifier,architect}.md`
- **Config and docs:** `package.json`, `package-lock.json`, `tsconfig.json`, `eslint.config.mjs`, `vitest.config.ts`, `postcss.config.mjs`, `app/globals.css`, `vercel.json`, `.env.example`, `.gitattributes`, `.gitignore`, `.worktreeinclude`, `README.md`, `docs/screenshot.png`. Scripts run through `tsx` with `--env-file-if-exists=.env.local`.

## Schema delta
From nothing to the spec's four tables:
- `schema_migrations`, created by `scripts/migrate.ts`;
- `documents`, `chunks` and `usage_windows`, created in `0001_init.sql`, along with the `vector` extension and the HNSW and GIN indexes.

## Model split
- **Claude Code, Sonnet 5.5, the build default:** implements M1–M6 from this plan. Its coding scores match Fable's on published benchmarks; it's faster, and it follows a tight spec literally.
- **Claude Code, Fable 5.1, the judgement steps:**
  - plan-mode reviews of the spec and of each milestone's approach;
  - the design of M3's agent loop and citation check (plan mode first, then Sonnet implements);
  - the verifier pass before each PR;
  - any problem where the same test fails two cycles running.

  A session can't change its own model, so this runs two ways:
  - The main session stays on `sonnet`, and each prompt's first line says when Paul should switch with `/model fable` for a review step.
  - The `verifier` and `architect` subagents carry `model: fable` in their frontmatter, so they run on Fable whenever the Sonnet session calls them. `AGENTS.md` tells the session to call `verifier` before every PR, and `architect` after the same test fails twice.

  Fable has its own weekly allowance on Paul's Max plan (separate from the main limit; usage credits off), so splitting the work spreads it across two limits. The constraint block's "Target Model: Fable 5.1" line stays verbatim, and its rules apply to both models.
- **App runtime:** Claude Sonnet 5.5 for the agent ($2 / $10 per M tokens); Voyage `voyage-4` for embeddings.

## Proof
- **M1:**
  - `npm run lint`, `npm run typecheck`, `npm test` and `npm run build` pass locally and in CI.
  - Tests show `0001_init.sql` applied through `scripts/migrate.ts` on PGlite via `Db`, a cosine query on a 1024-dim vector returning the nearest row, and env validation rejecting an `ANTHROPIC_MODEL` missing from `lib/pricing.ts`.
  - Each hook has been triggered once on purpose and blocked: a `TODO` comment in code, and `git push --dry-run origin HEAD:sandbox` (a dry run, so nothing moves even if the hook failed).
- **M2:**
  - Tests show:
    - every committed corpus file matches its manifest hash;
    - no chunk exceeds 600 estimated tokens;
    - every PDF chunk carries `p. N`;
    - the sentence splitter keeps "12 C.F.R. 1005.31" and "§ 1005.33(a)" in one block, and its blocks rejoin to the chunk text;
    - a second ingest at the same version changes nothing, while a version bump replaces the rows;
    - semantic and keyword search find the expected fixture chunk.
  - The real corpus is in Sandbox, with each document's pages, chunks and Voyage tokens printed and no truncation errors.
- **M3:**
  - Citation-check tests pass on valid citations across two rounds (a global index), and fail on an out-of-range index, an altered sentence, and a chunk from outside the run. Every failure shows as unchecked.
  - Loop tests cover `refusal`, `max_tokens` and the forced final call with `tool_choice: none`.
  - Limit tests: the 16th question in an hour gets a 429 with its reset time, and a question after the daily budget is spent is refused.
  - On the Sandbox preview, each of the four example questions gives at least one checked citation and none unchecked, and the steps stream live.
  - A small PDF upload is answerable, and the cleanup job removes it.
- **First cut:** Paul's walk-through on the preview with the real corpus. Measured cost and latency per question replace the spec's estimates.
- **Fix PR:**
  - Tests show the budget reservation (one of ten simultaneous questions starts with $0.85 spent, and the window holds exactly the actual cost after every kind of run), the upload cap and the per-batch debit, the cross-site guard on each write route, and one log line per run.
  - On the preview, `/api/health` reports Sandbox, a foreign `Origin` and `Sec-Fetch-Site: cross-site` get 403, a 500 KB text upload gets a 413, and the Mojaloop example shows rendered Markdown, labelled scores, the status line and a checked citation with no console error or 404.
- **M4:**
  - The job summary shows hit@1, hit@3, hit@5 and MRR.
  - A branch that breaks retrieval on purpose fails the job.
- **M5:**
  - One change travels sandbox → qa → master.
  - Sandbox and QA builds migrate before building.
  - The production pipeline waits for Paul's approval, migrates, then deploys.
  - `/api/health` reports a different database in each environment.
- **M6:**
  - The README renders on GitHub.
  - Lighthouse scores at least 90 for performance and accessibility on production.
  - The 5-minute demo has been rehearsed once end to end.

## Risks
1. **M3 slips past Thursday morning:** the walk-through and the application move to Thursday afternoon; the planning session flags it as soon as it's clear.
2. **Voyage rate limits:** the account now has a payment method, so `voyage-4` runs at the standard limits (2,000 requests and 8M tokens a minute) and the 200M free tokens still apply. Without a card the limits were 3 requests and 10K tokens a minute (Voyage's 429 reply says so), which stretched M2's first ingest to about 25 minutes; with the card, a full ingest of the 0.18M-token corpus takes about a minute. Ingest keeps exponential backoff on 429s. A question's query embedding makes one attempt with a 5 s deadline and falls back to keyword search (spec feature 6). The app's 2M-token daily embedding budget and the $5 project alert are the only spend controls, because Voyage has no hard cap.
3. **A corpus source refuses scripted downloads:** Paul downloads it once in a browser into `corpus/files/`, and the hash goes into the manifest.
4. **Multi-call agent latency on Vercel:** `maxDuration` of 120 s (Pro allows up to 800), streaming so progress is visible, and the round cap.
5. **PDF extraction on the CFPB guide's tables:** inspect the extracted text in M2 and adjust the packing and the splitter's table-row rule.
6. **Claude answers without citing:** the system prompt requires citations, the answer header shows the checked count, and the first-cut walk-through tests it.
7. **Next.js 16.4.0 is one day old:** pinned exactly, with 16.3.x as the fallback. TypeScript stays on `~5.9.3` (patch updates only), because npm's `latest` is the 7.x Go compiler; Dependabot ignores TypeScript majors.
8. **Neon cold start after 5 idle minutes:** about a second on the first query. Acceptable for a demo.
9. **Windows specifics:** hooks run as Node scripts under Git Bash with `CLAUDE_CODE_USE_POWERSHELL_TOOL=0`, and `.gitattributes` pins LF.
10. **Scheduled workflows stop after 60 idle days:** GitHub disables a repository's schedules after 60 days without activity, so cleanup.yml would stop silently. Any push keeps them alive; M5's pipeline will.

## Rejected alternatives
- **Finishing the Python prototype:** the posting asks for Node.js and React, and the prototype's design flaws go deeper than a fix.
- **Vercel AI SDK, LangChain or LlamaIndex:** they hide the loop an interviewer wants to read, and the hand-written loop is small.
- **Prompted `[source: file p. N]` markers parsed out of the text:** native search-result citations give sentence-level spans that code can check mechanically.
- **A separate vector database:** pgvector keeps vectors beside the relational data, with one fewer service and bill.
- **A local embedding model:** the brief prefers an API provider, and serverless cold starts make a local model slow.
- **A re-ranker:** not now; hit@k will show whether one is needed.
- **Building in a cloud session:** the build runs in Claude Code on Paul's machine, as his workflow sets out.
- **Fable 5.1 or Opus 5.5 for the whole build:** slower and heavier on limits, for no measured coding gain over Sonnet 5.5 on a tight spec. Fable is kept for the judgement steps.
- **`@electric-sql/pglite-socket` in tests (a.1):** it would hide the storage interface the intent carries over. The `Db` interface with two drivers is smaller and shows the idea.
- **Corpus files in a GitHub Release asset, Vercel Blob or an Actions artifact (a.4):** an extra moving part for about 5 MB. Committing them keeps every checkout, CI run and eval reproducible.
- **Supabase for the three environments (c, D1):** the direct host is IPv6-only, free projects pause after a week idle, and QA plus production on Pro costs about $35 a month. Neon Free does the job at $0. The session-pooler rule stays in the spec in case D1 changes.
- **Lowering the global question cap instead of a cost budget (c):** a question cap doesn't track what is actually spent. A daily cost budget, fed from each response's `usage`, does.
- **A Vercel protection bypass token for previews (c):** interviewers would need a special link. Protection off is simpler for a public demo whose limits already protect the keys.
- **Accepting broken feature previews until merge (b.11):** a feature preview that fails against the old schema can't be reviewed. Additive migrations applied at preview build time keep every preview working.
- **Vercel auto-deploying production on merge (b.12):** new code could reach the old schema while the migration waits for approval. The pipeline migrates first, then deploys.
- **Forced `tool_choice` (`any` or `tool`) for the final round (b.5):** it returns a 400 on Sonnet 5.5. `none` forces the answer instead.
- **Adaptive thinking with `display: "updates"` (b.5):** it needs a beta header. `between_tools` is generally available on Sonnet 5.5 and gives the same progress updates without up-front thinking.
- **Storing sentence blocks (b.2):** the splitter is deterministic, so recomputing the blocks from the stored chunk keeps the schema minimal and the check honest.
- **`chunks.tokens` (d):** nothing reads it once Voyage's `usage` feeds the ingest report.

## Appendix: M1 guardrail files (b.13)
**`AGENTS.md`** (under one page):
- **Commands** from the repo root, each with a line of healthy output:
  - `npm run dev`
  - `npm run lint` (ESLint CLI)
  - `npm run typecheck` (`tsc --noEmit`)
  - `npm test` (Vitest)
  - `npm run build`
  - `npm run migrate` (Sandbox via `.env.local`)
  - `npm run corpus:fetch`
  - `npm run ingest:corpus`
  - `npm run eval`
- **Before reporting done:** run lint, typecheck, test and build, and paste the output. Fix the code, not the test.
- **Branches:** work on `m<N>-<slug>` or `fix/<slug>`, branched from `sandbox`. Push only with `git push -u origin <that branch>`, and open PRs into `sandbox`. Never push to `sandbox`, `qa` or `master`; never merge; never deploy. Promotion PRs are Paul's.
- **Migrations:** each change gets a new file, additive and safe for the code already deployed. Never edit an applied migration.
- **SQL:** goes through `Db` only, with `$n` parameters.
- **Secrets:** never read `.env`, `.env.local` or `.env.*.local`. `.env.local` holds Sandbox credentials only; QA and production credentials never come to this machine.
- **Citations:**
  - Never display a file or page taken from model text.
  - Check citations block by block, never `cited_text` as one string.
  - Never send forced `tool_choice` to Sonnet 5.5, and keep effort at `high` or below with `between_tools`.
- **Subagents:** call `verifier` before opening any PR and paste its report in the PR. Call `architect` when the same test fails two cycles running.
- When reviewing a pull request, apply `REVIEW.md`.
- **Known agent mistakes:**
  - installing TypeScript 7 (pin `~5.9.3`);
  - using `next lint`;
  - bumping `@electric-sql/pglite` without `@electric-sql/pglite-pgvector`;
  - connecting migrations through a pooled transaction endpoint;
  - retrying or working around a destructive command blocked by Paul's user-level GateGuard hook (`git rm -r`, `rm -rf`, `Remove-Item -Recurse`): give Paul the exact command, folder and window, and wait.

`AGENTS.md` also keeps the `nextjs-agent-rules` block that `next dev` writes and re-adds: a pointer to the version-matched Next.js docs in `node_modules/next/dist/docs/`.

**`CLAUDE.md`:** `@AGENTS.md`, followed by the constraint block below, verbatim.

**`REVIEW.md`:**
```markdown
# Review instructions

Tag every finding with its pass and a severity: Important or Nit.

## Passes
- Bugs: logic errors, edge cases, regressions; citation index mapping across rounds; limit and budget arithmetic; ingest versioning.
- Security: secrets reachable from client code, input validation at every route, IP hashing with the secret, the document-text-is-data guard intact, limits checked before any model call.
- Chain compliance: the diff matches spec.md and plan.md; flag anything built that neither mentions.
- Fixed rules: no placeholders or stubbed handlers, no speculative tables or columns, migrations additive, no forced tool_choice, an unchecked citation never shown as checked.

## Severity
Important = breaks behaviour, leaks data or secrets, or breaks a fixed rule.
Everything else is a Nit.

## Limits
At most five nits; summarise the rest as a count.
Skip generated files and anything lint or CI already enforces.
```

**`.claude/settings.json`:**
- `env`: `CLAUDE_CODE_USE_POWERSHELL_TOOL=0`.
- `permissions.defaultMode`: `default`.
- **Deny:**
  - `Read(./.env)`, `Read(./.env.local)`, `Read(./.env.*.local)`;
  - `Bash(gh pr merge *)`;
  - `Bash(git push * master)`, `Bash(git push * main)`, `Bash(git push * sandbox)`, `Bash(git push * qa)`.
- **Allow:**
  - `git status`, `git diff *`, `git log *`, `git add *`, `git commit *`, `git switch *`, `git fetch *`;
  - `git push -u origin m*`, `git push -u origin fix/*`;
  - `npm run *`, `npm test`, `npx vitest *`.
- **Hooks:** a PostToolUse hook on `Edit|Write|MultiEdit` runs `no-placeholders.mjs`; a PreToolUse hook on `Bash|PowerShell` runs `production-gate.mjs`.

**`.claude/hooks/no-placeholders.mjs`:** as in the vibe-coding-mvp-workflow skill (Phase 3a step 4).
- It checks only the added text of `.ts`, `.tsx`, `.js`, `.mjs` and `.sql` files.
- It fails with exit 2 on a `TODO`/`FIXME` comment, `not implemented` or `implement later`.

**`.claude/hooks/production-gate.mjs`:** as in the skill, with quoted text ignored, extended to:
- block `git push` to `master`, `main`, `sandbox` or `qa`, whether named explicitly or as a bare push or `HEAD` push while on one of those branches;
- block `gh pr merge`;
- block `vercel` with `--prod`, `promote`, `rollback` or `alias`;
- block any command that sets `VERCEL_ENV=production`.

The message tells the agent to push a named branch and open a PR.

**`.claude/agents/verifier.md`:**
- **Frontmatter:** `model: fable`; tools `Bash`, `Read`, `Grep`, `Glob`.
- **What it does:**
  - runs lint, typecheck, test and build;
  - from M3 on, starts the app and exercises the changed flow at 1280 and 390 px with Playwright;
  - compares results with the Proof section of `plan.md` and with `spec.md`;
  - reports the commands, their output and every mismatch.
- **Limits:** it edits nothing.

**`.claude/agents/architect.md`:**
- **Frontmatter:** `model: fable`; tools `Read`, `Grep`, `Glob`, `Bash`.
- **When it's used:** after the same test fails twice, and for M3's agent-loop design.
- **What it does:** reads the failing output and the relevant code, then returns a diagnosis and a numbered fix plan.
- **Limits:** it edits nothing.

**Also in M1:**
- **`.gitattributes`:** `* text=auto eol=lf`.
- **`.gitignore`:** `node_modules/`, `.next/`, `.env`, `.env*.local`, `.claude/worktrees/`, `.claude/settings.local.json`, `coverage/`, `next-env.d.ts`, `*.tsbuildinfo` (generated by `next build` and incremental `tsc`).
- **`.worktreeinclude`:** `.env.local`.
- **`.env.example`:** key names, with safe defaults `ANTHROPIC_MODEL=claude-sonnet-5-5`, `DAILY_ANTHROPIC_BUDGET_USD=1.00` and `APP_ENV=local`; every other value blank.
- **`lib/env.ts`:** validates eight runtime variables (`DATABASE_URL`, `VOYAGE_API_KEY`, `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`, `DAILY_ANTHROPIC_BUDGET_USD`, `IP_HASH_SECRET`, `CRON_SECRET`, `APP_ENV`). `MIGRATION_DATABASE_URL` is read only by `scripts/migrate.ts`, never by the app. A blank value fails validation; blank is not unset.
- **`vercel.json`:** `regions: ["fra1"]` and `git.deploymentEnabled.master: false`. The second takes effect only once M5 promotes it to `master`, so production deploys come from the pipeline from the start.
- **`ci.yml`:** on every PR and on pushes to `sandbox`, `qa` and `master`, runs `npm ci`, lint, typecheck, test and build. It runs on Node 24, which Vercel uses too.
- **`dependabot.yml`:** weekly npm updates, with the two PGlite packages in one group and TypeScript major versions ignored, and weekly GitHub Actions updates.
- **Home page in M1:** the app name, a one-line description, the environment badge, and links to the intent, spec and plan on GitHub.

## CLAUDE.md constraint block (verbatim, from the planning brief)
```
[CRITICAL DESIGN & LANGUAGE CONSTRAINTS]
Target Model: Fable 5.1

1. Output Format: Start directly with the code block. Omit all introductory text, markdown explanations, and post-code summaries. The only text after the code is a two-line footer: files touched, and the test/build result.
2. Zero Commentary: Remove all inline comments, JSDoc, XML documentation, and headers unless a line uses an entirely opaque hack.
3. Failure Handling: Never swallow exceptions. Validate inputs at the edge (request handlers, external-API and payment boundaries); let everything else throw. No speculative try/catch, no catch-log-and-continue.

4. Stack-Specific Rules:
   - React / Next.js: Write compact, idiomatic functional components. Prefer short-circuiting (&&) and ternary operators for conditional rendering unless nesting hurts readability. Do not split logic into premature custom hooks or isolated helper functions unless explicitly requested. Avoid verbose inline styles or excessive nested divs.
   - Node.js: Use modern, dense ES module syntax (async/await, object destructuring, optional chaining). Strip out speculative, multi-layered try/catch middleware or verbose logging blocks. Focus strictly on the happy path execution, subject to rule 3.
   - .NET: Use modern C# features to minimize lines (e.g., file-scoped namespaces, top-level statements, primary constructors, expression-bodied members, and LINQ). Prefer not to generate heavy interface abstractions, separate DTO mappings, or boilerplate setup code unless the prompt explicitly demands them or a type has more than one consumer.
```
