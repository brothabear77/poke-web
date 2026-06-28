import TypeBadge from "./TypeBadge";
import PokemonInfoBtn from "./PokemonInfoBtn";
import { assetUrl } from "../utils/assetUrl";

const remoteSprite = (id) =>
  `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${id}.png`;

export default function TeamSlotCard({ pokemon, onRemove, position, leaving }) {
  // position (1-6) lets CSS override popover direction for edge slots
  const side = position <= 3 ? "right" : "left";

  return (
    <div
      className={`tb__slot tb__slot--filled tb__slot--removable${leaving ? " tb__slot--leaving" : ""}`}
      onClick={() => onRemove(pokemon.id)}
      title="Click to remove"
    >
      <PokemonInfoBtn pokemon={pokemon} side={side} />

      <div className="tb__slot-num">#{String(pokemon.id).padStart(4, "0")}</div>
      <img
        className="tb__slot-sprite"
        src={assetUrl(`/sprites/pokemon/${pokemon.id}.png`)}
        onError={(e) => {
          if (!e.target.src.startsWith("http")) e.target.src = remoteSprite(pokemon.id);
        }}
        alt={pokemon.name}
      />
      <div className="tb__slot-name">{pokemon.name.replace(/-/g, " ")}</div>
      <div className="tb__slot-types">
        {pokemon.types.map((t) => <TypeBadge key={t} type={t} small />)}
      </div>
      {pokemon.bst != null && <div className="tb__slot-bst">BST {pokemon.bst}</div>}
    </div>
  );
}
