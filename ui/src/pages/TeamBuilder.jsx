import { useState, useMemo, useEffect, useRef } from "react";
import { useData } from "../hooks/useData";
import PokemonCard from "../components/PokemonCard";
import TeamSlotCard from "../components/TeamSlotCard";
import TypeBadge from "../components/TypeBadge";
import { TYPE_COLORS, GENERATIONS } from "../utils/typeColors";
import { buildChart, ALL_TYPES } from "../utils/typeChart";
import { analyzeTeam, suggestTeam, autoFill, DEFAULT_WEIGHTS } from "../utils/teamSuggest";

const WEIGHT_DEFS = [
  { key: "diversity",      label: "Type Diversity",    desc: "Rewards adding new types to the team" },
  { key: "offense",        label: "Offense Coverage",  desc: "Rewards covering more defending types super-effectively" },
  { key: "defense",        label: "Defense Synergy",   desc: "Rewards patching shared weaknesses" },
  { key: "bst",            label: "Base Stat Total",   desc: "Rewards overall raw power" },
  { key: "offensivePower", label: "Offensive Stats",   desc: "Rewards high Atk, Sp. Atk & Speed" },
  { key: "defensivePower", label: "Defensive Stats",   desc: "Rewards high HP, Def & Sp. Def" },
];
import "./TeamBuilder.css";

const TYPES = Object.keys(TYPE_COLORS);
const PAGE_SIZE_OPTIONS = [30, 60, 90, 120];
const MAX_TEAM = 6;
const STORAGE_KEY = "poke-team";


