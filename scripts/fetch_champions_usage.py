#!/usr/bin/env python3
"""
Fetch competitive usage data from championsbattledata.com and write per-Pokemon
bundles for the poke-web UI.

Usage: python3 scripts/fetch_champions_usage.py

Reads the site's STATIC assets, not its /api/ JSON endpoints. The dynamic API
aggressively throttles bursts with HTTP 503, but the static index and per-CSV
files (same data) are served straight from the CDN and aren't rate-limited:
  https://championsbattledata.com/data/pokemon-index.json   (Pokemon list + paths)
  https://championsbattledata.com/<battleDataCsvs[].path>    (usage rows, CSV)

Also reads ui/public/data/pokemon-index.json for the Champions->PokeAPI id map.
Writes: ui/public/data/usage/{id}.json   (one per mapped Pokemon)
        ui/public/data/usage/_meta.json   (version + run summary)

Stdlib only, so the GitHub Actions workflow needs no pip install.
This fan site is not affiliated with Nintendo / The Pokemon Company.
"""

import csv
import io
import json
import sys
import time
import urllib.parse
import urllib.request
import urllib.error
from pathlib import Path

SITE = "https://championsbattledata.com"
INDEX_URL = f"{SITE}/data/pokemon-index.json"
ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "ui" / "public" / "data"
DST = DATA / "usage"
DELAY = 0.2          # seconds between requests; static assets aren't throttled
RETRIES = 4
TIMEOUT = 30
# Abort (non-zero exit, no PR) if more than this fraction of Pokemon fail
# entirely, so a bad run fails loudly instead of publishing degraded data.
MAX_FAIL_FRACTION = 0.10

# Champions form-slug -> PokeAPI form-slug normalization ------------------------
REGION = {"alolan": "alola", "galarian": "galar", "hisuian": "hisui", "paldean": "paldea"}
SUFFIX = {
    "-shield-forme": "-shield", "-blade-forme": "-blade",
    "-dusk-form": "-dusk", "-midnight-form": "-midnight", "-midday-form": "-midday",
    "-zero-form": "-zero", "-hero-form": "-hero",
    "-jumbo-variety": "-super", "-large-variety": "-large",
    "-small-variety": "-small", "-average-variety": "-average",
    "-natural-form": "-natural",
    "-aqua-breed": "-aqua", "-blaze-breed": "-blaze", "-combat-breed": "-combat",
}


def fetch(url):
    """GET a URL with retries + exponential backoff; return raw bytes."""
    last = None
    for attempt in range(RETRIES):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "poke-web-data-bot"})
            with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
                return r.read()
        except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError) as e:
            last = e
            if attempt < RETRIES - 1:
                time.sleep(2 ** (attempt + 1))  # 2, 4, 8s
    raise RuntimeError(f"failed to fetch {url}: {last}")


def asset_url(path):
    """Build a static-asset URL from an index relative path, encoding spaces."""
    return f"{SITE}/{urllib.parse.quote(path)}"


def candidates(slug):
    """Yield possible PokeAPI form slugs for a Champions slug, best guess first."""
    yield slug
    for suf in ("-forme", "-form", "-variety", "-pattern", "-flower"):
        if slug.endswith(suf):
            yield slug[: -len(suf)]
    parts = slug.split("-")
    if parts[0] in REGION:
        reg = REGION[parts[0]]
        rest = parts[1:]
        yield "-".join(rest) + "-" + reg            # ninetales-alola
        yield "-".join(rest)                         # base, no region
        if len(rest) >= 2:                           # tauros-paldea-aqua-breed
            yield f"{rest[0]}-{reg}-{'-'.join(rest[1:])}"
    swapped = slug
    for k, v in SUFFIX.items():
        swapped = swapped.replace(k, v)
    yield swapped
    yield ("PREFIX", "-".join(parts[1:]) if parts[0] in REGION else parts[0])


def build_resolver(index):
    by_name = {p["name"]: p["id"] for p in index}

    def resolve(slug):
        for c in candidates(slug):
            if isinstance(c, tuple):
                pre = c[1]
                for p in index:
                    if p["name"] == pre or p["name"].startswith(pre + "-"):
                        return p["id"]
            elif c in by_name:
                return by_name[c]
        return None

    return resolve


def _pct(s):
    """'89.1%' -> 89.1"""
    try:
        return float(str(s).rstrip("%"))
    except ValueError:
        return None


def _int(s):
    try:
        return int(s)
    except (ValueError, TypeError):
        return 0


