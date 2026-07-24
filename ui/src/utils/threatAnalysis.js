// Deterministic threat analysis.
//
// LLMs are unreliable at type-chart math, so we compute it here and feed the
// model ground truth. For each common meta Pokémon we read its actual usage
// moveset (from Smogon — see championsStrategy.js's getBuild) and, using the type
// chart, find the specific damaging moves that hit a team member super-effectively
// (>= 2x) — respecting ability-based immunities (Levitate, Flash Fire, etc.). The
// LLM then reasons FROM these facts instead of (mis)calculating matchups itself.
//
// `id` throughout is the roster's canonical identifier — the Smogon species key
// (e.g. "garchomp", "staraptormega"), same convention as teamCoach.js's builds Map.

import { defenseMultiplier } from "./typeChart.js";
import { getBuild } from "./championsStrategy.js";

// Defensive abilities that zero out an incoming type (the type chart alone can't
// know these — they depend on the defender's chosen ability).
const ABILITY_IMMUNE_TYPE = {
  "Levitate": "ground",
  "Earth Eater": "ground",
  "Flash Fire": "fire",
  "Well-Baked Body": "fire",
  "Water Absorb": "water",
  "Storm Drain": "water",
  "Dry Skin": "water",
  "Volt Absorb": "electric",
  "Lightning Rod": "electric",
  "Motor Drive": "electric",
  "Sap Sipper": "grass",
};

// Returns [{ id, name, types, rank, hits: [{ move, moveType, damageClass, power,
// stab, target, targetTypes, mult }] }], sorted by how threatening (more/heavier
// super-effective hits first). Only threats with >=1 super-effective move appear.
//   team: roster entries currently on the team
//   threatList: [{ id, rank }] candidate meta Pokémon to check
//   smogonById: Map<id, smogonRecord> for the threat candidates (their real movesets)
//   byId: Map<id, roster entry> to resolve threatList entries to name/types
//   builds: Map<id, buildState> the TEAM's chosen builds (for ability immunity)
export function computeThreats({
  team, threatList, smogonById, byId, builds, format, moveMap, chart,
  maxThreats = 12, maxMovesPerThreat = 8,
}) {
  if (!chart || !team?.length) return [];

  // Per-member ability immunity (from the current build), for quick lookup.
  const immuneType = new Map();
  for (const p of team) {
    const ability = builds?.get(p.id)?.ability;
    if (ability && ABILITY_IMMUNE_TYPE[ability]) immuneType.set(p.id, ABILITY_IMMUNE_TYPE[ability]);
  }

  const out = [];
  for (const t of threatList) {
    const smogonRecord = smogonById.get(t.id);
    const poke = byId.get(t.id);
    if (!smogonRecord || !poke) continue;

    const build = getBuild(smogonRecord, format);
    const moves = (build.moves || []).slice(0, maxMovesPerThreat);
    const hits = [];
    const seen = new Set();

    for (const mv of moves) {
      const info = moveMap.get(mv.name);
      if (!info || !info.type || info.damage_class === "status") continue;
      const mtype = String(info.type).toLowerCase();

      for (const p of team) {
        if (immuneType.get(p.id) === mtype) continue; // ability negates it
        const mult = defenseMultiplier(chart, mtype, p.types);
        if (mult < 2) continue;
        const seenKey = `${mv.name}>${p.id}`;
        if (seen.has(seenKey)) continue;
        seen.add(seenKey);
        hits.push({
          move: mv.name,
          moveType: mtype,
          damageClass: info.damage_class,
          power: info.power || null,
          stab: poke.types.map((x) => x.toLowerCase()).includes(mtype),
          target: p.name.replace(/-/g, " "),
          targetId: p.id, // roster key, so a damage calc can be looked up per (threat, move, member)
          targetTypes: p.types,
          mult,
        });
      }
    }

    if (hits.length) {
      // STAB super-effective hits are the real danger — weight them.
      const weight = hits.reduce((s, h) => s + h.mult * (h.stab ? 1.5 : 1), 0);
      out.push({ id: t.id, name: poke.name.replace(/-/g, " "), types: poke.types, rank: t.rank, weight, hits });
    }
  }

  out.sort((a, b) => b.weight - a.weight || (a.rank ?? 1e9) - (b.rank ?? 1e9));
  return out.slice(0, maxThreats);
}
