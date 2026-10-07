# Intent: cited-rag-agent — agentic RAG with checked citations
Author: Paul Rivlin (drafted with Claude) · Source: idea · Status: accepted
Started: 2026-10-07 · Lane: major (the MVP; new AI features)

## Problem
Payoneer's Forward Deployed Engineer role (Herzliya, hybrid; Greenhouse job 8258246, posted 2026-10-06) asks for "practical experience with AI and LLM platforms, agentic workflows, and retrieval-augmented generation (RAG)", "a solid command of version control, pipelines, and multi-environment release management", Node.js and React. Paul's CV meets the role except the RAG and agentic line, which it deliberately does not claim.

His only RAG work is this repo's first version: a Python command-line prototype built on 2026-08-30 (tag `python-prototype`). It has never run on real documents. It cites whole files and nothing checks the citations. It chunks at 1,000 words while its embedder (all-MiniLM-L6-v2) reads about the first 200, so most of every chunk is never embedded.

## Proposed outcome
A public web app, and a public repo that shows how it was built.

In the app, someone can:
- pick documents from a public, licence-checked demo corpus, or upload a small md, pdf or txt file of their own;
- ask a question in plain language;
- watch an agent (Claude using tools) decide what to search, refine the query and fetch more context, one visible step at a time;
- get an answer in which every citation names a file and page, has been checked against the chunks retrieved in that run, and sits beside the excerpt it came from.

In the repo, a reader can follow the path from business requirement to release: this intent, the spec and plan, reviewed PRs, CI running an eval set that reports retrieval hit rate at k, and three environments (Sandbox, QA and production, the posting's own names), each with its own database and promoted through branches and pipelines.

The app has to carry a 5-minute interview screen-share: pick or upload documents, ask, watch the steps, read the checked answer, then show the repo, the environments and the eval run. That story should work from the first cut and grow from there.

## Affected users and systems
- Primary: Payoneer's interviewers, watching the demo or opening the link and the repo. Secondary: other employers and Yanshuf Studio clients.
- This repo: the Python prototype's repo (public) becomes the TypeScript app's home, renamed `cited-rag-agent`. The prototype stays reachable at the tag `python-prototype` and in the history; its code leaves the tree through a PR, and its open Dependabot PRs close with it.
- New: a Vercel project on Paul's existing Pro account; Postgres with pgvector, one database per environment; the Anthropic API; one embeddings API.
- Must stay untouched: Paul's existing Supabase project and his Vercel projects (TriviaFoundry, Or Zarua). Supabase bills per organisation, so a plan change there needs checking first.

## Constraints
- Node.js, TypeScript and React (Next.js), as the posting names.
- Chunks are sized for the embedder, and nothing is ever truncated silently: an over-length input fails loudly.
- Carried over from the prototype: document text is data, never instructions (prompt-injection guard); storage behind a small interface; the chunk-size-versus-embedder lesson.
- A citation is shown as checked only when every sentence it cites is found in the stored text of a chunk that was sent to Claude in that run. The file and page shown come from that chunk in the database, never from the model's text.
- The demo corpus is public and licence-checked, and contains none of Paul's own files. Payments or fintech material is preferred.
- Money: free tiers where they do the job. Supabase Pro is pre-approved if needed, but only after checking its effect on the whole organisation and stating the monthly total. Vercel Pro is already paid. Every API key gets a spend cap before first use. Anything else that costs money goes to Paul with its price first.
- The public demo protects Paul's keys: rate limits, upload limits, and caps on agent steps and tokens.
- The agent never merges or deploys to production. It pushes named branches and opens PRs; Paul's merge is the release.
- No secrets in git or chat. Local .env files go into Paul's encrypted secrets archive; the README has a "Local secrets" section with the marker `<!-- yanshuf-secrets -->`.
- The repo's CLAUDE.md carries Paul's constraint block (target model, zero commentary, fail loudly, compact React and Node).
- Paul's time goes on decisions, gates, reviews and the final walk-through. He works Sunday to Thursday, nothing from Friday afternoon to Saturday night or on a chag; TriviaFoundry launches Sunday 11 October.
- Nothing is claimed on the CV or in the application until it has run on the real demo corpus and Paul has seen it work.

## Out of scope
OCR for scanned PDFs; MongoDB; user accounts beyond what a public demo needs; porting or finishing the Python code (only its lessons carry over); model fine-tuning; mobile apps; payments.

## Open questions
1. Where the three databases live: Supabase Pro (monthly total, effect on the existing organisation) or a free alternative. Proposed in `spec.md` as decision D1.
2. Uploads on the public production deployment: open with limits, or Sandbox only? Proposed in `spec.md` as decision D6.

Settled on 2026-10-07:
- repo `cited-rag-agent`, public, built in this repo;
- demo corpus: the cross-border payments pack (CFPB remittance-rule guide and examination procedures, the Regulation E remittance-transfer rule text, EU PSD2, Mojaloop API docs), each licence recorded beside the file;
- embeddings: Voyage `voyage-4` ($0.06 per million tokens after 200 million free; no card on the account, so spend is capped at $0).

## Success measure
- First cut (target: Thursday 8 October, evening): on a preview URL and running on the real demo corpus, documents are ingested and retrieved through pgvector, the agent's steps are visible, and the answer carries file-and-page citations, all checked, with excerpts beside it. Paul has walked through it.
- Full set: an eval set of 10 to 15 questions reports retrieval hit rate at k in CI; Sandbox, QA and production each have their own database, with promotion by PR between branches and pipelines that apply migrations; the README covers architecture, running locally and local secrets.
- The 5-minute demo runs end to end with no edits on the day.
- No citation is ever shown as checked when it isn't.
- Spend stays inside the caps, with no unannounced charges.

## Where the rest of the chain lives
This intent supersedes the planning brief of 2026-10-07 (planning handoff item 92) and, for this repo, the Python prototype's README and its decision records in `docs/decisions/` (kept at the tag `python-prototype`). The spec and plan follow in this folder as `spec.md` and `plan.md`. `review-2026-10-07.md`, in the same folder, is the build session's review of their first drafts, and both were revised against it.