def parse_csv(text):
    """Parse a battle-data CSV into categories. Columns:
    pokemon, column_position, category, rank, name, percentage, stat_up,
    stat_down, {hp,attack,defense,sp_atk,sp_def,speed}_points.
    Categories: move, held_item, ability, teammate,
    stat_alignment (nature + stat up/down), stat_points (EV-style spread)."""
    out = {}
    for row in csv.DictReader(io.StringIO(text)):
        cat = (row.get("category") or "").strip()
        if not cat:
            continue
        entry = {
            "rank": _int(row.get("rank")),
            "name": row.get("name") or "",
            "percentage": _pct(row.get("percentage")),
        }
        if cat == "stat_alignment":          # nature, e.g. Jolly (+Speed / -Sp. Atk)
            entry["stat_up"] = row.get("stat_up") or None
            entry["stat_down"] = row.get("stat_down") or None
        elif cat == "stat_points":           # EV spread; rows have no name
            entry["evs"] = {
                "hp": _int(row.get("hp_points")),
                "attack": _int(row.get("attack_points")),
                "defense": _int(row.get("defense_points")),
                "sp_atk": _int(row.get("sp_atk_points")),
                "sp_def": _int(row.get("sp_def_points")),
                "speed": _int(row.get("speed_points")),
            }
        out.setdefault(cat, []).append(entry)
    for cat in out:
        out[cat].sort(key=lambda e: e["rank"])
    return out


def main():
    if not (DATA / "pokemon-index.json").exists():
        sys.exit("pokemon-index.json not found; run process_data.py first")

    index = json.loads((DATA / "pokemon-index.json").read_text())
    resolve = build_resolver(index)
    id_to_name = {p["id"]: p["name"] for p in index}

    print("Fetching Champions static index...")
    idx = json.loads(fetch(INDEX_URL).decode())
    version = idx.get("dataVersion")
    pokemon = idx.get("pokemon", [])
    print(f"  dataVersion={version}, {len(pokemon)} Pokemon")

    DST.mkdir(parents=True, exist_ok=True)
    written, unmapped, failed, fully_failed = [], [], [], []

    for i, p in enumerate(pokemon, 1):
        slug = p["slug"]
        pid = resolve(slug)
        if pid is None:
            unmapped.append(slug)
            continue

        # Start from any existing file so a partial run keeps last-known data
        # instead of dropping Pokemon / formats it couldn't refetch.
        dst_file = DST / f"{pid}.json"
        out = json.loads(dst_file.read_text()) if dst_file.exists() else {}
        formats = out.get("formats", {})

        ok_this_run = False
        for entry in p.get("battleDataCsvs", []):
            fmt = entry["format"]
            try:
                text = fetch(asset_url(entry["path"])).decode()
                formats[fmt] = parse_csv(text)
                ok_this_run = True
            except RuntimeError as e:
                failed.append(f"{slug}/{fmt}: {e}")
            time.sleep(DELAY)

        if not formats:
            fully_failed.append(slug)
            continue
        if not ok_this_run:
            # nothing fetched this run; existing data left untouched on disk
            fully_failed.append(slug)
            continue

        bs = p.get("summary", {}).get("battleSummary", {}).get("Current", {})
        doubles_rank = bs.get("Doubles", {}).get("position")
        singles_rank = bs.get("Singles", {}).get("position")

        out.update({
            "id": pid,
            "name": id_to_name.get(pid),
            "champions_name": p.get("battleName", p.get("name")),
            "champions_slug": slug,
            "data_version": version,
            "doubles_rank": doubles_rank,
            "singles_rank": singles_rank,
            "formats": formats,
        })
        dst_file.write_text(json.dumps(out, ensure_ascii=False))
        written.append((pid, doubles_rank, singles_rank))
        if i % 25 == 0:
            print(f"  {i}/{len(pokemon)} processed...")

    # Guard: if too many Pokemon failed entirely, something is wrong upstream.
    # Abort so the workflow makes no PR and surfaces a red run to investigate,
    # rather than publishing a degraded dataset.
    mapped = len(pokemon) - len(unmapped)
    if mapped and len(fully_failed) / mapped > MAX_FAIL_FRACTION:
        sys.exit(
            f"ABORT: {len(fully_failed)}/{mapped} Pokemon failed entirely "
            f"(> {MAX_FAIL_FRACTION:.0%}). No data published."
        )

    written_ids = [pid for pid, _, _ in written]

    # Write _index.json: [{id, doubles_rank, singles_rank}] sorted by doubles_rank.
    # Used by the UI to know which Pokemon have usage data and in what order.
    index_entries = sorted(
        [{"id": pid, "doubles_rank": dr, "singles_rank": sr} for pid, dr, sr in written],
        key=lambda e: (e["doubles_rank"] is None, e["doubles_rank"]),
    )
    (DST / "_index.json").write_text(json.dumps(index_entries, ensure_ascii=False))

    meta = {
        "source": "championsbattledata.com",
        "data_version": version,
        "fetched_at": idx.get("generatedAt"),
        "pokemon_count": len(written_ids),
        "unmapped": unmapped,
        "fully_failed": fully_failed,
        "failed_requests": failed,
    }
    (DST / "_meta.json").write_text(json.dumps(meta, indent=2, ensure_ascii=False))

    print(f"\nWrote {len(written)} usage files to {DST.relative_to(ROOT)}")
    if unmapped:
        print(f"  unmapped slugs ({len(unmapped)}): {unmapped}")
    if failed:
        print(f"  failed requests ({len(failed)})")


if __name__ == "__main__":
    main()
