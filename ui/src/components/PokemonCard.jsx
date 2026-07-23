import { Link } from "react-router-dom";
import TypeBadge from "./TypeBadge";
import PokemonInfoBtn from "./PokemonInfoBtn";
import { assetUrl } from "../utils/assetUrl";
import { onSpriteError } from "../utils/sprite";
import "./PokemonCard.css";

export default function PokemonCard({ pokemon, onSelect, selected, disabled, showInfo }) {
  const { id, name, types } = pokemon;
  const spriteUrl = assetUrl(`/sprites/pokemon/${id}.png`);
  const fallbackUrl = pokemon.sprite_front;

  const inner = (
    <>
      {showInfo && <PokemonInfoBtn pokemon={pokemon} side="left" />}
      <div className="pokemon-card__num">#{String(id).padStart(4, "0")}</div>
      <img
        className="pokemon-card__sprite"
        src={spriteUrl}
        onError={(e) => onSpriteError(e, fallbackUrl)}
        alt={name}
        loading="lazy"
      />
      <div className="pokemon-card__name">{(pokemon.display_name || name).replace(/-/g, " ")}</div>
      <div className="pokemon-card__types">
        {types.map((t) => <TypeBadge key={t} type={t} small />)}
      </div>
    </>
  );

  if (onSelect) {
    const cls = `pokemon-card pokemon-card--button${selected ? " pokemon-card--selected" : ""}`;
    return (
      <button
        type="button"
        className={cls}
        onClick={() => onSelect(pokemon)}
        disabled={disabled}
      >
        {inner}
      </button>
    );
  }

  return (
    <Link to={`/pokemon/${id}`} className="pokemon-card">
      {inner}
    </Link>
  );
}
