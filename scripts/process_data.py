#!/usr/bin/env python3
"""
Process raw scraped PokéAPI JSON into optimized bundles for the poke-web UI.

Usage: python3 scripts/process_data.py
Reads from: /Users/nhicks/Projects/pokeapi-scraper/data/
Writes to:  /Users/nhicks/Projects/poke-web/ui/public/data/
"""

import json
import os
import re
from pathlib import Path

SRC = Path("/Users/nhicks/Projects/pokeapi-scraper/data")
DST = Path("/Users/nhicks/Projects/poke-web/ui/public/data")

def load(endpoint, name):
    p = SRC / endpoint / f"{name}.json"
    if p.exists():
        return json.loads(p.read_text())
    return None

def load_index(endpoint):
    p = SRC / endpoint / "_index.json"
    if p.exists():
        return json.loads(p.read_text())
    return {"results": []}

def en_name(names_list, fallback=""):
    for n in names_list:
        if n.get("language", {}).get("name") == "en":
            return n["name"]
    return fallback

def en_flavor(entries, fallback=""):
    for e in entries:
        if e.get("language", {}).get("name") == "en":
            text = e.get("flavor_text", "").replace("\n", " ").replace("\f", " ")
            return " ".join(text.split())
    return fallback

def id_from_url(url):
    m = re.search(r"/(\d+)/?$", url or "")
    return int(m.group(1)) if m else None

# ---------------------------------------------------------------------------
# 1. Types
# ---------------------------------------------------------------------------
print("Processing types...")
type_index = load_index("type")
types_out = []
for entry in type_index["results"]:
    name = entry["name"]
    t = load("type", name)
    if not t:
        continue
    # skip mystery/shadow types (no real game data)
    if t["id"] > 18:
        continue
    types_out.append({
        "id": t["id"],
        "name": t["name"],
        "damage_relations": t["damage_relations"],
        "pokemon_count": len(t.get("pokemon", [])),
    })
types_out.sort(key=lambda x: x["id"])
(DST / "types.json").write_text(json.dumps(types_out))
print(f"  {len(types_out)} types written")

# ---------------------------------------------------------------------------
# 2. Moves index
# ---------------------------------------------------------------------------
print("Processing moves...")
move_index = load_index("move")
moves_out = []
for entry in move_index["results"]:
    name = entry["name"]
    m = load("move", name)
    if not m:
        continue
    moves_out.append({
        "id": m["id"],
        "name": m["name"],
        "display_name": en_name(m.get("names", []), m["name"]),
        "type": m["type"]["name"] if m.get("type") else None,
        "damage_class": m["damage_class"]["name"] if m.get("damage_class") else None,
        "power": m.get("power"),
        "accuracy": m.get("accuracy"),
        "pp": m.get("pp"),
        "effect_chance": m.get("effect_chance"),
        "short_effect": next(
            (e["short_effect"] for e in m.get("effect_entries", []) if e.get("language", {}).get("name") == "en"),
            None
        ),
    })
moves_out.sort(key=lambda x: x["id"])
(DST / "moves-index.json").write_text(json.dumps(moves_out))
print(f"  {len(moves_out)} moves written")

# ---------------------------------------------------------------------------
# 3. Pokemon index + individual detail files
# ---------------------------------------------------------------------------
print("Processing pokemon...")

# Load generation data once to map species -> generation
gen_index = load_index("generation")
species_to_gen = {}
for gen_entry in gen_index["results"]:
    g = load("generation", gen_entry["name"])
    if not g:
        continue
    gen_id = g["id"]
    for sp in g.get("pokemon_species", []):
        species_to_gen[sp["name"]] = gen_id

# Load species data for evolution chain ids + flavor text + legendary flags
species_index = load_index("pokemon-species")
species_map = {}  # name -> species data
for sp_entry in species_index["results"]:
    sp = load("pokemon-species", sp_entry["name"])
    if not sp:
        continue
    ev_chain_id = id_from_url(sp.get("evolution_chain", {}).get("url") if sp.get("evolution_chain") else None)
    species_map[sp["name"]] = {
        "evolution_chain_id": ev_chain_id,
        "flavor_text": en_flavor(sp.get("flavor_text_entries", [])),
        "is_legendary": sp.get("is_legendary", False),
        "is_mythical": sp.get("is_mythical", False),
        "is_baby": sp.get("is_baby", False),
        "genera": next(
            (g["genus"] for g in sp.get("genera", []) if g.get("language", {}).get("name") == "en"),
            None
        ),
        "generation_id": species_to_gen.get(sp["name"]),
        "evolves_from": sp.get("evolves_from_species", {}).get("name") if sp.get("evolves_from_species") else None,
        "color": sp.get("color", {}).get("name") if sp.get("color") else None,
        "shape": sp.get("shape", {}).get("name") if sp.get("shape") else None,
        "habitat": sp.get("habitat", {}).get("name") if sp.get("habitat") else None,
        "base_happiness": sp.get("base_happiness"),
        "capture_rate": sp.get("capture_rate"),
        "growth_rate": sp.get("growth_rate", {}).get("name") if sp.get("growth_rate") else None,
        "egg_groups": [e["name"] for e in sp.get("egg_groups", [])],
        "gender_rate": sp.get("gender_rate"),
        "hatch_counter": sp.get("hatch_counter"),
    }

