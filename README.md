# Personal Knowledge RAG System

[![CI](https://github.com/privlin-lgtm/personal-knowledge-RAG-system/actions/workflows/ci.yml/badge.svg)](https://github.com/privlin-lgtm/personal-knowledge-RAG-system/actions/workflows/ci.yml)

Ingest PDFs and notes, then ask questions about them in natural language.

## How it works

1. **Ingest** — files are split into overlapping text chunks, embedded locally with
   [sentence-transformers](https://www.sbert.net/) (`all-MiniLM-L6-v2`), and stored in a local
   [ChromaDB](https://www.trychroma.com/) vector database (`.chroma/`).
2. **Ask** — your question is embedded the same way, the most similar chunks are retrieved from
   Chroma, and Claude synthesizes an answer from those chunks, citing sources.

## Setup

The project path (deeply nested under OneDrive with a non-ASCII folder name) is long enough that
some packages (torch's license files in particular) blow past Windows' 260-character path limit
if the virtualenv lives inside the project. Create it in a short path instead:

```bash
python -m venv C:\Users\<you>\.venvs\pk-rag
C:\Users\<you>\.venvs\pk-rag\Scripts\activate
pip install -r requirements.txt
```

(If your Windows build has [long path support](https://learn.microsoft.com/en-us/windows/win32/fileio/maximum-file-path-limitation#enable-long-paths-in-windows-10-version-1607-and-later) enabled, a regular `.venv` inside the project works fine too.)

Copy `.env.example` to `.env` and add your Anthropic API key:

```bash
copy .env.example .env
```

## Usage

```bash
# Ingest a file or a whole directory (PDF, .txt, .md supported)
python -m rag.cli ingest data/some-notes.pdf
python -m rag.cli ingest data/

# Ask a question
python -m rag.cli ask "What did I write about vector databases?"

# See what's been ingested
python -m rag.cli list
```

Without an `ANTHROPIC_API_KEY` set, `ask` falls back to printing the raw retrieved excerpts
instead of a synthesized answer.

Use `--collection <name>` (before the subcommand) to keep separate knowledge bases —
e.g. `python -m rag.cli --collection work ingest work-notes/`.

Use `--store memory` to run against an ephemeral, dependency-free in-memory vector store instead
of the default persistent Chroma one (nothing survives the process exiting) — useful for a quick
one-off session, and proof that the vector store really is swappable (see
[ADR 0001](docs/decisions/0001-protocol-based-dependency-injection.md)).

Use `-v`/`--verbose` for debug logging of this project's own ingest/retrieval trace (third-party
libraries stay quiet regardless).

## Configuration

All of these are optional environment variables (see `config.py`):

| Variable              | Default                | Purpose                              |
|-----------------------|-------------------------|---------------------------------------|
| `RAG_EMBEDDING_MODEL` | `all-MiniLM-L6-v2`      | sentence-transformers model to embed with |
| `RAG_LLM_MODEL`       | `claude-sonnet-5`       | Claude model used to synthesize answers |
| `RAG_DATA_DIR`        | `<project>/.chroma`     | Where the vector store persists data |

## Testing

```bash
pip install -r requirements-dev.txt
pytest                          # unit tests only (fast, no model download or network access)
pytest -m integration           # real embedder + real Chroma, end-to-end (slower, needs network
                                 # on first run to download the embedding model)
ruff check .                    # lint
mypy rag                        # type check
```

Most tests use in-memory fakes for the embedding model and vector store (`tests/fakes.py`), so
they run instantly. `tests/test_vectorstore_contract.py` runs the same behavioral suite against
both real `VectorStore` implementations (Chroma and in-memory) to prove they're interchangeable.
`tests/test_integration.py` is the one place the real embedder and real Chroma run together —
including a regression test for the stale-chunk-on-reingest bug this project's code review found,
verified against the real stack rather than a fake. CI (`.github/workflows/ci.yml`) runs lint,
type-check, unit tests, and integration tests as separate jobs on every push/PR.

## Project layout

```
rag/
  config.py               # centralized, env-overridable settings
  interfaces.py            # Embedder / VectorStore protocols + RetrievedChunk
  logging_config.py         # --verbose wiring (this project's own loggers only)
  ingest.py                  # file loading + chunking (PDF via pypdf, plain text/markdown)
  embeddings.py               # SentenceTransformerEmbedder (implements Embedder)
  vectorstore.py               # ChromaVectorStore (implements VectorStore)
  inmemory_vectorstore.py       # InMemoryVectorStore (implements VectorStore, zero dependencies)
  knowledge_base.py              # KnowledgeBase facade: orchestrates embedder + store
  qa.py                            # retrieval + streaming Claude-based answer synthesis
  cli.py                            # composition root: wires dependencies, ingest/ask/list
tests/
  fakes.py                       # in-memory Embedder/VectorStore fakes for fast, isolated tests
  test_ingest.py                  # chunking + file-discovery edge cases
  test_knowledge_base.py           # add/retrieve orchestration edge cases
  test_qa.py                        # context building, fallbacks, streaming, injection guard
  test_vectorstore_contract.py       # same suite run against both VectorStore implementations
  test_integration.py                 # real embedder + real Chroma, end-to-end (marked slow)
docs/decisions/                # ADRs -- why Protocol-DI, why Chroma, why word-count chunking
data/                          # put your source documents here
.chroma/                       # persisted vector DB (gitignored)
```

### Why this shape

`cli.py` is the only place that imports the concrete `SentenceTransformerEmbedder`,
`ChromaVectorStore`, and `InMemoryVectorStore` classes and wires them into a `KnowledgeBase` —
every other module depends on the `Embedder`/`VectorStore` protocols in `interfaces.py`, not the
libraries themselves. Swapping the embedding model or vector database means writing one new class
that satisfies the protocol and changing that one wiring line in `cli.py`; `qa.py` and
`knowledge_base.py` never change. This isn't just asserted — `InMemoryVectorStore` is a second,
independent `VectorStore` with zero third-party dependencies, and
`tests/test_vectorstore_contract.py` proves it behaves identically to `ChromaVectorStore` under
the same test suite. See [docs/decisions/](docs/decisions/) for the reasoning behind this and the
other non-obvious design choices in the project.
