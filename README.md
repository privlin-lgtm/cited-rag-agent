# Personal Knowledge RAG System

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
pytest
```

Tests use in-memory fakes for the embedding model and vector store (`tests/fakes.py`), so they
run instantly with no model download, disk I/O, or network access.

## Project layout

```
rag/
  config.py         # centralized, env-overridable settings
  interfaces.py      # Embedder / VectorStore protocols + RetrievedChunk
  ingest.py           # file loading + chunking (PDF via pypdf, plain text/markdown)
  embeddings.py       # SentenceTransformerEmbedder (implements Embedder)
  vectorstore.py       # ChromaVectorStore (implements VectorStore)
  knowledge_base.py     # KnowledgeBase facade: orchestrates embedder + store
  qa.py                  # retrieval + streaming Claude-based answer synthesis
  cli.py                  # composition root: wires dependencies, ingest/ask/list commands
tests/
  fakes.py            # in-memory Embedder/VectorStore fakes for fast, isolated tests
  test_ingest.py        # chunking + file-discovery edge cases
  test_knowledge_base.py # add/retrieve orchestration edge cases
  test_qa.py              # context building, fallbacks, streaming, prompt-injection guard
data/                # put your source documents here
.chroma/             # persisted vector DB (gitignored)
```

### Why this shape

`cli.py` is the only place that imports the concrete `SentenceTransformerEmbedder` and
`ChromaVectorStore` classes and wires them into a `KnowledgeBase` — every other module depends on
the `Embedder`/`VectorStore` protocols in `interfaces.py`, not the libraries themselves. Swapping
the embedding model or vector database means writing one new class that satisfies the protocol and
changing that one wiring line in `cli.py`; `qa.py` and `knowledge_base.py` never change. It's also
what makes the test suite fast and offline: tests substitute `tests/fakes.py` for the real
sentence-transformers/Chroma implementations instead of mocking library internals.