# Load ability data for descriptions
ability_index = load_index("ability")
ability_desc = {}
for ab_entry in ability_index["results"]:
    ab = load("ability", ab_entry["name"])
    if not ab:
        continue
    ability_desc[ab["name"]] = next(
        (e["short_effect"] for e in ab.get("effect_entries", []) if e.get("language", {}).get("name") == "en"),
        None
    )

poke_index = load_index("pokemon")
pokemon_out = []

for entry in poke_index["results"]:
    name = entry["name"]
    p = load("pokemon", name)
    if not p or not p.get("is_default", True):
        continue

    sp_name = p["species"]["name"] if p.get("species") else name
    sp = species_map.get(sp_name, {})

    # Stats
    stats = {s["stat"]["name"]: s["base_stat"] for s in p.get("stats", [])}

    # Types
    types = [t["type"]["name"] for t in sorted(p.get("types", []), key=lambda x: x["slot"])]

    # Abilities
    abilities = [
        {
            "name": a["ability"]["name"],
            "is_hidden": a["is_hidden"],
            "slot": a["slot"],
            "description": ability_desc.get(a["ability"]["name"]),
        }
        for a in sorted(p.get("abilities", []), key=lambda x: x["slot"])
    ]

    # Moves — only level-up moves, one entry per move name (lowest level across all versions)
    move_min_level = {}
    for mv in p.get("moves", []):
        for vgd in mv.get("version_group_details", []):
            if vgd["move_learn_method"]["name"] == "level-up":
                move_name = mv["move"]["name"]
                level = vgd["level_learned_at"]
                if move_name not in move_min_level or level < move_min_level[move_name]:
                    move_min_level[move_name] = level
    level_moves = sorted(
        [{"name": n, "level": l} for n, l in move_min_level.items()],
        key=lambda x: (x["level"], x["name"])
    )

    # Sprites
    sprites = p.get("sprites", {})
    sprite_front = sprites.get("front_default")
    sprite_artwork = (sprites.get("other", {}) or {}).get("official-artwork", {}).get("front_default")

    detail = {
        "id": p["id"],
        "name": p["name"],
        "species": sp_name,
        "types": types,
        "stats": stats,
        "abilities": abilities,
        "height": p.get("height"),
        "weight": p.get("weight"),
        "base_experience": p.get("base_experience"),
        "level_up_moves": level_moves,
        "sprite_front": sprite_front,
        "sprite_artwork": sprite_artwork,
        **sp,
    }

    # Write individual detail file
    (DST / "pokemon" / f"{p['id']}.json").write_text(json.dumps(detail))

    # Add to index (lighter weight)
    pokemon_out.append({
        "id": p["id"],
        "name": p["name"],
        "types": types,
        "generation_id": sp.get("generation_id"),
        "is_legendary": sp.get("is_legendary", False),
        "is_mythical": sp.get("is_mythical", False),
        "evolution_chain_id": sp.get("evolution_chain_id"),
        "color": sp.get("color"),
        "stats": stats,
        "bst": sum(stats.values()),
    })

print(f"  {len(pokemon_out)} base pokemon processed")

# ---------------------------------------------------------------------------
# 3b. Alternate forms (regional variants, formes, etc.)
# ---------------------------------------------------------------------------
print("Processing alternate forms...")

form_dir = SRC / "pokemon-form"
poke_data_dir = SRC / "pokemon"
forms_added = 0

