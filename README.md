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

## Project layout

```
rag/
  ingest.py       # file loading + chunking (PDF via pypdf, plain text/markdown)
  embeddings.py   # local embedding model
  vectorstore.py  # Chroma persistence + similarity search
  qa.py           # retrieval + Claude-based answer synthesis
  cli.py          # ingest / ask / list commands
data/             # put your source documents here
.chroma/          # persisted vector DB (gitignored)
```
