# PokéLocal

A personal local Pokémon browser built on top of data scraped from PokéAPI. Fully offline-capable — no calls to any external API at runtime.

Live at: **https://brothabear77.github.io/poke-web/**

---

## Features

- **Pokédex** — Browse all 1,025 Pokémon in a card grid. Search by name or number, filter by type or generation (multi-select), or toggle legendary/mythical visibility.
- **Pokémon Detail** — Sprite + official artwork, base stats with colored bars, abilities with descriptions, species info (catch rate, egg groups, habitat, etc.), evolution chain, and level-up move list. Prev/next navigation between entries.
- **Type Chart** — Full 18×18 type effectiveness matrix. Toggle between Offense and Defense views. Click any type to see a summary of its matchups.
- **Move Browser** — All 937 moves with type badges, damage class, power, accuracy, PP, and effect text. Searchable and sortable by any column, filterable by type and damage class.
- **Team Builder** — Build a team of up to 6 Pokémon with a live suggestion engine and analysis panel.
  - Pick from the full Pokémon pool (same search/type/gen filters as the Pokédex)
  - Hover the **i** button on any card to see stat bars and abilities without leaving the page
  - Live **team analysis**: offensive type coverage (X/18), shared weaknesses, total and average BST
  - **Suggestion engine** scores candidates on six tunable dimensions — type diversity, offensive coverage, defensive synergy, base stat total, offensive stat distribution (Atk/SpA/Spe), and defensive stat distribution (HP/Def/SpD) — each adjustable via a 0–100 slider
  - **Auto-fill** greedily completes the remaining slots using the same weighted scoring
  - Toggle legendaries/mythicals in or out of the suggestion pool
  - Team persists across page reloads via `localStorage`
  - Slot entry and exit animations
- **Mobile-friendly** — Responsive layout throughout; hamburger menu opens a slide-out nav drawer on small screens

---

## Project Structure

```
poke-web/
  .github/
    workflows/
      deploy.yml             # GitHub Actions: build + deploy to GitHub Pages on push to main

  ui/                        # Vite + React app
    src/
      pages/                 # Pokedex, PokemonDetail, TypeChart, MoveBrowser, TeamBuilder
      components/            # PokemonCard, TeamSlotCard, PokemonInfoBtn, StatBar, TypeBadge, EvolutionChain
      hooks/
        useData.js           # fetch + in-memory cache hook (supports lazy/null path)
      utils/
        typeColors.js        # type/stat color and label maps, generation definitions
        typeChart.js         # builds 18×18 effectiveness chart; offense/defense helpers
        teamSuggest.js       # analyzeTeam, suggestTeam, autoFill, DEFAULT_WEIGHTS
        assetUrl.js          # prepends Vite BASE_URL for GitHub Pages compatibility
    public/
      data/
        pokemon-index.json   # lightweight list of all pokemon (id, name, types, gen, stats, bst, etc.)
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

  package.json               # root scripts that delegate to ui/ (npm run dev, build, etc.)
```

The scraped raw data lives separately at `/Users/nhicks/Projects/pokeapi-scraper/data/` (13,693 JSON files across 45+ endpoints). The scripts above read from there and produce the optimized bundles the UI actually uses.

---

## Running the App

From the repo root:

```bash
npm install --prefix ui    # first time only
npm run dev                # starts at http://localhost:8000
```

Or from the `ui/` directory directly:

```bash
cd ui
npm install    # first time only
npm run dev
```

### Team Coach in dev — free local LLM (no tokens)

`npm run dev` runs the Team Coach against a **free local LLM** instead of the cloud Gemini
proxy, so iterating costs no tokens and needs no password. Production (the deployed site)
always uses the Gemini proxy — the local path only exists in the dev server.

One-time setup ([Ollama](https://ollama.com)):

```bash
brew install ollama          # or download from ollama.com
ollama serve                 # usually auto-runs as a background service
ollama pull qwen2.5:7b       # ~5 GB — the model the coach calls
```

Then `npm run dev` and open the Team Builder — the coach auto-analyzes with no login prompt
(look for the `Local LLM (dev)` badge). Notes:

- **First response is slow** (a 7B model on the coach's large prompt can take 10–60s on CPU).
- **RAG is off locally** (the knowledge corpus uses cloud embeddings); the coach still runs on
  its full structured + damage-calc grounding.
- **Quality is a preview**, not a match for the production Gemini model.
- **To test the real Gemini proxy in dev**, create `ui/.env.local` with `VITE_COACH_PROXY=1`
  and restart — then the normal password login applies (see `ui/.env.example`).

---

## Deployment

The app deploys automatically to GitHub Pages on every push to `main` via `.github/workflows/deploy.yml`.

To enable for a fresh fork:
1. Go to **Settings → Pages** in your GitHub repo
2. Under **Source**, select **GitHub Actions**

The workflow installs dependencies, runs `vite build`, and uploads `ui/dist/` as the Pages artifact.

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
- **React Router v6** — `HashRouter` for GitHub Pages compatibility
- No CSS framework — plain CSS per component
- Data served as static JSON from `public/data/`
- No backend — fully static, no runtime API calls
