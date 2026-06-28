#!/usr/bin/env python3
"""
Download Pokémon sprites from GitHub's PokeAPI sprites repo.

Usage:
  python3 scripts/download_sprites.py            # download both sets
  python3 scripts/download_sprites.py --front     # front sprites only
  python3 scripts/download_sprites.py --artwork   # official artwork only

Saves to:
  ui/public/sprites/pokemon/{id}.png       (front_default)
  ui/public/sprites/artwork/{id}.png       (official-artwork)
"""

import asyncio
import json
import sys
from pathlib import Path
import httpx
from tqdm import tqdm

DATA_DIR = Path(__file__).parent.parent / "ui/public/data/pokemon"
SPRITE_DIR = Path(__file__).parent.parent / "ui/public/sprites/pokemon"
ARTWORK_DIR = Path(__file__).parent.parent / "ui/public/sprites/artwork"

SPRITE_BASE = "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon"
ARTWORK_BASE = f"{SPRITE_BASE}/other/official-artwork"

CONCURRENCY = 30
MAX_RETRIES = 3


async def download(client, sem, url, dest, bar):
    if dest.exists():
        bar.update(1)
        return
    async with sem:
        for attempt in range(MAX_RETRIES):
            try:
                r = await client.get(url, follow_redirects=True)
                if r.status_code == 200:
                    dest.write_bytes(r.content)
                    break
                elif r.status_code == 404:
                    break  # no sprite exists
            except Exception:
                if attempt == MAX_RETRIES - 1:
                    pass
                await asyncio.sleep(2 ** attempt)
        bar.update(1)


async def main(do_front, do_artwork):
    SPRITE_DIR.mkdir(parents=True, exist_ok=True)
    ARTWORK_DIR.mkdir(parents=True, exist_ok=True)

    # collect ids from processed data
    ids = sorted(int(p.stem) for p in DATA_DIR.glob("*.json"))
    print(f"Found {len(ids)} Pokémon IDs")

    sem = asyncio.Semaphore(CONCURRENCY)
    limits = httpx.Limits(max_connections=CONCURRENCY, max_keepalive_connections=CONCURRENCY)
    async with httpx.AsyncClient(timeout=20, limits=limits) as client:
        tasks = []
        if do_front:
            bar = tqdm(total=len(ids), desc="Front sprites", unit="img")
            for pid in ids:
                url = f"{SPRITE_BASE}/{pid}.png"
                dest = SPRITE_DIR / f"{pid}.png"
                tasks.append(download(client, sem, url, dest, bar))
        if do_artwork:
            bar2 = tqdm(total=len(ids), desc="Official artwork", unit="img")
            for pid in ids:
                url = f"{ARTWORK_BASE}/{pid}.png"
                dest = ARTWORK_DIR / f"{pid}.png"
                tasks.append(download(client, sem, url, dest, bar2))
        await asyncio.gather(*tasks)

    print("Done.")


if __name__ == "__main__":
    args = sys.argv[1:]
    do_front = "--artwork" not in args or "--front" in args
    do_artwork = "--front" not in args or "--artwork" in args
    if "--front" not in args and "--artwork" not in args:
        do_front = do_artwork = True
    asyncio.run(main(do_front, do_artwork))
