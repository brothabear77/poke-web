// Sim-backed ground truth for the coach: real damage %/KO and speed from @smogon/calc,
// so the LLM cites verified numbers instead of guessing "this OHKOs" / "you outspeed X".
//
// @smogon/calc is loaded LAZILY (dynamic import) so it stays out of the initial bundle and
// only loads when the coach runs. We feed it OUR OWN base stats + types via `overrides`, so
// damage/speed never depend on the calc dex's species/forme coverage (Champions-original megas
// like "Staraptor-Mega" aren't in the dex, but overrides supply their stats/types). Only the
// MOVE name must resolve in the calc dex; anything unresolved falls back to null (caller keeps
// the type-multiplier-only line).

import { getBuild } from "./championsStrategy";
import { detectInteractions } from "./interactionRules";

// Champions "stat points" (0–32) → standard EVs, via the HOME transfer rule: the first point
// is 4 EVs, each additional point 8 EVs (so 32 points → exactly 252 EVs) at level 50 / 31 IVs.
export const POINTS_TO_EV = (p) => (p ? Math.min(252, 4 + (p - 1) * 8) : 0);

const LEVEL = 50;
const IVS = { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 };

// Our EV spread keys → calc keys. build.evs uses {hp,attack,defense,sp_atk,sp_def,speed}.
const EV_MAP = { hp: "hp", attack: "atk", defense: "def", sp_atk: "spa", sp_def: "spd", speed: "spe" };
// Our base-stat keys → calc keys. p.stats uses {hp,attack,defense,special-attack,special-defense,speed}.
const BASE_MAP = { hp: "hp", attack: "atk", defense: "def", "special-attack": "spa", "special-defense": "spd", speed: "spe" };

// Abilities that set weather when in battle.
const ABILITY_WEATHER = {
  "Drought": "Sun",
  "Drizzle": "Rain",
  "Sand Stream": "Sandstorm",
  "Hail": "Hail",
  "Primordial Sea": "Heavy Rain",
  "Desolate Land": "Harsh Sunlight",
  "Delta Stream": "Strong Winds",
};

// Abilities that set terrain when in battle.
const ABILITY_TERRAIN = {
  "Grassy Surge": "Grassy Terrain",
  "Misty Surge": "Misty Terrain",
  "Psychic Surge": "Psychic Terrain",
  "Electric Surge": "Electric Terrain",
};

const toCalcEvs = (evs) => {
  const out = {};
  for (const [ours, calc] of Object.entries(EV_MAP)) out[calc] = POINTS_TO_EV(evs?.[ours] || 0);
  return out;
};
const toCalcBaseStats = (stats) => {
  const out = {};
  for (const [ours, calc] of Object.entries(BASE_MAP)) out[calc] = stats?.[ours] ?? 0;
  return out;
};
const toCalcTypes = (types) => (types || []).map((t) => t.charAt(0).toUpperCase() + t.slice(1));

// --- lazy engine ----------------------------------------------------------
let _cache = null;
export async function loadCalc() {
  if (!_cache) {
    const mod = await import("@smogon/calc");
    _cache = { mod, gen: mod.Generations.get(9) };
  }
  return _cache;
}

// A roster entry + build → a @smogon/calc Pokemon (stats/types pinned via overrides).
function toCalcMon(mod, gen, entry, build) {
  return new mod.Pokemon(gen, entry.name, {
    level: LEVEL,
    ability: build?.ability || undefined,
    item: build?.item || undefined,
    nature: build?.nature || undefined,
    evs: toCalcEvs(build?.evs),
    ivs: IVS,
    overrides: { baseStats: toCalcBaseStats(entry.stats), types: toCalcTypes(entry.types) },
  });
}

// The opposing threat's most-used set → a build shape toCalcMon accepts.
function topSetBuild(gb) {
  return {
    ability: gb.abilities?.[0]?.name || null,
    item: gb.items?.[0]?.name || null,
    nature: gb.natures?.[0]?.name || null,
    moves: (gb.moves || []).map((m) => m.name),
    evs: gb.spreads?.[0]?.evs || {},
  };
}

