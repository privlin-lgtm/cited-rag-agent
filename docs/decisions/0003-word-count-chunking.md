# 3. Word-count chunking

## Context

Documents need to be split into chunks small enough to embed meaningfully and to fit inside the
LLM's context window when retrieved, with enough overlap between consecutive chunks that a fact
sitting near a chunk boundary isn't cut in half and lost from both neighboring chunks.

Options considered:

- **Fixed-size character chunking**: split every N characters. Cheapest to implement, but splits
  mid-word constantly and has no relationship to how the embedding model or the LLM actually
  tokenizes text.
- **Token-aware chunking**: split by the embedding model's or LLM's actual tokenizer (e.g.
  `tiktoken`), so chunk sizes map precisely to the model's context window. More accurate, but adds
  a tokenizer dependency and couples the chunker to a specific model's tokenization scheme.
- **Semantic chunking**: split at sentence/paragraph boundaries, or use an embedding-similarity-based
  splitter that groups semantically related sentences together. Produces the most coherent chunks,
  but is meaningfully more complex (needs sentence segmentation, and similarity-based variants need
  their own embedding calls just to decide where to split) and is the kind of complexity this
  project doesn't need yet.
- **Word-count chunking with overlap** (`rag/ingest.py:chunk_text`): split every N words, stepping
  by `chunk_size - overlap` words at a time.

## Decision

Word-count chunking with a configurable `chunk_size`/`overlap` (defaults 1000/200 words), validated
so `overlap < chunk_size` (see the `ValueError` guards in `chunk_text` -- added after a review found
that an invalid combination silently produced a near-duplicate chunk per word instead of failing
loudly).

## Consequences

- No tokenizer dependency, no coupling to a specific embedding/LLM model's tokenization -- `split()`
  and `join()` are all it takes, which keeps `rag/ingest.py` dependency-free and trivially testable
  (see `tests/test_ingest.py`'s `chunk_text` boundary tests, none of which need a real tokenizer or
  model).
- Word count is a rough proxy for token count (roughly 0.75 tokens per word for English text), so
  the actual token size fed to the embedding model/LLM varies somewhat by document -- this is an
  approximation, not a precise context-window budget.
- Chunks can still split mid-sentence, which is the main quality ceiling of this approach: a fact
  spanning a chunk boundary is only preserved by the overlap window, not by any awareness of
  sentence structure. If retrieval quality becomes a real problem in practice, the next step up is
  sentence-boundary-aware splitting (e.g. via a lightweight sentence tokenizer) before reaching for
  full semantic chunking, which is unlikely to be worth its added complexity at this project's scale.
