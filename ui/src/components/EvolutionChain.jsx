import { Link } from "react-router-dom";
import { useData } from "../hooks/useData";
import FitScale from "./FitScale";
import "./EvolutionChain.css";

function getTriggerLabel(details) {
  if (!details) return null;
  if (details.trigger === "level-up" && details.min_level) return `Lv. ${details.min_level}`;
  if (details.trigger === "use-item" && details.item) return details.item.replace(/-/g, " ");
  if (details.trigger === "trade") return details.held_item ? `Trade (${details.held_item.replace(/-/g, " ")})` : "Trade";
  if (details.happiness) return `Happiness${details.time_of_day ? ` (${details.time_of_day})` : ""}`;
  if (details.trigger) return details.trigger.replace(/-/g, " ");
  return null;
}

function ChainNode({ node, pokemonIndex }) {
  if (!node) return null;
  const speciesName = node.species_name;
  const poke = pokemonIndex?.find((p) => p.name === speciesName);
  const id = poke?.id;

  return (
    <div className="evo-group">
      <div className="evo-node">
        {id && (
          <Link to={`/pokemon/${id}`}>
            <img
              src={`/sprites/pokemon/${id}.png`}
              onError={(e) => { e.target.src = poke?.sprite_front || ""; }}
              alt={speciesName}
              className="evo-sprite"
            />
            <div className="evo-name">{speciesName.replace(/-/g, " ")}</div>
          </Link>
        )}
        {!id && <div className="evo-name">{speciesName}</div>}
      </div>
      {node.evolves_to?.length > 0 && (
        <div className="evo-children">
          {node.evolves_to.map((child, i) => {
            const triggerLabel = getTriggerLabel(child.evolution_details?.[0]);
            return (
              <div key={i} className="evo-branch">
                <div className="evo-arrow">
                  {triggerLabel && <span className="evo-trigger">{triggerLabel}</span>}
                  <div className="evo-arrow-shaft">
                    <span className="evo-arrow-line" />
                    <span className="evo-arrow-head">&#8250;</span>
                  </div>
                </div>
                <ChainNode node={child} pokemonIndex={pokemonIndex} />
              </div>
            );
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
