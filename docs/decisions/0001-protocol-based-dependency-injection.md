# 1. Protocol-based dependency injection

## Context

The system has two swappable-in-principle dependencies: the embedding model (sentence-transformers
today, could be OpenAI/Cohere/local-ONNX tomorrow) and the vector store (Chroma today, could be
FAISS/Qdrant/Pinecone, or an in-memory store for tests). Something has to define the contract each
implementation must satisfy, and something has to decide which concrete implementation gets used.

The options considered:

- **Direct imports everywhere** (the original version of this project): `qa.py` and `vectorstore.py`
  import `chromadb`/`sentence_transformers` directly. Simplest to write, but swapping either
  dependency means editing every call site, and unit-testing `qa.py` means either hitting a real
  Chroma instance and downloading a real embedding model, or monkeypatching library internals.
- **Abstract base classes (ABCs)**: define `Embedder`/`VectorStore` as `abc.ABC` subclasses with
  `@abstractmethod`. Enforces the contract at class-definition time, but requires every
  implementation (including test fakes) to explicitly inherit from the ABC.
- **`typing.Protocol`** (structural typing): define the same contract, but any object with matching
  methods satisfies it -- no inheritance required.

## Decision

Use `typing.Protocol` (`rag/interfaces.py`), not ABCs, not direct imports.

The concrete implementations (`SentenceTransformerEmbedder`, `ChromaVectorStore`,
`InMemoryVectorStore`) don't import from `interfaces.py` at all -- they just happen to have an
`embed()` method, or `upsert`/`query`/`delete_by_source`/`list_sources` methods, with matching
signatures. Static type checkers (mypy, in CI) verify the structural match; nothing has to be
declared at runtime. This is also why `tests/fakes.py`'s `FakeEmbedder`/`FakeVectorStore` need zero
special-casing to work as test doubles -- they satisfy the protocols by construction, not by
inheriting from a test base class.

`cli.py` is the only module that imports the concrete classes and wires one of each into a
`KnowledgeBase` (see `rag/knowledge_base.py`); every other module (`qa.py`, `knowledge_base.py`)
only ever sees the protocol types.

## Consequences

- Swapping the vector store means writing one new class satisfying `VectorStore` and changing one
  line in `cli.py`'s `build_store()` -- proven, not just asserted, by `InMemoryVectorStore` (a
  second, fully independent implementation with zero third-party dependencies) and by
  `tests/test_vectorstore_contract.py`, which runs the identical behavioral test suite against
  both `ChromaVectorStore` and `InMemoryVectorStore`.
- Unit tests (`tests/test_qa.py`, `tests/test_knowledge_base.py`) run in milliseconds against
  in-memory fakes, with no model download, disk I/O, or network access.
- The cost is one extra layer of indirection to read through (`interfaces.py` before you find the
  real implementation), and Protocol's structural typing is slightly less discoverable than an ABC
  (an implementation can silently stop satisfying the protocol if a method is renamed, and mypy is
  the only thing that will catch it -- there's no runtime `isinstance` enforcement by default).
  For a project this size, the tradeoff favors Protocol: the test-isolation and swappability wins
  outweigh the discoverability cost.