// One damage calc → a compact fact, or null if it can't hit / can't resolve.
function koFact(mod, gen, attacker, defender, moveName, field, moveCache) {
  try {
    const move = moveCache.get(moveName) || moveCache.set(moveName, new mod.Move(gen, moveName)).get(moveName);
    const res = mod.calculate(gen, attacker, defender, move, field);
    const [mn, mx] = res.range();
    if (!mx) return null; // immune / no damage
    const hp = defender.maxHP();
    const lo = Math.round((100 * mn) / hp);
    const hi = Math.round((100 * mx) / hp);
    let ko = null;
    try { ko = res.kochance()?.text; } catch { /* kochance throws on some edge results */ }
    return { lo, hi, ko, str: `${lo}–${hi}%${ko ? ` — ${ko}` : ""}` };
  } catch {
    return null;
  }
}

// Move flags (contact/priority/target/category/type) for the interaction-rules layer, read
// straight from @smogon/calc's dex. Cached at module scope — flags are static per generation.
// NOTE: the calc's `makesContact` property is NOT reliable (undefined on Pokemon Showdown's own
// dex build for this version) — the real signal is the sparse `flags.contact` object key.
const _flagCache = new Map();
function moveFlag(mod, gen, moveName) {
  if (_flagCache.has(moveName)) return _flagCache.get(moveName);
  let f = { contact: false, priority: 0, target: "normal", category: undefined, type: undefined };
  try {
    const m = new mod.Move(gen, moveName);
    f = { contact: !!m.flags?.contact, priority: m.priority ?? 0, target: m.target, category: m.category, type: m.type };
  } catch { /* unresolved move name — keep the default */ }
  _flagCache.set(moveName, f);
  return f;
}

const baseField = (mod, format) => new mod.Field({ gameType: format === "Doubles" ? "Doubles" : "Singles" });

// Build a field based on attacker/defender abilities that set weather or terrain.
// Returns { field, note } where note is " (in Sun)" etc. if weather/terrain applies.
// Note: does not model weather-negating abilities (Cloud Nine/Air Lock); rare enough to skip.
function battleField(mod, format, attackerAbility, defenderAbility) {
  const field = baseField(mod, format);
  let note = "";

  // Attacker's weather-setting ability takes precedence.
  if (attackerAbility && ABILITY_WEATHER[attackerAbility]) {
    field.weather = ABILITY_WEATHER[attackerAbility];
    note = ` (in ${field.weather})`;
  } else if (defenderAbility && ABILITY_WEATHER[defenderAbility]) {
    field.weather = ABILITY_WEATHER[defenderAbility];
    note = ` (in ${field.weather})`;
  }

  // Attacker's terrain-setting ability takes precedence.
  if (attackerAbility && ABILITY_TERRAIN[attackerAbility]) {
    field.terrain = ABILITY_TERRAIN[attackerAbility];
    note = ` (in ${field.terrain})`;
  } else if (defenderAbility && ABILITY_TERRAIN[defenderAbility]) {
    field.terrain = ABILITY_TERRAIN[defenderAbility];
    note = ` (in ${field.terrain})`;
  }

  return { field, note };
}