export default function TeamBuilder() {
  const { data: allPokemon, loading } = useData("/data/pokemon-index.json");
  const { data: typesData } = useData("/data/types.json");

  const [teamIds, setTeamIds] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
      return Array.isArray(saved) ? saved.slice(0, MAX_TEAM) : [];
    } catch {
      return [];
    }
  });
  const [includeLegendary, setIncludeLegendary] = useState(false);
  const [leavingIds, setLeavingIds] = useState(new Set());
  const [weights, setWeights] = useState({ ...DEFAULT_WEIGHTS });
  const [weightsOpen, setWeightsOpen] = useState(false);

  // Pool filters (mirror Pokedex)
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState(new Set());
  const [typeOpen, setTypeOpen] = useState(false);
  const typeRef = useRef(null);
  const [genFilter, setGenFilter] = useState(new Set());
  const [genOpen, setGenOpen] = useState(false);
  const genRef = useRef(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(60);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(teamIds));
  }, [teamIds]);

  useEffect(() => {
    if (!typeOpen) return;
    function handleClick(e) {
      if (typeRef.current && !typeRef.current.contains(e.target)) setTypeOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [typeOpen]);

  useEffect(() => {
    if (!genOpen) return;
    function handleClick(e) {
      if (genRef.current && !genRef.current.contains(e.target)) setGenOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [genOpen]);

  const byId = useMemo(() => {
    const m = new Map();
    if (allPokemon) for (const p of allPokemon) m.set(p.id, p);
    return m;
  }, [allPokemon]);

  const team = useMemo(
    () => teamIds.map((id) => byId.get(id)).filter(Boolean),
    [teamIds, byId]
  );

  const chart = useMemo(() => buildChart(typesData), [typesData]);

  const analysis = useMemo(
    () => (chart ? analyzeTeam(team, chart) : null),
    [team, chart]
  );

  // Suggestion pool: type + gen filters only (search does not narrow suggestions).
  const suggestionPool = useMemo(() => {
    if (!allPokemon) return [];
    let list = allPokemon;
    if (typeFilter.size) list = list.filter((p) => p.types.some((t) => typeFilter.has(t)));
    if (genFilter.size) list = list.filter((p) => genFilter.has(p.generation_id));
    return list;
  }, [allPokemon, typeFilter, genFilter]);

  // Pool list: all filters including search.
  const filtered = useMemo(() => {
    if (!allPokemon) return [];
    let list = suggestionPool;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter((p) => p.name.includes(q) || String(p.id).includes(q));
    }
    return list;
  }, [suggestionPool, search]);

  const suggestions = useMemo(
    () =>
      chart && suggestionPool.length && team.length < MAX_TEAM
        ? suggestTeam(suggestionPool, chart, team, { includeLegendary }, 8, weights)
        : [],
    [suggestionPool, chart, team, includeLegendary, weights]
  );

  // --- team mutations ---
  function addToTeam(p) {
    setTeamIds((ids) =>
      ids.length >= MAX_TEAM || ids.includes(p.id) ? ids : [...ids, p.id]
    );
  }
  const LEAVE_MS = 260;
  function removeFromTeam(id) {
    setLeavingIds((prev) => new Set([...prev, id]));
    setTimeout(() => {
      setTeamIds((ids) => ids.filter((x) => x !== id));
      setLeavingIds((prev) => { const n = new Set(prev); n.delete(id); return n; });
    }, LEAVE_MS);
  }
  function clearTeam() {
    setLeavingIds(new Set(teamIds));
    setTimeout(() => {
      setTeamIds([]);
      setLeavingIds(new Set());
    }, LEAVE_MS);
  }
  function handleAutoFill() {
    if (!chart || !filtered.length) return;
    const filled = autoFill(filtered, chart, team, { includeLegendary }, MAX_TEAM, weights);
    setTeamIds(filled.map((p) => p.id));
  }

  function setWeight(key, val) {
    setWeights((w) => ({ ...w, [key]: Number(val) }));
  }
  function resetWeights() {
    setWeights({ ...DEFAULT_WEIGHTS });
  }

  const totalPages = Math.ceil(filtered.length / pageSize);
  const visible = filtered.slice((page - 1) * pageSize, page * pageSize);
  function resetPage() { setPage(1); }

  if (loading) return <div className="tb-loading">Loading Team Builder...</div>;

  const teamFull = team.length >= MAX_TEAM;

  const weightsModified = WEIGHT_DEFS.some(({ key }) => weights[key] !== DEFAULT_WEIGHTS[key]);

  return (
    <div className="team-builder">
      {/* --- Suggestion Weights --- */}
      <div className="tb__weights">
        <button
          type="button"
          className={`tb__weights-toggle${weightsOpen ? " tb__weights-toggle--open" : ""}${weightsModified ? " tb__weights-toggle--modified" : ""}`}
          onClick={() => setWeightsOpen((o) => !o)}
        >
          <span>Suggestion Weights</span>
          {weightsModified && <span className="tb__weights-dot" />}
          <span className="tb__weights-arrow">{weightsOpen ? "▲" : "▼"}</span>
        </button>
        {weightsOpen && (
          <div className="tb__weights-body">
            {WEIGHT_DEFS.map(({ key, label, desc }) => (
              <div className="tb__weight-row" key={key}>
                <div className="tb__weight-meta">
                  <span className="tb__weight-label">{label}</span>
                  <span className="tb__weight-desc">{desc}</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="100"
                  step="5"
                  value={weights[key]}
                  className="tb__weight-slider"
                  onChange={(e) => setWeight(key, e.target.value)}
                />
                <span className="tb__weight-val">{weights[key]}</span>
              </div>
            ))}
            {weightsModified && (
              <button type="button" className="tb__weight-reset" onClick={resetWeights}>
                Reset to defaults
              </button>
            )}
          </div>
        )}
      </div>

      {/* --- Slots --- */}
      <div className="tb__slots">
        {Array.from({ length: MAX_TEAM }).map((_, i) => {
          const p = team[i];
          if (!p) {
            return (
              <div key={i} className="tb__slot tb__slot--empty">
                <span className="tb__slot-label">Slot {i + 1}</span>
              </div>
            );
          }
          return <TeamSlotCard key={i} pokemon={p} onRemove={removeFromTeam} position={i + 1} leaving={leavingIds.has(p.id)} />;
        })}
      </div>

      {/* --- Analysis --- */}
      {analysis && team.length > 0 && (
        <div className="tb__analysis">
          <div className="tb__analysis-block">
            <h3 className="tb__analysis-title">
              Offensive coverage{" "}
              <span className="tb__analysis-frac">
                {analysis.offensiveCovered.size} / {ALL_TYPES.length}
              </span>
            </h3>
            {analysis.offensiveGaps.length > 0 ? (
              <div className="tb__badge-row">
                <span className="tb__muted">Not covered:</span>
                {analysis.offensiveGaps.map((t) => <TypeBadge key={t} type={t} small />)}
              </div>
            ) : (
              <div className="tb__good">Hits every type super-effectively ✓</div>
            )}
          </div>

          <div className="tb__analysis-block">
            <h3 className="tb__analysis-title">Shared weaknesses</h3>
            {analysis.sharedWeaknesses.length > 0 ? (
              <div className="tb__badge-row">
                {analysis.sharedWeaknesses.map((t) => (
                  <span key={t} className="tb__weak-badge">
                    <TypeBadge type={t} small />
                    <span className="tb__weak-count">×{analysis.weakCounts[t]}</span>
                  </span>
                ))}
              </div>
            ) : (
              <div className="tb__good">No type weakens 2+ members ✓</div>
            )}
          </div>

          <div className="tb__analysis-block tb__analysis-block--stats">
            <div>
              <div className="tb__stat-num">{analysis.bstTotal}</div>
              <div className="tb__muted">Total BST</div>
            </div>
            <div>
              <div className="tb__stat-num">{analysis.bstAvg}</div>
              <div className="tb__muted">Avg BST</div>
            </div>
          </div>
        </div>
      )}

      {/* --- Suggestions --- */}
      <div className="tb__suggest">
        <div className="tb__suggest-head">
          <h3 className="tb__suggest-title">Suggested picks</h3>
          <div className="tb__suggest-actions">
            <label className="tb__toggle">
              <input
                type="checkbox"
                checked={includeLegendary}
                onChange={(e) => setIncludeLegendary(e.target.checked)}
              />
              Include legendaries
            </label>
            <button
              className="tb__btn"
              onClick={handleAutoFill}
              disabled={teamFull}
            >
              Auto-fill remaining
            </button>
            <button
              className="tb__btn tb__btn--ghost"
              onClick={clearTeam}
              disabled={team.length === 0}
            >
              Clear
            </button>
          </div>
        </div>

        {teamFull ? (
          <div className="tb__muted tb__suggest-empty">Team is full — remove a member to see suggestions.</div>
        ) : suggestions.length === 0 ? (
          <div className="tb__muted tb__suggest-empty">No suggestions available.</div>
        ) : (
          <div className="tb__suggest-row">
            {suggestions.map(({ pokemon }) => {
              const onTeam = teamIds.includes(pokemon.id);
              return (
                <PokemonCard
                  key={pokemon.id}
                  pokemon={pokemon}
                  onSelect={addToTeam}
                  selected={onTeam}
                  disabled={onTeam || teamFull}
                  showInfo
                />
              );
            })}
          </div>
        )}
      </div>

      {/* --- Pool --- */}
      <div className="tb__pool">
        <div className="tb__filters">
          <input
            className="filter-input"
            placeholder="Search name or #..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); resetPage(); }}
          />
          <div className="gen-filter" ref={typeRef}>
            <button
              type="button"
              className={`gen-filter__btn filter-select${typeFilter.size ? " gen-filter__btn--active" : ""}`}
              onClick={() => setTypeOpen((o) => !o)}
            >
              {typeFilter.size ? `Types (${typeFilter.size})` : "All Types"}
              <span className="gen-filter__arrow">{typeOpen ? "▲" : "▼"}</span>
            </button>
            {typeOpen && (
              <div className="gen-filter__dropdown">
                {TYPES.map((t) => (
                  <label key={t} className="gen-filter__item">
                    <input
                      type="checkbox"
                      checked={typeFilter.has(t)}
                      onChange={() => {
                        setTypeFilter((prev) => {
                          const next = new Set(prev);
                          next.has(t) ? next.delete(t) : next.add(t);
                          return next;
                        });
                        resetPage();
                      }}
                    />
                    <span
                      className="type-filter__dot"
                      style={{ background: TYPE_COLORS[t] }}
                    />
                    {t}
                  </label>
                ))}
                {typeFilter.size > 0 && (
                  <button
                    type="button"
                    className="gen-filter__clear"
                    onClick={() => { setTypeFilter(new Set()); resetPage(); }}
                  >
                    Clear
                  </button>
                )}
              </div>
            )}
          </div>
          <div className="gen-filter" ref={genRef}>
            <button
              type="button"
              className={`gen-filter__btn filter-select${genFilter.size ? " gen-filter__btn--active" : ""}`}
              onClick={() => setGenOpen((o) => !o)}
            >
              {genFilter.size ? `Gens (${genFilter.size})` : "All Gens"}
              <span className="gen-filter__arrow">{genOpen ? "▲" : "▼"}</span>
            </button>
            {genOpen && (
              <div className="gen-filter__dropdown">
                {GENERATIONS.map((g) => (
                  <label key={g.id} className="gen-filter__item">
                    <input
                      type="checkbox"
                      checked={genFilter.has(g.id)}
                      onChange={() => {
                        setGenFilter((prev) => {
                          const next = new Set(prev);
                          next.has(g.id) ? next.delete(g.id) : next.add(g.id);
                          return next;
                        });
                        resetPage();
                      }}
                    />
                    {g.label}
                  </label>
                ))}
                {genFilter.size > 0 && (
                  <button
                    type="button"
                    className="gen-filter__clear"
                    onClick={() => { setGenFilter(new Set()); resetPage(); }}
                  >
                    Clear
                  </button>
                )}
              </div>
            )}
          </div>
          <select
            className="filter-select"
            value={pageSize}
            onChange={(e) => { setPageSize(Number(e.target.value)); resetPage(); }}
          >
            {PAGE_SIZE_OPTIONS.map((n) => <option key={n} value={n}>{n} per page</option>)}
          </select>
        </div>

        <div className="tb__pool-count">{filtered.length} Pokémon · click to add</div>

        <div className="tb__grid">
          {visible.map((p) => {
            const onTeam = teamIds.includes(p.id);
            return (
              <PokemonCard
                key={p.id}
                pokemon={p}
                onSelect={addToTeam}
                selected={onTeam}
                disabled={onTeam || teamFull}
                showInfo
              />
            );
          })}
        </div>

        {totalPages > 1 && (
          <div className="tb__pagination">
            <button disabled={page === 1} onClick={() => setPage(1)}>«</button>
            <button disabled={page === 1} onClick={() => setPage((p) => p - 1)}>‹</button>
            <span>Page {page} of {totalPages}</span>
            <button disabled={page === totalPages} onClick={() => setPage((p) => p + 1)}>›</button>
            <button disabled={page === totalPages} onClick={() => setPage(totalPages)}>»</button>
          </div>
        )}
      </div>
    </div>
  );
}
