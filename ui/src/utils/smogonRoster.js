// Bridges the Smogon feed (keyed by species key) to poke-web's PokeAPI-id world for sprites.
//
// The Champions builder now sources its roster + metadata from the Smogon index (name, types,
// base stats, usage, mega linkage). But sprites still come from poke-web's PokeAPI-id assets, so
// we map each Smogon entry to a sprite id: base + regional forms match poke-web's pokemon-index
// by normalized name; mega formes (which PokeAPI/poke-web lack) fall back to their base species'
// national-dex number (`num`) — the existing <img> then renders base sprite + a "Mega" badge.

export const normName = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "");

// Map<normalizedName, pokeApiId> from poke-web's pokemon-index (allPokemon).
export function pokeIdByName(allPokemon) {
  const m = new Map();
  for (const p of allPokemon || []) if (p.name) m.set(normName(p.name), p.id);
  return m;
}

// The PokeAPI id to use for a Smogon entry's sprite.
export function spriteId(entry, idByName) {
  const hit = idByName.get(normName(entry.name));
  return hit ?? entry.num; // mega/unknown -> base national-dex num (always has a sprite)
}
