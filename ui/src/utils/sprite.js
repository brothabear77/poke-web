import { assetUrl } from "./assetUrl";

// PokéAPI's remote sprite mirror — the intermediate fallback when a local sprite is absent.
export const remoteSprite = (id) =>
  `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${id}.png`;

// Local placeholder shown when a Pokémon has no sprite anywhere (e.g. Champions-original megas).
export const missingSprite = assetUrl("/missingPokemonSprite.svg");

// <img> onError handler with a fallback chain: try `next` once (an intermediate source such
// as the remote mirror or an official-artwork→sprite step), then the placeholder. Stateless
// and loop-safe: it compares resolved pathnames, so once `next` itself fails (or is absent)
// it lands on the placeholder and stops.
export function onSpriteError(e, next) {
  const el = e.target;
  if (el.src.includes("missingPokemonSprite")) return; // placeholder itself failed — stop
  if (next) {
    const failed = new URL(el.src, window.location.href).pathname;
    const nextPath = new URL(next, window.location.href).pathname;
    if (failed !== nextPath) { el.src = next; return; } // haven't tried `next` yet
  }
  el.src = missingSprite;
}
