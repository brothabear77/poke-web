// Champions strategy layer.
//
// Pure functions that turn per-Pokémon build data into what the team builder needs:
// seed builds, role classification, real-moveset coverage, speed proxies, and
// usage-driven teammate scoring.
//
// DATA SOURCES: Smogon (poke-smogon-data, via useSmogonFiles) is the PRIMARY source —
// it's the same metagame as Champions but with richer data (weighted teammates, empirical
// checks/counters, full sets) and covers Mega formes Champions' own site doesn't list at
// all (Mega is a held-item mechanic there, and several Champions-original megas don't
// exist in the base games). Champions' own site (championsbattledata.com, via
// useUsageFiles) is a fresher (daily vs. Smogon's monthly) usage-rank overlay and a
// fallback when Smogon lacks a species/format. `getBuild` is the single seam that merges
// them — everything else here (and the page) is agnostic to where the data came from.

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

// Smogon's raw regulation code ("mb") -> the game's display form ("Reg M-B"). Shared by the
// team builder and usage pages (both show it next to their title, from useSmogonMeta()).
export function formatReg(reg) {
  if (!reg) return null;
  const u = reg.toUpperCase();
  return `Reg ${u.length > 1 ? `${u.slice(0, -1)}-${u.slice(-1)}` : u}`;
}

// Normalize a Smogon {name, pct} entry to the Champions-style {name, percentage} shape
// the rest of this file (and MemberEditor) already expects.
const rankedFrom = (list) => (list || []).map((e) => ({ name: e.name, percentage: e.pct }));

// The single accessor for a Pokémon's build data in a given format. Prefers the Smogon
// record (richer: real % teammates, checks/counters, natures); falls back to the
// Champions usage record for a species/format Smogon doesn't cover.
export function getBuild(smogonRecord, format, champUsage) {
  const sf = smogonRecord?.formats?.[format];
  if (sf) {
    return {
      moves:     rankedFrom(sf.moves),
      items:     rankedFrom(sf.items),
      abilities: rankedFrom(sf.abilities),
      natures:   (sf.natures || []).map((n) => ({ name: n.name, percentage: n.pct, stat_up: n.up, stat_down: n.down })),
      spreads:   (sf.spreads || []).map((s) => ({ name: s.nature, percentage: s.pct, evs: s.evs })),
      teammates: (sf.teammates || []).map((t) => ({ name: t.name, key: t.key, percentage: t.pct })),
      checks:    sf.checks || [],   // mons that beat this one
      counters:  sf.counters || [], // mons this one beats
    };
  }
  // Fallback: a species/format Smogon doesn't cover (rare — it covers ~all of the roster).
  const fd = champUsage?.formats?.[format] || {};
  return {
    moves:     fd.move || [],
    items:     fd.held_item || [],
    abilities: fd.ability || [],
    natures:   fd.stat_alignment || [],
    spreads:   fd.stat_points || [],
    teammates: fd.teammate || [],
    checks:    [],
    counters:  [],
  };
}

// Seed an editable build from the rank-1 picks (+ top-4 moves).
export function defaultBuild(smogonRecord, format, champUsage) {
  const b = getBuild(smogonRecord, format, champUsage);
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

// Score a candidate teammate for the current (partial) team. Blends real usage
// co-occurrence (Smogon's weighted teammate %, keyed by species key — much stronger
// signal than Champions' rank-only list) with type synergy from the shared engine.
//   candidate: a roster entry (candidate.id = its Smogon species key)
//   teamUsage: [{ pokemon, usage }]  usage = the member's Smogon record (same shape
//   coachReport/teamCoach.js expects, so the same array can feed both).
export function scoreTeammate(candidate, teamUsage, format, chart, analysis) {
  // Usage co-occurrence: sum the real teammate % wherever a member lists the candidate.
  let coocRaw = 0;
  const partners = [];
  for (const { pokemon, usage } of teamUsage) {
    const list = getBuild(usage, format).teammates;
    const hit = list.find((t) => t.key === candidate.id);
    if (hit) {
      coocRaw += hit.percentage || 0;
      partners.push(pokemon.name.replace(/-/g, " "));
    }
  }
  // Normalize against a generous ~50%-co-occurrence ceiling per member.
  const coocNorm = teamUsage.length ? coocRaw / (teamUsage.length * 50) : 0;

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
