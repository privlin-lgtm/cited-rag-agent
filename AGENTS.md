# AGENTS.md

cited-rag-agent: a Next.js 16 app, agentic RAG with checked citations. The build brief is `intent/2026-10-07-mvp/` (`intent.md`, `spec.md`, `plan.md`). Read the plan's Proof section for the milestone you are on.

## Commands
Run from the repo root.
- `npm run dev`: Next dev server. Healthy: `✓ Ready in <n>ms` and `http://localhost:3000`.
- `npm run lint`: ESLint CLI. Healthy: no output, exit 0.
- `npm run typecheck`: `tsc --noEmit`. Healthy: no output, exit 0.
- `npm test`: Vitest. Healthy: `Test Files  N passed (N)` and `Tests  N passed (N)`.
- `npm run build`: `next build`. Healthy: `✓ Compiled successfully`, then the route table.
- `npm run migrate`: applies pending `db/migrations/*.sql` to Sandbox through `.env.local`. Healthy: `applied 0001_init.sql` or `nothing to apply`.
- `npm run corpus:fetch`, `npm run ingest:corpus`, `npm run eval`: arrive in M2 and M4. They do not exist yet.

## Before reporting done
Run lint, typecheck, test and build, and paste the output. Fix the code, not the test.

## Branches
- Work on `m<N>-<slug>` or `fix/<slug>`, branched from `sandbox`.
- Push only with `git push -u origin <that branch>`, and open PRs into `sandbox`.
- Never push to `sandbox`, `qa` or `master`. Never merge. Never deploy. Promotion PRs are Paul's.

## Migrations
Each change gets a new file, additive and safe for the code already deployed. Never edit an applied migration.

## SQL
Goes through `Db` (`lib/db.ts`) only, with `$n` parameters.

## Secrets
Never read `.env`, `.env.local` or `.env.*.local`. `.env.local` holds Sandbox credentials only; QA and production credentials never come to this machine.

## Citations
- Never display a file or page taken from model text.
- Check citations block by block, never `cited_text` as one string.
- Never send forced `tool_choice` to Sonnet 5.5. Keep effort at `high` or below with `between_tools`.

## Subagents
Call `verifier` before opening any PR and paste its report in the PR. Call `architect` when the same test fails two cycles running.

## Reviews
When reviewing a pull request, apply `REVIEW.md`.

## Known agent mistakes
- Installing TypeScript 7. Pin `~5.9.3`.
- Using `next lint`. It is gone in Next 16; use `npm run lint`.
- Bumping `@electric-sql/pglite` without `@electric-sql/pglite-pgvector`.
- Connecting migrations through a pooled transaction endpoint.
- Retrying or working around a blocked destructive command. `git rm -r`, `rm -rf` and `Remove-Item -Recurse` are blocked by Paul's user-level GateGuard hook. Do not retry or work around it: give Paul the exact command, the folder and the window to run it in, and wait.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
