# 2. ChromaDB for local vector storage

## Context

This is a single-user, local-first CLI tool -- there's no server to deploy, no multi-tenant access,
and the target scale is one person's personal document collection (hundreds to low thousands of
files), not a production search service. The vector store needs to persist embeddings to disk
between runs and support similarity search with metadata filtering (to implement per-source
deletion for the stale-chunk-cleanup behavior in `KnowledgeBase.add_chunks`).

Options considered:

- **Chroma**, embedded/local mode (`PersistentClient`): runs in-process, persists to a local
  directory (SQLite + a vector index under the hood), no server to run or configure.
- **FAISS**: a similarity-search *library*, not a database -- it has no built-in persistence,
  metadata storage, or filtered-delete support. Using it would mean hand-rolling an ID-to-metadata
  mapping and a save/load scheme on top of it, essentially rebuilding a thin slice of what Chroma
  already provides.
- **Pinecone / Qdrant (managed or self-hosted server)**: real production-grade vector databases,
  but require either a network dependency (Pinecone: an API key and a cloud account) or standing up
  a server process (Qdrant self-hosted) -- both wrong for a tool meant to run entirely offline on
  one person's laptop with `pip install` as the only setup step.

## Decision

Use Chroma's embedded `PersistentClient` mode, wrapped behind the `VectorStore` protocol so the
choice isn't load-bearing elsewhere in the codebase (see
[0001](0001-protocol-based-dependency-injection.md)).

## Consequences

- Zero infrastructure: `pip install`, then `PersistentClient(path=...)` -- no server, no account,
  no network dependency for storage itself (only the embedding model download needs network, once).
- Metadata-filtered delete (`collection.delete(where={"source": ...})`) is what makes the
  stale-chunk-cleanup fix in `KnowledgeBase.add_chunks` a few lines instead of a hand-rolled index.
- This does not scale past single-user, local use -- there's no concurrent-writer story, no
  clustering, no remote access. That's fine for the stated scope (a personal knowledge tool) and
  explicitly out of scope; a production multi-user deployment would need to swap in Qdrant or
  Pinecone, which -- per ADR 0001 -- is a new class behind `VectorStore`, not a rewrite.
- Because the store is reached only through the `VectorStore` protocol, this decision is the
  single easiest one in the project to reverse later.
