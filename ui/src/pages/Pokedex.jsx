import { useState, useMemo } from "react";
import { useData } from "../hooks/useData";
import PokemonCard from "../components/PokemonCard";
import TypeBadge from "../components/TypeBadge";
import { TYPE_COLORS, GENERATIONS } from "../utils/typeColors";
import "./Pokedex.css";

const TYPES = Object.keys(TYPE_COLORS);
const PAGE_SIZE_OPTIONS = [20, 40, 60, 100];

export default function Pokedex() {
  const { data: allPokemon, loading } = useData("/data/pokemon-index.json");
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [genFilter, setGenFilter] = useState("");
  const [showFilter, setShowFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(60);

  const filtered = useMemo(() => {
    if (!allPokemon) return [];
    let list = allPokemon;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter((p) =>
        p.name.includes(q) ||
        (p.display_name && p.display_name.toLowerCase().includes(q)) ||
        String(p.id).includes(q)
      );
    }
    if (typeFilter) {
      list = list.filter((p) => p.types.includes(typeFilter));
    }
    if (genFilter) {
      list = list.filter((p) => p.generation_id === Number(genFilter));
    }
    if (showFilter === "legendary") {
      list = list.filter((p) => p.is_legendary);
    } else if (showFilter === "mythical") {
      list = list.filter((p) => p.is_mythical);
    }
    return list;
  }, [allPokemon, search, typeFilter, genFilter, showFilter]);

  const totalPages = Math.ceil(filtered.length / pageSize);
  const visible = filtered.slice((page - 1) * pageSize, page * pageSize);

  function resetPage() { setPage(1); }

  if (loading) return <div className="pokedex-loading">Loading Pokédex...</div>;

  return (
    <div className="pokedex">
      <div className="pokedex__filters">
        <div className="search-wrap">
          <input
            className="filter-input"
            placeholder="Search name or #..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); resetPage(); }}
          />
          {search && (
            <button className="search-clear" onClick={() => { setSearch(""); resetPage(); }} aria-label="Clear search">✕</button>
          )}
        </div>
        <select
          className="filter-select"
          value={typeFilter}
          onChange={(e) => { setTypeFilter(e.target.value); resetPage(); }}
        >
          <option value="">All Types</option>
          {TYPES.map((t) => (
            <option key={t} value={t} style={{ background: TYPE_COLORS[t], color: "#fff" }}>
              {t}
            </option>
          ))}
        </select>
        <select
          className="filter-select"
          value={genFilter}
          onChange={(e) => { setGenFilter(e.target.value); resetPage(); }}
        >
          <option value="">All Gens</option>
          {GENERATIONS.map((g) => (
            <option key={g.id} value={g.id}>{g.label}</option>
          ))}
        </select>
        <select
          className="filter-select"
          value={showFilter}
          onChange={(e) => { setShowFilter(e.target.value); resetPage(); }}
        >
          <option value="all">All Pokémon</option>
          <option value="legendary">Legendary</option>
          <option value="mythical">Mythical</option>
        </select>
        <select
          className="filter-select"
          value={pageSize}
          onChange={(e) => { setPageSize(Number(e.target.value)); resetPage(); }}
        >
          {PAGE_SIZE_OPTIONS.map((n) => (
            <option key={n} value={n}>{n} per page</option>
          ))}
        </select>
      </div>

      <div className="pokedex__count">
        {filtered.length} Pokémon
      </div>

      <div className="pokedex__grid">
        {visible.map((p) => <PokemonCard key={p.id} pokemon={p} />)}
      </div>

      {totalPages > 1 && (
        <div className="pokedex__pagination">
          <button disabled={page === 1} onClick={() => setPage(1)}>«</button>
          <button disabled={page === 1} onClick={() => setPage((p) => p - 1)}>‹</button>
          <span>Page {page} of {totalPages}</span>
          <button disabled={page === totalPages} onClick={() => setPage((p) => p + 1)}>›</button>
          <button disabled={page === totalPages} onClick={() => setPage(totalPages)}>»</button>
        </div>
      )}
    </div>
  );
}
