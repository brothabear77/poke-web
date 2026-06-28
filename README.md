# PokéLocal

A personal local Pokémon browser built on top of data scraped from PokéAPI. Fully offline-capable — no calls to any external API at runtime.

---

## Features

- **Pokédex** — Browse all 1,025 Pokémon in a card grid. Search by name or number, filter by type, generation, or legendary/mythical status.
- **Pokémon Detail** — Sprite + official artwork, base stats with colored bars, abilities with descriptions, species info (catch rate, egg groups, habitat, etc.), evolution chain, and level-up move list. Prev/next navigation between entries.
- **Type Chart** — Full 18×18 type effectiveness matrix. Toggle between Offense and Defense views. Click any type to see a summary of its matchups.
- **Move Browser** — All 937 moves with type badges, damage class, power, accuracy, PP, and effect text. Searchable and sortable by any column, filterable by type and damage class.

---

## Project Structure

```
poke-web/
  ui/                        # Vite + React app
    src/
      pages/                 # Pokedex, PokemonDetail, TypeChart, MoveBrowser
      components/            # PokemonCard, StatBar, TypeBadge, EvolutionChain
      hooks/useData.js       # fetch + in-memory cache hook
      utils/typeColors.js    # type/stat color and label maps
    public/
      data/
        pokemon-index.json   # lightweight list of all pokemon (id, name, types, gen, etc.)
        pokemon/{id}.json    # full detail per pokemon
        types.json           # all 18 types with damage relations
        moves-index.json     # all 937 moves (id, name, type, power, accuracy, pp, effect)
        evolution-chains/    # processed evolution trees per chain id
      sprites/
        pokemon/{id}.png     # front-default sprites
        artwork/{id}.png     # official artwork

  scripts/
    process_data.py          # builds ui/public/data/ from scraped JSON
    download_sprites.py      # downloads sprites to ui/public/sprites/
```

The scraped raw data lives separately at `/Users/nhicks/Projects/pokeapi-scraper/data/` (13,693 JSON files across 45+ endpoints). The scripts above read from there and produce the optimized bundles the UI actually uses.

---

## Running the App

```bash
cd ui
npm install        # first time only
npm run dev        # starts at http://localhost:8000
```

---

## Data Pipeline

If you re-run the scraper, rebuild the UI data bundles with:

```bash
python3 scripts/process_data.py
```

To re-download sprites (already done — 1,025 front + 1,025 artwork):

```bash
python3 scripts/download_sprites.py            # both sets
python3 scripts/download_sprites.py --front    # front sprites only
python3 scripts/download_sprites.py --artwork  # official artwork only
```

---

## Stack

- **React + Vite** (plain JS, no TypeScript)
- **React Router** for client-side routing
- No CSS framework — plain CSS modules per component
- Data served as static JSON from `public/data/` via Vite's dev server
