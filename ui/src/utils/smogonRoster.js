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

// Champions usage → Smogon join.
//
// Champions is the authentic usage-rate source (players earn Pokémon, so access barriers make
// its popularity differ from Showdown's free-for-all — and it updates daily). We rank the roster
// by Champions rank. But Champions labels default/cosmetic formes with tags PokeAPI keeps and
// Smogon drops (e.g. "basculegion-male" → Smogon "basculegion", "tauros-paldea-aqua-breed" →
// "taurospaldeaaqua"). These aliases (verified against the live Smogon roster) bridge a Champions
// entry's PokeAPI name to its Smogon species key so the rank join connects for form Pokémon too.
const CHAMP_ALIAS = {
  basculegionmale: "basculegion", pyroarmale: "pyroar", meowsticmale: "meowstic",
  basculegionfemale: "basculegionf",
  mimikyudisguised: "mimikyu", aegislashshield: "aegislash", palafinzero: "palafin",
  lycanrocmidday: "lycanroc", morpekofullbelly: "morpeko",
  mausholdfamilyoffour: "maushold", gourgeistaverage: "gourgeist",
  // Champions' "Floette" is the mega-capable Eternal forme (Smogon has no plain Floette).
  floette: "floetteeternal",
  taurospaldeaaquabreed: "taurospaldeaaqua",
  taurospaldeablazebreed: "taurospaldeablaze",
  taurospaldeacombatbreed: "taurospaldeacombat",
};

// Smogon species key for a poke-web PokeAPI form name (used to join Champions usage → the roster).
export function smogonKeyForPokeName(pokeName) {
  const k = normName(pokeName);
  return CHAMP_ALIAS[k] || k;
}
