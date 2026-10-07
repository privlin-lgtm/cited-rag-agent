# cited-rag-agent

Agentic RAG with checked citations. A Claude agent searches a licence-checked cross-border payments corpus, shows each step it takes, and every citation in its answer is checked against the stored chunk text before it is shown as checked.

**Status:** M1, scaffold and guardrails. The app is a home page and `/api/health`. Ingest, search and the agent arrive in M2 and M3. The full README comes in M6.

## The chain

- [Intent](intent/2026-10-07-mvp/intent.md)
- [Spec](intent/2026-10-07-mvp/spec.md)
- [Plan](intent/2026-10-07-mvp/plan.md)
- [Review of the first spec and plan drafts](intent/2026-10-07-mvp/review-2026-10-07.md)

The Python prototype this repo started as is kept at the tag `python-prototype`.
