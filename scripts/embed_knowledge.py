#!/usr/bin/env python3
"""
Embed the Team Coach knowledge corpus for RAG retrieval.

Usage: VOYAGE_API_KEY=... python3 scripts/embed_knowledge.py

Reads  ui/knowledge/corpus.json         (curated strategy chunks: id/title/tags/text)
Writes ui/public/data/knowledge-embeddings.json
       (the same chunks, each with a 512-dim `vector` from Voyage voyage-3-lite)

The corpus is embedded with input_type="document"; the runtime query embedding
(done server-side in the poke-groq-proxy Lambda) MUST use the same model with
input_type="query" so the vectors are comparable. Re-run this whenever the corpus
changes. Stdlib only — no pip install needed.
"""

import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CORPUS = ROOT / "ui" / "knowledge" / "corpus.json"
OUT = ROOT / "ui" / "public" / "data" / "knowledge-embeddings.json"

MODEL = "voyage-3-lite"  # 512 dims; must match the Lambda embed branch
VOYAGE_URL = "https://api.voyageai.com/v1/embeddings"
BATCH = 64  # Voyage accepts many inputs per request; corpus is small so one batch is plenty


def embed(texts, api_key):
    """Return a list of vectors (one per input text), preserving order."""
    body = json.dumps({
        "model": MODEL,
        "input": texts,
        "input_type": "document",
    }).encode("utf-8")
    req = urllib.request.Request(
        VOYAGE_URL,
        data=body,
        headers={
            "content-type": "application/json",
            "authorization": f"Bearer {api_key}",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            payload = json.load(resp)
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", "replace")
        sys.exit(f"Voyage API error {e.code}: {detail}")
    except urllib.error.URLError as e:
        sys.exit(f"Voyage request failed: {e.reason}")
    # Response: {"data": [{"embedding": [...], "index": 0}, ...]}
    rows = sorted(payload.get("data", []), key=lambda r: r.get("index", 0))
    return [r["embedding"] for r in rows]


def main():
    api_key = os.environ.get("VOYAGE_API_KEY")
    if not api_key:
        sys.exit("Set VOYAGE_API_KEY (get a free key at https://www.voyageai.com/).")

    chunks = json.loads(CORPUS.read_text())
    if not chunks:
        sys.exit(f"Corpus {CORPUS.relative_to(ROOT)} is empty.")

    out = []
    for i in range(0, len(chunks), BATCH):
        batch = chunks[i:i + BATCH]
        vectors = embed([c["text"] for c in batch], api_key)
        if len(vectors) != len(batch):
            sys.exit(f"Voyage returned {len(vectors)} vectors for {len(batch)} inputs.")
        for chunk, vector in zip(batch, vectors):
            out.append({
                "id": chunk["id"],
                "title": chunk["title"],
                "tags": chunk.get("tags", []),
                "text": chunk["text"],
                "vector": vector,
            })

    OUT.write_text(json.dumps(out, ensure_ascii=False))
    dims = len(out[0]["vector"]) if out else 0
    print(f"Wrote {len(out)} embeddings ({dims} dims) to {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
