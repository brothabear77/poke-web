// Champions strategy layer.
//
// Pure functions that turn the raw Champions usage JSON (per-format ranked
// moves / items / abilities / natures / EV-spreads + an ordinal teammate list)
// into the things the team builder needs: seed builds, role classification,
// real-moveset coverage, speed proxies, and usage-driven teammate scoring.
//
// SMOGON-LATER SEAM: every read of build data goes through `getBuild` below.
// To add a Smogon source, fetch it into a parallel cache and merge it inside
// `getBuild` behind a source flag — the page and the rest of this file stay put.

import { scoreCandidate } from "./teamSuggest";

const EV_LABELS = { hp: "HP", attack: "Atk", defense: "Def", sp_atk: "SpA", sp_def: "SpD", speed: "Spe" };

// "{32 Atk / 32 Spe}" — shared with ChampionsUsage. EV values are on the game's
// 0–32 "stat point" scale, not 0–252.
export function formatEvs(evs) {
  if (!evs) return "No EVs";
  return Object.entries(EV_LABELS)
    .filter(([k]) => evs[k])
    .map(([k, l]) => `${evs[k]} ${l}`)
    .join(" / ") || "No EVs";
}

// The single accessor for a Pokémon's build data in a given format.
export function getBuild(usageJson, format) {
  const fd = usageJson?.formats?.[format] || {};
  return {
    moves:     fd.move || [],
    items:     fd.held_item || [],
    abilities: fd.ability || [],
    natures:   fd.stat_alignment || [],
    spreads:   fd.stat_points || [],
    teammates: fd.teammate || [],
  };
}

// Seed an editable build from the rank-1 picks (+ top-4 moves).
export function defaultBuild(usageJson, format) {
  const b = getBuild(usageJson, format);
  return {
    ability: b.abilities[0]?.name ?? null,
    moves:   b.moves.slice(0, 4).map((m) => m.name),
    item:    b.items[0]?.name ?? null,
    nature:  b.natures[0]?.name ?? null,
    evs:     b.spreads[0]?.evs ?? null,
  };
}

// Look up a nature's +/- stats from the usage natures list, by name.
export function natureStats(natures, natureName) {
  const n = natures.find((x) => x.name === natureName);
  return n ? { up: n.stat_up || null, down: n.stat_down || null } : { up: null, down: null };
}

// Classify a competitive role from the chosen EV spread, nature, and base stats.
// EV-driven (relative investment), with base-stat tiebreaks for phys/special.
export function classifyRole(buildState, natures, baseStats) {
  const evs = buildState?.evs || {};
  const phys = evs.attack || 0;
  const spec = evs.sp_atk || 0;
  const spd  = evs.speed || 0;
  const bulk = (evs.hp || 0) + (evs.defense || 0) + (evs.sp_def || 0);
  const off  = Math.max(phys, spec);

  // Phys vs special: EV investment first, base stats as tiebreak.
  let side;
  if (phys !== spec) side = phys > spec ? "Physical" : "Special";
  else side = (baseStats?.attack || 0) >= (baseStats?.["special-attack"] || 0) ? "Physical" : "Special";

  const { up } = natureStats(natures || [], buildState?.nature);
  const fast = spd >= 20 || up === "Speed";

  if (off >= 20 && fast)              return `${side} Sweeper`;
  if (off >= 20 && bulk >= 28)        return `Bulky ${side} Attacker`;
  if (off >= 20)                      return `${side} Attacker`;
  if (bulk >= 36 && off < 12)         return "Wall";
  return "Pivot / Support";
}

// Build a Map<move display name, move-index entry> for coverage lookups.
export function movesByName(movesIndex) {
  const m = new Map();
  for (const mv of movesIndex || []) m.set(mv.display_name, mv);
  return m;
}

// Defending types a member's *actual common damaging moves* hit super-effectively.
export function movesetCoverage(moveNames, moveMap, chart) {
  const covered = new Set();
  if (!chart) return covered;
  for (const name of moveNames || []) {
    const mv = moveMap.get(name);
    if (!mv || mv.damage_class === "status" || !mv.type) continue;
    const row = chart[mv.type];
    if (!row) continue;
    for (const def in row) if (row[def] > 1) covered.add(def);
  }
  return covered;
}

// Rough speed proxy for cross-meta ranking: base + EV bump, scaled by nature.
export function effectiveSpeed(baseSpeed, buildState, natures) {
  const evSpeed = buildState?.evs?.speed || 0;
  const { up, down } = natureStats(natures || [], buildState?.nature);
  const mult = up === "Speed" ? 1.1 : down === "Speed" ? 0.9 : 1;
  return Math.round((baseSpeed + evSpeed * 1.5) * mult);
}

// Name <-> id maps from the augmented usage `_index.json` ([{id, name, ...}]).
export function nameToIdMap(usageIndex) {
  const m = new Map();
  for (const e of usageIndex || []) if (e.name) m.set(e.name, e.id);
  return m;
}
export function idToNameMap(usageIndex) {
  const m = new Map();
  for (const e of usageIndex || []) if (e.name) m.set(e.id, e.name);
  return m;
}

// Score a candidate teammate for the current (partial) team. Blends usage
// co-occurrence (how often current members run this candidate as a partner)
// with type synergy from the shared scoring engine.
//   teamUsage: [{ pokemon, usage }]  usage = the member's usage JSON
//   candidateName: the candidate's Champions display name (for teammate lookup)
export function scoreTeammate(candidate, candidateName, teamUsage, format, chart, analysis) {
  // Usage co-occurrence: sum (11 - rank) wherever a member lists the candidate.
  let coocRaw = 0;
  const partners = [];
  for (const { pokemon, usage } of teamUsage) {
    const list = getBuild(usage, format).teammates;
    const hit = list.find((t) => t.name === candidateName);
    if (hit) {
      coocRaw += Math.max(0, 11 - hit.rank);
      partners.push(pokemon.name.replace(/-/g, " "));
    }
  }
  const coocNorm = teamUsage.length ? coocRaw / (teamUsage.length * 10) : 0;

  const meta = scoreCandidate(candidate, analysis, chart);

  // Usage signal weighted to roughly match the type-synergy scale (~0–3).
  const score = meta.score + 3 * coocNorm;

  // Reason string.
  const bits = [];
  if (partners.length) {
    const shown = partners.slice(0, 2).join(" & ");
    bits.push(`partners with ${shown}${partners.length > 2 ? " +" : ""}`);
  }
  if (meta.patched > 0) bits.push(`patches ${meta.patched} weakness${meta.patched > 1 ? "es" : ""}`);
  else if (meta.newTypes.length) bits.push(`adds ${meta.newTypes.join(" & ")}`);
  else if (meta.offenseGain > 0) bits.push(`+${meta.offenseGain} coverage`);

  return { score, reason: bits.join(" · ") || `BST ${candidate.bst}`, partners };
}
