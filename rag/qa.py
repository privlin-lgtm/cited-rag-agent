"""Answer questions by retrieving relevant chunks and asking Claude to synthesize."""

from __future__ import annotations

import os

import anthropic

from rag import vectorstore

MODEL = "claude-sonnet-5"

SYSTEM_PROMPT = (
    "You answer questions using only the provided context excerpts from the user's "
    "personal knowledge base. Cite sources by filename after each claim, like [source: file.pdf]. "
    "If the context does not contain the answer, say so plainly instead of guessing."
)


def build_context(question: str, top_k: int = 5) -> tuple[str, list[str]]:
    results = vectorstore.query(question, top_k=top_k)
    documents = results["documents"][0]
    metadatas = results["metadatas"][0]

    blocks = []
    sources = []
    for doc, meta in zip(documents, metadatas):
        source = meta["source"]
        sources.append(source)
        blocks.append(f"[source: {source}]\n{doc}")
    return "\n\n---\n\n".join(blocks), sources


def ask(question: str, top_k: int = 5) -> str:
    context, sources = build_context(question, top_k=top_k)
    if not context:
        return "No documents have been ingested yet. Run `ingest` first."

    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        return (
            "ANTHROPIC_API_KEY is not set, so I can't generate an answer. "
            f"Here are the most relevant excerpts instead:\n\n{context}"
        )

    client = anthropic.Anthropic(api_key=api_key)
    response = client.messages.create(
        model=MODEL,
        max_tokens=1024,
        system=SYSTEM_PROMPT,
        messages=[
            {
                "role": "user",
                "content": f"Context:\n\n{context}\n\nQuestion: {question}",
            }
        ],
    )
    return response.content[0].text