// --- batch entry point -----------------------------------------------------
// Returns { incoming, outgoing, toughTargets, interactions, speedOrder } for the current team +
// threats, all from real calc math. Fails soft: any per-pair error yields null and is skipped.
export async function computeCalcFacts({ team, currentBuilds, threats, smogonById, byId, format }) {
  const { mod, gen } = await loadCalc();
  const moveCache = new Map();

  // Build calc mons for team members (from their edited builds) and threats (top usage set).
  const members = new Map(); // id -> { entry, mon, ability, item, moves, hasTailwind }
  for (const p of team) {
    const build = currentBuilds.get(p.id);
    if (!build) continue;
    try {
      members.set(p.id, {
        entry: p, name: p.name, mon: toCalcMon(mod, gen, p, build),
        ability: build.ability || null, item: build.item || null, moves: (build.moves || []).filter(Boolean),
        hasTailwind: (build.moves || []).includes("Tailwind"),
      });
    } catch { /* skip */ }
  }
  const teamHasTailwind = [...members.values()].some((m) => m.hasTailwind);

  const threatMons = new Map(); // id -> { entry, name, mon, ability, item, scarf }
  for (const th of threats || []) {
    const rec = smogonById.get(th.id);
    const entry = byId.get(th.id);
    if (!rec || !entry) continue;
    const build = topSetBuild(getBuild(rec, format));
    try {
      threatMons.set(th.id, {
        entry, name: th.name, mon: toCalcMon(mod, gen, entry, build),
        ability: build.ability || null, item: build.item || null, scarf: build.item === "Choice Scarf",
      });
    } catch { /* skip */ }
  }

  // INCOMING: for each already-computed super-effective threat hit, real KO vs that member.
  const incoming = {}; // threatId -> { move -> { memberId -> "142–168% — guaranteed OHKO (in Sun)" } }
  for (const th of threats || []) {
    const ts = threatMons.get(th.id);
    if (!ts) continue;
    for (const h of th.hits || []) {
      const mem = members.get(h.targetId);
      if (!mem) continue;
      const { field, note } = battleField(mod, format, ts.ability, mem.ability);
      const f = koFact(mod, gen, ts.mon, mem.mon, h.move, field, moveCache);
      if (!f) continue;
      (incoming[th.id] ||= {});
      (incoming[th.id][h.move] ||= {});
      incoming[th.id][h.move][h.targetId] = f.str + note;
    }
  }

  // OUTGOING: each member's damaging moves vs each threat — keep the decisive results (OHKO/2HKO).
  // Also record which threats SOMEONE can cleanly KO, so we can derive the ones nobody can (below).
  const outgoing = {}; // memberId -> [{ threat, move, str, rank }]
  const koedThreatIds = new Set(); // threat ids OHKO'd or 2HKO'd by at least one member
  for (const [mid, mem] of members) {
    const rows = [];
    const build = currentBuilds.get(mid);
    for (const mv of build?.moves || []) {
      if (!mv) continue;
      let move;
      try { move = moveCache.get(mv) || moveCache.set(mv, new mod.Move(gen, mv)).get(mv); } catch { continue; }
      if (!move || move.category === "Status") continue;
      for (const [tid, ts] of threatMons) {
        const { field, note } = battleField(mod, format, mem.ability, ts.ability);
        const f = koFact(mod, gen, mem.mon, ts.mon, mv, field, moveCache);
        if (!f || !f.ko) continue;
        const rank = f.ko.includes("OHKO") ? 0 : f.ko.includes("2HKO") ? 1 : 2;
        if (rank > 1) continue; // only decisive KOs
        koedThreatIds.add(tid);
        rows.push({ threat: ts.name, move: mv, str: f.str + note, rank });
      }
    }
    rows.sort((a, b) => a.rank - b.rank);
    if (rows.length) outgoing[mid] = rows.slice(0, 8);
  }

  // TOUGH TARGETS: meta threats that NO team member OHKOs or 2HKOs — the mons you can't cleanly
  // muscle through, so the coach should plan pivots/switches/chip around them rather than a KO.
  const toughTargets = [];
  for (const [tid, ts] of threatMons) {
    if (!koedThreatIds.has(tid)) toughTargets.push(ts.name);
  }

  // SPEED ORDER: real L50 speeds for team + threats, merged and sorted, with Scarf/Tailwind notes.
  const tiers = [];
  for (const [id, mem] of members) tiers.push({ name: mem.name, spe: mem.mon.stats.spe, mine: true, id });
  for (const [, ts] of threatMons) tiers.push({ name: ts.name, spe: ts.mon.stats.spe, mine: false, scarf: ts.scarf });
  tiers.sort((a, b) => b.spe - a.spe);
  const speedOrder = { tiers, teamHasTailwind };

  // INTERACTIONS: deterministic cross-mechanic detection (weather/terrain synergy, contact-punish,
  // redirection+setup, Choice/Trick-Room clash, immunity-enabled/unsafe spread moves, opposing
  // Intimidate, priority-vs-faster-threat). See interactionRules.js for the full rule set.
  const flag = (name) => moveFlag(mod, gen, name);
  const interactions = detectInteractions({
    format,
    members: [...members.values()].map((m) => ({ name: m.name, types: m.entry.types, ability: m.ability, item: m.item, moves: m.moves })),
    threats: [...threatMons.values()].map((t) => ({ name: t.name, types: t.entry.types, ability: t.ability, item: t.item })),
    moveFlag: flag,
    speedOrder,
  }).slice(0, 12);

  return { incoming, outgoing, toughTargets, interactions, speedOrder };
}
