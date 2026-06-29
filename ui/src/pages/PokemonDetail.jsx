import { useMemo } from "react";
import { useParams, Link } from "react-router-dom";
import { useData } from "../hooks/useData";
import TypeBadge from "../components/TypeBadge";
import StatBar from "../components/StatBar";
import EvolutionChain from "../components/EvolutionChain";
import FitScale from "../components/FitScale";
import { assetUrl } from "../utils/assetUrl";
import { buildChart, defenseMultiplier, ALL_TYPES } from "../utils/typeChart";
import "./PokemonDetail.css";

const STAT_ORDER = ["hp", "attack", "defense", "special-attack", "special-defense", "speed"];

export default function PokemonDetail() {
  const { id } = useParams();
  const { data: poke, loading, error } = useData(`/data/pokemon/${id}.json`);
  const { data: pokemonIndex } = useData("/data/pokemon-index.json");
  const { data: typesData } = useData("/data/types.json");

  const chart = useMemo(() => buildChart(typesData), [typesData]);

  const defenses = useMemo(() => {
    if (!chart || !poke?.types) return null;
    const groups = { 0: [], 0.25: [], 0.5: [], 2: [], 4: [] };
    for (const att of ALL_TYPES) {
      const m = defenseMultiplier(chart, att, poke.types);
      if (m === 0)        groups[0].push(att);
      else if (m <= 0.25) groups[0.25].push(att);
      else if (m < 1)     groups[0.5].push(att);
      else if (m >= 4)    groups[4].push(att);
      else if (m >= 2)    groups[2].push(att);
    }
    return groups;
  }, [chart, poke?.types]);

  if (loading) return <div className="detail-loading">Loading...</div>;
  if (error || !poke) return <div className="detail-error">Pokémon not found.</div>;

  const artworkUrl = assetUrl(`/sprites/artwork/${poke.id}.png`);
  const spriteUrl = assetUrl(`/sprites/pokemon/${poke.id}.png`);
  const totalStats = STAT_ORDER.reduce((s, k) => s + (poke.stats?.[k] ?? 0), 0);

  // For alternate forms (id > 1025), resolve the National Dex number via species.
  // Fall back to a prefix match because some species names in the index have a
  // form suffix (e.g. "lycanroc" species → "lycanroc-midday" entry, id 745).
  const dexNum = poke.id <= 1025
    ? poke.id
    : (pokemonIndex?.find((p) => p.name === poke.species && p.id <= 1025)
    ?? pokemonIndex?.find((p) => p.name.startsWith(poke.species + "-") && p.id <= 1025))?.id
    ?? poke.id;

  const currentIdx = pokemonIndex?.findIndex((p) => p.id === poke.id) ?? -1;
  const prevId = currentIdx > 0 ? pokemonIndex[currentIdx - 1].id : null;
  const nextId = currentIdx >= 0 && currentIdx < (pokemonIndex?.length ?? 0) - 1
    ? pokemonIndex[currentIdx + 1].id : null;

  return (
    <div className="detail">
      <div className="detail__nav">
        <Link to="/pokedex">&larr; Pokédex</Link>
        <div className="detail__nav-arrows">
          {prevId && <Link to={`/pokemon/${prevId}`}>&lsaquo; #{String(prevId).padStart(4, "0")}</Link>}
          {nextId && <Link to={`/pokemon/${nextId}`}>#{String(nextId).padStart(4, "0")} &rsaquo;</Link>}
        </div>
      </div>

      <div className="detail__header">
        <div className="detail__artwork-wrap">
          <img
            className="detail__artwork"
            src={artworkUrl}
            onError={(e) => { e.target.src = spriteUrl; }}
            alt={poke.name}
          />
        </div>
        <div className="detail__headline">
          <div className="detail__num">#{String(poke.id).padStart(4, "0")}</div>
          <h1 className="detail__name">{(poke.display_name || poke.name).replace(/-/g, " ")}</h1>
          {poke.genera && <div className="detail__genus">{poke.genera}</div>}
          <div className="detail__types">
            {poke.types.map((t) => <TypeBadge key={t} type={t} />)}
          </div>
          {poke.flavor_text && (
            <p className="detail__flavor">{poke.flavor_text}</p>
          )}
          <div className="detail__meta-row">
            <div className="detail__meta-item">
              <span className="detail__meta-label">Pokédex No.</span>
              <span className="detail__meta-val">#{String(dexNum).padStart(4, "0")}</span>
            </div>
            <div className="detail__meta-item">
              <span className="detail__meta-label">Height</span>
              <span className="detail__meta-val">{((poke.height ?? 0) / 10).toFixed(1)} m</span>
            </div>
            <div className="detail__meta-item">
              <span className="detail__meta-label">Weight</span>
              <span className="detail__meta-val">{((poke.weight ?? 0) / 10).toFixed(1)} kg</span>
            </div>
            {poke.base_experience != null && (
              <div className="detail__meta-item">
                <span className="detail__meta-label">Base EXP</span>
                <span className="detail__meta-val">{poke.base_experience}</span>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="detail__body">
        {/* Stats */}
        <section className="detail__section">
          <h2 className="detail__section-title">Base Stats</h2>
          {STAT_ORDER.map((s) => (
            <StatBar key={s} statName={s} value={poke.stats?.[s] ?? 0} />
          ))}
          <div className="detail__total">Total: <strong>{totalStats}</strong></div>
        </section>

        {/* Abilities */}
        <section className="detail__section" style={{ alignSelf: "start" }}>
          <h2 className="detail__section-title">Abilities</h2>
          <div className="detail__abilities-scroll">
          <div className="detail__abilities">
            {poke.abilities?.map((a) => (
              <div key={a.name} className={`ability-chip${a.is_hidden ? " ability-chip--hidden" : ""}`}>
                <div className="ability-chip__name">{a.name.replace(/-/g, " ")}</div>
                {a.is_hidden && <div className="ability-chip__tag">Hidden</div>}
                {a.description && <div className="ability-chip__desc">{a.description}</div>}
              </div>
            ))}
          </div>
          </div>
        </section>

        {/* Species info */}
        <section className="detail__section">
          <h2 className="detail__section-title">Species Info</h2>
          <div className="detail__species-grid">
            {poke.generation_id && <DetailKV k="Generation" v={`Gen ${poke.generation_id}`} />}
            {poke.growth_rate && <DetailKV k="Growth Rate" v={poke.growth_rate.replace(/-/g, " ")} />}
            {poke.capture_rate != null && <DetailKV k="Catch Rate" v={poke.capture_rate} />}
            {poke.base_happiness != null && <DetailKV k="Base Happiness" v={poke.base_happiness} />}
            {poke.egg_groups?.length > 0 && <DetailKV k="Egg Groups" v={poke.egg_groups.join(", ")} />}
            {poke.hatch_counter != null && <DetailKV k="Hatch Steps" v={`~${(poke.hatch_counter + 1) * 255}`} />}
            {poke.color && <DetailKV k="Color" v={poke.color} />}
            {poke.habitat && <DetailKV k="Habitat" v={poke.habitat.replace(/-/g, " ")} />}
            {poke.is_legendary && <DetailKV k="Classification" v="Legendary" />}
            {poke.is_mythical && <DetailKV k="Classification" v="Mythical" />}
            {poke.is_baby && <DetailKV k="Baby" v="Yes" />}
          </div>
        </section>

        {/* Type Matchups */}
        {defenses && (
          <section className="detail__section" style={{ alignSelf: "start" }}>
            <h2 className="detail__section-title">Type Matchups</h2>
            <div className="detail__defenses">
              {[
                { key: 4,    label: "Weak",    sub: "4×"  },
                { key: 2,    label: "Weak",    sub: "2×"  },
                { key: 0.5,  label: "Resists", sub: "½×"  },
                { key: 0.25, label: "Resists", sub: "¼×"  },
                { key: 0,    label: "Immune",  sub: "0×"  },
              ].filter(({ key }) => defenses[key].length > 0).map(({ key, label, sub }) => (
                <div key={key} className="detail__defense-group">
                  <div className="detail__defense-label">
                    {label} <span className="detail__defense-mult">{sub}</span>
                  </div>
                  <div className="detail__defense-badges">
                    {defenses[key].map((t) => <TypeBadge key={t} type={t} small />)}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Evolution */}
        {poke.evolution_chain_id && (
          <section className="detail__section" style={{ alignSelf: "start" }}>
            <h2 className="detail__section-title">Evolution Chain</h2>
            <EvolutionChain chainId={poke.evolution_chain_id} pokemonIndex={pokemonIndex} />
          </section>
        )}

        {/* Level-up moves */}
        {poke.level_up_moves?.length > 0 && (
          <section className="detail__section" style={{ alignSelf: "start" }}>
            <h2 className="detail__section-title">Level-up Moves</h2>
            <FitScale>
              <div className="moves-table-wrap">
              <table className="moves-table">
                <thead>
                  <tr>
                    <th>Lv.</th>
                    <th>Move</th>
                  </tr>
                </thead>
                <tbody>
                  {poke.level_up_moves.map((mv) => (
                    <tr key={`${mv.level}-${mv.name}`}>
                      <td>{mv.level === 0 ? "—" : mv.level}</td>
                      <td>{mv.name.replace(/-/g, " ")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            </FitScale>
          </section>
        )}
      </div>
    </div>
  );
}

function DetailKV({ k, v }) {
  return (
    <div className="detail-kv">
      <span className="detail-kv__key">{k}</span>
      <span className="detail-kv__val" style={{ textTransform: "capitalize" }}>{v}</span>
    </div>
  );
}
