import { useState, useMemo } from "react";
import { useData } from "../hooks/useData";
import TypeBadge from "../components/TypeBadge";
import { assetUrl } from "../utils/assetUrl";
import { formatEvs } from "../utils/championsStrategy";
import "./ChampionsUsage.css";

function UsageSection({ title, items, showPct = true }) {
  if (!items?.length) return null;
  return (
    <div className="cu__section">
      <h3 className="cu__section-title">{title}</h3>
      {items.map((item) => (
        <div key={item.rank} className="cu__item-row">
          <span className="cu__item-rank">{item.rank}</span>
          <span className="cu__item-name">{item.name}</span>
          {showPct && item.percentage != null && (
            <div className="cu__bar-bg">
              <div className="cu__bar-fill" style={{ width: `${item.percentage}%` }} />
            </div>
          )}
          {showPct && item.percentage != null && (
            <span className="cu__item-pct">{item.percentage}%</span>
          )}
        </div>
      ))}
    </div>
  );
}

function NatureSection({ items }) {
  if (!items?.length) return null;
  return (
    <div className="cu__section cu__section--wide">
      <h3 className="cu__section-title">Natures</h3>
      {items.map((item) => (
        <div key={item.rank} className="cu__item-row cu__item-row--nature">
          <span className="cu__item-rank">{item.rank}</span>
          <span className="cu__item-name">{item.name}</span>
          <span className="cu__item-nature-stat">
            {item.stat_up && item.stat_down ? `+${item.stat_up} / -${item.stat_down}` : ""}
          </span>
          {item.percentage != null && (
            <div className="cu__bar-bg">
              <div className="cu__bar-fill" style={{ width: `${item.percentage}%` }} />
            </div>
          )}
          {item.percentage != null && (
            <span className="cu__item-pct">{item.percentage}%</span>
          )}
        </div>
      ))}
    </div>
  );
}

function SpreadSection({ items }) {
  if (!items?.length) return null;
  return (
    <div className="cu__section cu__section--wide">
      <h3 className="cu__section-title">EV Spreads</h3>
      {items.map((item) => (
        <div key={item.rank} className="cu__item-row">
          <span className="cu__item-rank">{item.rank}</span>
          <span className="cu__item-name cu__item-name--spread">{formatEvs(item.evs)}</span>
          {item.percentage != null && (
            <div className="cu__bar-bg">
              <div className="cu__bar-fill" style={{ width: `${item.percentage}%` }} />
            </div>
          )}
          {item.percentage != null && (
            <span className="cu__item-pct">{item.percentage}%</span>
          )}
        </div>
      ))}
    </div>
  );
}

function UsageDetail({ data, format }) {
  const fd = data.formats?.[format];
  if (!fd) return <div className="cu__empty">No {format} data available.</div>;
  return (
    <div className="cu__sections">
      <UsageSection title="Moves"     items={fd.move}           />
      <UsageSection title="Items"     items={fd.held_item}      />
      <UsageSection title="Abilities" items={fd.ability}        />
      <UsageSection title="Teammates" items={fd.teammate}       showPct={false} />
      <NatureSection                  items={fd.stat_alignment} />
      <SpreadSection                  items={fd.stat_points}    />
    </div>
  );
}

