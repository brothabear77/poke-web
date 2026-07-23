import { Link } from "react-router-dom";
import { useData } from "../hooks/useData";
import FitScale from "./FitScale";
import { assetUrl } from "../utils/assetUrl";
import { onSpriteError } from "../utils/sprite";
import "./EvolutionChain.css";

function getTriggerLabel(details) {
  if (!details) return null;
  const fmt = (s) => s.replace(/-/g, " ");
  const parts = [];

  if (details.trigger === "trade") {
    parts.push(details.held_item ? `Trade (${fmt(details.held_item)})` : "Trade");
  } else if (details.trigger === "use-item" && details.item) {
    parts.push(fmt(details.item));
  } else if (details.happiness) {
    parts.push("Happiness");
  } else if (details.trigger === "level-up") {
    parts.push(details.min_level ? `Lv. ${details.min_level}` : "Level up");
  } else if (details.trigger) {
    parts.push(fmt(details.trigger));
  }

  if (details.held_item && details.trigger !== "trade") parts.push(fmt(details.held_item));
  if (details.time_of_day)            parts.push(fmt(details.time_of_day));
  if (details.known_move)             parts.push(`Know ${fmt(details.known_move)}`);
  if (details.known_move_type)        parts.push(`Know ${fmt(details.known_move_type)} move`);
  if (details.min_affection)          parts.push(`Affection ${details.min_affection}`);
  if (details.location)               parts.push(fmt(details.location));
  if (details.needs_overworld_rain)   parts.push("Rain");
  if (details.turn_upside_down)       parts.push("Upside down");
  if (details.relative_physical_stats === 1)  parts.push("Atk > Def");
  if (details.relative_physical_stats === -1) parts.push("Def > Atk");
  if (details.relative_physical_stats === 0)  parts.push("Atk = Def");

  return parts.join(" · ") || null;
}

function Arrow({ details, child, pokemonIndex, formIndex = 0 }) {
  const label = getTriggerLabel(details);
  return (
    <div className="evo-branch">
      <div className="evo-arrow">
        {label && <span className="evo-trigger">{label}</span>}
        <div className="evo-arrow-shaft">
          <span className="evo-arrow-line" />
          <span className="evo-arrow-head">&#8250;</span>
        </div>
      </div>
      <ChainNode node={child} pokemonIndex={pokemonIndex} formIndex={formIndex} />
    </div>
  );
}

function ChainNode({ node, pokemonIndex, formIndex = 0 }) {
  if (!node) return null;
  const speciesName = node.species_name;
  // Collect all forms for this species: exact match first, then prefix matches.
  const exact = pokemonIndex?.find((p) => p.name === speciesName);
  const prefixMatches = pokemonIndex?.filter((p) => p.name.startsWith(speciesName + "-")) ?? [];
  const allForms = exact ? [exact, ...prefixMatches] : prefixMatches;
  // formIndex lets the caller select a specific form (used when flatMap expands
  // multiple evolution_details onto the same species node, e.g. Lycanroc).
  const poke = allForms[formIndex] ?? allForms[0];
  const id = poke?.id;

  return (
    <div className="evo-group">
      <div className="evo-node">
        {id && (
          <Link to={`/pokemon/${id}`}>
            <img
              src={assetUrl(`/sprites/pokemon/${id}.png`)}
              onError={(e) => onSpriteError(e, poke?.sprite_front)}
              alt={speciesName}
              className="evo-sprite"
            />
            <div className="evo-name">{(poke?.display_name || poke?.name || speciesName).replace(/-/g, " ")}</div>
          </Link>
        )}
        {!id && <div className="evo-name">{speciesName}</div>}
      </div>
      {node.evolves_to?.length > 0 && (
        <div className="evo-children">
          {node.evolves_to.flatMap((child, i) => {
            const details = child.evolution_details;
            // If a single evolves_to node has multiple conditions, render one
            // arrow per condition (e.g. Lycanroc day/night/dusk, Sylveon Gen6/Gen8).
            if (details.length > 1) {
              return details.map((d, j) => (
                <Arrow key={`${i}-${j}`} details={d} child={child} pokemonIndex={pokemonIndex} formIndex={j} />
              ));
            }
            return [<Arrow key={i} details={details[0]} child={child} pokemonIndex={pokemonIndex} />];
          })}
        </div>
      )}
    </div>
  );
}

export default function EvolutionChain({ chainId, pokemonIndex }) {
  const { data, loading } = useData(`/data/evolution-chains/${chainId}.json`);
  if (loading) return <div className="evo-loading">Loading evolution chain...</div>;
  if (!data) return null;

  return (
    <FitScale>
      <div className="evo-chain">
        <ChainNode node={data.chain} pokemonIndex={pokemonIndex} />
      </div>
    </FitScale>
  );
}