for poke_file in sorted(poke_data_dir.iterdir()):
    if poke_file.name == "_index.json" or not poke_file.name.endswith(".json"):
        continue
    try:
        p = json.loads(poke_file.read_text())
    except Exception:
        continue

    poke_id = p.get("id", 0)
    if poke_id <= 1025 or p.get("is_default", True):
        continue

    name = p["name"]

    # Check form file for exclusion flags
    form_file = form_dir / f"{name}.json"
    if not form_file.exists():
        continue
    try:
        form_data = json.loads(form_file.read_text())
    except Exception:
        continue

    if form_data.get("is_mega") or form_data.get("is_battle_only"):
        continue
    if "totem" in name:
        continue
    if name.startswith("pikachu-") and "cap" in name:
        continue

    # Get species info from species_map
    sp_name = (p.get("species") or {}).get("name", "")
    sp = species_map.get(sp_name, {})

    # English display name from form file
    en_display = en_name(form_data.get("names", []), name)

    # Stats
    stats = {s["stat"]["name"]: s["base_stat"] for s in p.get("stats", [])}

    # Types
    types = [t["type"]["name"] for t in sorted(p.get("types", []), key=lambda x: x["slot"])]

    # Abilities
    abilities = [
        {
            "name": a["ability"]["name"],
            "is_hidden": a["is_hidden"],
            "slot": a["slot"],
            "description": ability_desc.get(a["ability"]["name"]),
        }
        for a in sorted(p.get("abilities", []), key=lambda x: x["slot"])
    ]

    # Level-up moves
    move_min_level = {}
    for mv in p.get("moves", []):
        for vgd in mv.get("version_group_details", []):
            if vgd["move_learn_method"]["name"] == "level-up":
                mv_name = mv["move"]["name"]
                level = vgd["level_learned_at"]
                if mv_name not in move_min_level or level < move_min_level[mv_name]:
                    move_min_level[mv_name] = level
    level_moves = sorted(
        [{"name": n, "level": l} for n, l in move_min_level.items()],
        key=lambda x: (x["level"], x["name"])
    )

    # Sprites
    sprites = p.get("sprites", {})
    sprite_front = sprites.get("front_default")
    sprite_artwork = (sprites.get("other", {}) or {}).get("official-artwork", {}).get("front_default")

    detail = {
        "id": poke_id,
        "name": name,
        "display_name": en_display,
        "species": sp_name,
        "types": types,
        "stats": stats,
        "abilities": abilities,
        "height": p.get("height"),
        "weight": p.get("weight"),
        "base_experience": p.get("base_experience"),
        "level_up_moves": level_moves,
        "sprite_front": sprite_front,
        "sprite_artwork": sprite_artwork,
        **sp,
    }

    (DST / "pokemon" / f"{poke_id}.json").write_text(json.dumps(detail))

    pokemon_out.append({
        "id": poke_id,
        "name": name,
        "display_name": en_display,
        "types": types,
        "generation_id": sp.get("generation_id"),
        "is_legendary": sp.get("is_legendary", False),
        "is_mythical": sp.get("is_mythical", False),
        "evolution_chain_id": sp.get("evolution_chain_id"),
        "color": sp.get("color"),
        "stats": stats,
        "bst": sum(stats.values()),
    })
    forms_added += 1

pokemon_out.sort(key=lambda x: x["id"])
(DST / "pokemon-index.json").write_text(json.dumps(pokemon_out))
print(f"  {forms_added} alternate forms added, {len(pokemon_out)} total pokemon indexed")

# ---------------------------------------------------------------------------
# 4. Evolution chains
# ---------------------------------------------------------------------------
print("Processing evolution chains...")

def flatten_chain(chain_node):
    """Recursively convert a chain node into a simple tree structure."""
    if not chain_node:
        return None
    return {
        "species_name": chain_node["species"]["name"],
        "evolution_details": [
            {
                "trigger": (d.get("trigger") or {}).get("name"),
                "min_level": d.get("min_level"),
                "item": (d.get("item") or {}).get("name") if d.get("item") else None,
                "happiness": d.get("min_happiness"),
                "time_of_day": d.get("time_of_day") or None,
                "held_item": (d.get("held_item") or {}).get("name") if d.get("held_item") else None,
                "known_move": (d.get("known_move") or {}).get("name") if d.get("known_move") else None,
                "known_move_type": (d.get("known_move_type") or {}).get("name") if d.get("known_move_type") else None,
                "location": (d.get("location") or {}).get("name") if d.get("location") else None,
                "min_affection": d.get("min_affection"),
                "relative_physical_stats": d.get("relative_physical_stats"),
                "needs_overworld_rain": d.get("needs_overworld_rain") or None,
                "turn_upside_down": d.get("turn_upside_down") or None,
            }
            for d in chain_node.get("evolution_details", [])
        ],
        "evolves_to": [flatten_chain(child) for child in chain_node.get("evolves_to", [])],
    }

ev_index = load_index("evolution-chain")
chain_count = 0
for entry in ev_index["results"]:
    chain_id = id_from_url(entry["url"])
    if not chain_id:
        continue
    ec = load("evolution-chain", str(chain_id))
    if not ec:
        continue
    out = {
        "id": chain_id,
        "chain": flatten_chain(ec.get("chain")),
    }
    (DST / "evolution-chains" / f"{chain_id}.json").write_text(json.dumps(out))
    chain_count += 1

print(f"  {chain_count} evolution chains written")

print("\nDone! Data bundles are ready in ui/public/data/")