export default function ChampionsUsage() {
  const { data: allPokemon, loading: indexLoading } = useData("/data/pokemon-index.json");
  const { data: usageIds }                          = useData("/data/usage/_index.json");

  const [search,     setSearch]     = useState("");
  const [selectedId, setSelectedId] = useState(null);
  const [format,     setFormat]     = useState("Doubles");
  const [mobileView, setMobileView] = useState("list");

  const { data: usageData, loading: usageLoading } = useData(
    selectedId ? `/data/usage/${selectedId}.json` : null
  );

  // _index.json is [{id, doubles_rank, singles_rank}] sorted by doubles_rank
  const rankById = useMemo(() => {
    if (!usageIds) return null;
    const map = new Map();
    usageIds.forEach((entry) => map.set(entry.id, entry));
    return map;
  }, [usageIds]);

  const championsPokemon = useMemo(() => {
    if (!allPokemon || !rankById) return [];
    return allPokemon
      .filter((p) => rankById.has(p.id))
      .sort((a, b) => {
        const ra = rankById.get(a.id)?.doubles_rank ?? Infinity;
        const rb = rankById.get(b.id)?.doubles_rank ?? Infinity;
        return ra - rb;
      });
  }, [allPokemon, rankById]);

  const selectedPokemon = useMemo(
    () => championsPokemon.find((p) => p.id === selectedId) ?? null,
    [championsPokemon, selectedId]
  );

  const filtered = useMemo(() => {
    if (!search.trim()) return championsPokemon;
    const q = search.trim().toLowerCase();
    return championsPokemon.filter((p) => p.name.replace(/-/g, " ").includes(q));
  }, [championsPokemon, search]);

  function handleSelect(pokemon) {
    setSelectedId(pokemon.id);
    setMobileView("detail");
  }

  if (indexLoading || !rankById) {
    return <div className="cu__loading">Loading Champions data…</div>;
  }

  return (
    <div className="cu">
      {/* List panel */}
      <div className={`cu__list${mobileView === "detail" ? " cu__list--hidden" : ""}`}>
        <div className="cu__list-header">
          <h1 className="cu__title">Champions Usage</h1>
          <div className="cu__search-wrap">
            <input
              className="cu__search"
              placeholder="Search Pokémon…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {search && (
              <button className="search-clear" onClick={() => setSearch("")} aria-label="Clear search">✕</button>
            )}
          </div>
          <div className="cu__count">{filtered.length} Pokémon</div>
        </div>
        <div className="cu__pokemon-list">
          {filtered.map((p) => (
            <button
              key={p.id}
              className={`cu__pokemon-row${selectedId === p.id ? " cu__pokemon-row--selected" : ""}`}
              onClick={() => handleSelect(p)}
            >
              <img
                className="cu__pokemon-sprite"
                src={assetUrl(`/sprites/pokemon/${p.id}.png`)}
                alt={p.name}
                loading="lazy"
              />
              <span className="cu__pokemon-name">
                {p.name.replace(/-/g, " ")}
              </span>
              <div className="cu__pokemon-types">
                {p.types.map((t) => <TypeBadge key={t} type={t} small />)}
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Detail panel */}
      <div className={`cu__detail${mobileView === "list" ? " cu__detail--hidden" : ""}`}>
        {selectedId ? (
          <>
            <button className="cu__back" onClick={() => setMobileView("list")}>
              ← Back
            </button>
            {selectedPokemon && (() => {
              const ranks = rankById.get(selectedId);
              return (
                <div className="cu__detail-hero">
                  <img
                    className="cu__detail-sprite"
                    src={assetUrl(`/sprites/pokemon/${selectedId}.png`)}
                    alt={selectedPokemon.name}
                  />
                  <div className="cu__detail-meta">
                    <h2 className="cu__detail-name">
                      {selectedPokemon.name.replace(/-/g, " ")}
                    </h2>
                    <div className="cu__detail-types">
                      {selectedPokemon.types.map((t) => <TypeBadge key={t} type={t} />)}
                    </div>
                    <div className="cu__detail-ranks">
                      {ranks?.doubles_rank != null && (
                        <span className="cu__rank-badge">Doubles #{ranks.doubles_rank}</span>
                      )}
                      {ranks?.singles_rank != null && (
                        <span className="cu__rank-badge">Singles #{ranks.singles_rank}</span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })()}
            <div className="cu__format-toggle">
              <button
                className={`cu__fmt-btn${format === "Doubles" ? " active" : ""}`}
                onClick={() => setFormat("Doubles")}
              >Doubles</button>
              <button
                className={`cu__fmt-btn${format === "Singles" ? " active" : ""}`}
                onClick={() => setFormat("Singles")}
              >Singles</button>
            </div>
            {usageLoading
              ? <div className="cu__loading">Loading…</div>
              : usageData
                ? <UsageDetail data={usageData} format={format} />
                : null
            }
          </>
        ) : (
          <div className="cu__empty">Select a Pokémon to view usage data</div>
        )}
      </div>
    </div>
  );
}
