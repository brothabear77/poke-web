import { useState } from "react";
import { useData } from "../hooks/useData";
import StatBar from "./StatBar";
import "./PokemonInfoBtn.css";

const STAT_ORDER = [
  "hp", "attack", "defense", "special-attack", "special-defense", "speed",
];

// "i" button that shows a stat + ability popover on hover.
// The detail file is only fetched on first hover, then cached.
// Props:
//   pokemon  — index entry (must have .id, .name; optionally .stats for instant display)
//   side     — "left" (popover opens leftward) | "right" (opens rightward), default "left"
export default function PokemonInfoBtn({ pokemon, side = "left" }) {
  const [touched, setTouched] = useState(false);
  const { data: detail } = useData(touched ? `/data/pokemon/${pokemon.id}.json` : null);

  const stats = pokemon.stats || detail?.stats;
  const abilities = detail?.abilities;

  return (
    <div
      className="pib"
      onClick={(e) => e.stopPropagation()}
      onMouseEnter={() => setTouched(true)}
    >
      <button type="button" className="pib__btn" aria-label="Show stats and abilities">
        i
      </button>
      <div className={`pib__popover pib__popover--${side}`}>
        <div className="pib__head">{pokemon.name.replace(/-/g, " ")}</div>
        <div className="pib__stats">
          {stats
            ? STAT_ORDER.map((s) =>
                stats[s] != null ? <StatBar key={s} statName={s} value={stats[s]} /> : null
              )
            : <div className="pib__muted">Loading…</div>}
        </div>
        <div className="pib__abilities-title">Abilities</div>
        <div className="pib__abilities">
          {abilities
            ? abilities.map((a) => (
                <span
                  key={a.name}
                  className={`pib__ability${a.is_hidden ? " pib__ability--hidden" : ""}`}
                >
                  {a.name.replace(/-/g, " ")}
                  {a.is_hidden && <em> (Hidden)</em>}
                </span>
              ))
            : <span className="pib__muted">{touched ? "Loading…" : ""}</span>}
        </div>
      </div>
    </div>
  );
}
