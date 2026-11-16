# Spike: cache-augmented generation (CAG) against RAG, 16 Nov 2026

**Result: keep RAG.** Loading the whole corpus into a cached prompt answered as well as retrieval, but it costs more per question: $0.053 warm and $1.08 cold, against $0.041 for RAG. The demo's visitors are far apart, so most questions would be cold.

## What was compared

Both arms answered the 14 questions in [evals/questions.json](../../evals/questions.json) with `claude-sonnet-5-5`, the app's prompt and its citation check.

- **RAG:** the app as it is, with search tools.
- **CAG:** no tools. All 792 corpus chunks were sent as `search_result` blocks at the top of the first message, with `cache_control` on the last one. That is 428,415 input tokens by `messages.count_tokens`, with 5,835 sentence blocks.

The code lives on the unmerged spike branch `spike/cag-baseline` (PR #61): `npm run cag:count` and `npm run eval:answers -- --arm rag|cag`.

## Results

| Measure | RAG | CAG |
| --- | --- | --- |
| Right source cited | 13/14 | 14/14 |
| Citations that pass the check | 127/127 | 156/156 |
| Answers right / partly / wrong | 13 / 1 / 0 | 13 / 1 / 0 |
| Cost per question | $0.041 | $1.077 cold, $0.053 warm |
| Median latency | 9.3 s | 7.6 s |

The two arms differed on two questions. On `table-small-sender-domestic`, RAG's retrieval missed the compliance guide's example on p. 17, so its answer hedged the key point; CAG quoted it. On `wrong-account-number`, CAG's answer had a heading that implied a refund is owed when recovery fails, which contradicts §1005.33(h); RAG's answer was correct.

## Decision rule (set before the run)

CAG would replace RAG for the fixed corpus only if it passed all three conditions.

| Condition | Result |
| --- | --- |
| At least as correct on every question | Not met (wrong-account-number) |
| Lifts right-source or citation pass rate | Met (14/14 against 13/14) |
| Warm question costs $0.05 or less | Not met ($0.053) |

A cold question costs about 11 times the demo's $0.10 budget hold, so CAG would also need a larger hold or a cache kept warm.

## Caveats

- Each arm ran once, on 14 questions.
- The answers were marked by Claude against the corpus, not by a person.
- The CAG arm reused the app's prompt, which mentions search tools.
- Per-sentence `search_result` blocks roughly double the corpus tokens. A cheaper CAG request with one block per chunk would need a different citation check.

## Follow-ups

- RAG's miss on `table-small-sender-domestic` is a retrieval gap worth fixing in the app.
- The spike also found that `lib/pricing.ts` logged Sonnet 5.5 cache reads at $0.20 per MTok instead of $0.10 (fixed in PR #60).
