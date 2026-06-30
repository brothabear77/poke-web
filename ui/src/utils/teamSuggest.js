// Team analysis + suggestion engine.
//
// Pure functions (no React). Given the pokemon index (which now carries `bst`
// and `types`), a type-effectiveness `chart` (see typeChart.js), and the current
// team, we score every eligible candidate on a balanced blend of:
//   1. type diversity      — new types it brings to the team
//   2. offensive coverage  — super-effective defending types it newly covers
//   3. defensive synergy    — team weaknesses it patches, minus weaknesses it adds
//   4. base stat total      — raw power
//
// Weights are near-equal and tunable here.

import {
  ALL_TYPES,
  defenseMultiplier,
  offensiveCoverage,
} from "./typeChart";

// Default weights on a 0-100 scale. Passed in from the UI so users can tune them.
export const DEFAULT_WEIGHTS = {
  diversity:      100,
  offense:        100,
  defense:        100,
  bst:             80,
  offensivePower:  50,
  defensivePower:  50,
};

const MAX_BST = 720; // ~strongest legendaries; used to normalize bst term

// --- Team analysis ---------------------------------------------------------

export function analyzeTeam(team, chart) {
  const teamTypes = new Set();
  for (const p of team) for (const t of p.types) teamTypes.add(t);

  // Offensive: which of the 18 defending types the team hits super-effectively.
  const offensiveCovered = new Set();
  for (const p of team) {
    for (const def of offensiveCoverage(chart, p.types)) offensiveCovered.add(def);
  }
  const offensiveGaps = ALL_TYPES.filter((t) => !offensiveCovered.has(t));

  // Defensive: per attacking type, how many members are weak (>1x) / resist (<1x).
  const weakCounts = {};
  const resistCounts = {};
  for (const att of ALL_TYPES) {
    weakCounts[att] = 0;
    resistCounts[att] = 0;
    for (const p of team) {
      const m = defenseMultiplier(chart, att, p.types);
      if (m > 1) weakCounts[att]++;
      else if (m < 1) resistCounts[att]++;
    }
  }
  // Shared weakness = an attacking type that 2+ members are weak to.
  const sharedWeaknesses = ALL_TYPES.filter((att) => weakCounts[att] >= 2);

  const bstTotal = team.reduce((s, p) => s + (p.bst || 0), 0);
  const bstAvg = team.length ? Math.round(bstTotal / team.length) : 0;

  return {
    size: team.length,
    teamTypes,
    offensiveCovered,
    offensiveGaps,
    weakCounts,
    resistCounts,
    sharedWeaknesses,
    bstTotal,
    bstAvg,
  };
}

// --- Candidate scoring ------------------------------------------------------

export function scoreCandidate(candidate, analysis, chart, weights = DEFAULT_WEIGHTS) {
  const w = {
    diversity:      (weights.diversity      ?? DEFAULT_WEIGHTS.diversity)      / 100,
    offense:        (weights.offense        ?? DEFAULT_WEIGHTS.offense)        / 100,
    defense:        (weights.defense        ?? DEFAULT_WEIGHTS.defense)        / 100,
    bst:            (weights.bst            ?? DEFAULT_WEIGHTS.bst)            / 100,
    offensivePower: (weights.offensivePower ?? DEFAULT_WEIGHTS.offensivePower) / 100,
    defensivePower: (weights.defensivePower ?? DEFAULT_WEIGHTS.defensivePower) / 100,
  };
  // 1. Diversity: types not already on the team (0, 1, or 2).
  const newTypes = candidate.types.filter((t) => !analysis.teamTypes.has(t));
  const diversity = newTypes.length / 2;

  // 2. Offensive coverage gain: currently-uncovered defending types this
  //    candidate's STAB hits super-effectively.
  const cov = offensiveCoverage(chart, candidate.types);
  let offenseGain = 0;
  for (const def of analysis.offensiveGaps) if (cov.has(def)) offenseGain++;
  const offense = analysis.offensiveGaps.length
    ? offenseGain / analysis.offensiveGaps.length
    : 0;

  // 3. Defensive synergy (per-type gradient, so it matters from the 2nd pick on):
  //    reward resisting types the team is already weak to; penalize stacking onto
  //    them. Weighted by how many current members are weak to that type, so the
  //    engine actively avoids piling up shared weaknesses.
  let defenseScore = 0;
  let patched = 0; // shared weaknesses (2+) this candidate resists — for the reason text
  for (const att of ALL_TYPES) {
    const teamWeak = analysis.weakCounts[att];
    if (teamWeak === 0) continue;
    const m = defenseMultiplier(chart, att, candidate.types);
    if (m < 1) {
      defenseScore += teamWeak;
      if (teamWeak >= 2) patched++;
    } else if (m > 1) {
      defenseScore -= teamWeak;
    }
  }
  // Intrinsic self-defense: a candidate's own resistances minus weaknesses across
  // all 18 attacking types, normalized to ~[-1,1]. This keeps even the FIRST pick
  // (when the team has no weaknesses to react to yet) from being defensively frail,
  // which otherwise cascades through the greedy auto-fill.
  let selfResist = 0;
  let selfWeak = 0;
  for (const att of ALL_TYPES) {
    const m = defenseMultiplier(chart, att, candidate.types);
    if (m < 1) selfResist++;
    else if (m > 1) selfWeak++;
  }
  const selfDef = (selfResist - selfWeak) / ALL_TYPES.length;

  // Combine the team-synergy gradient with intrinsic bulk. Clamp to [0,1].
  const defenseDenom = Math.max(1, analysis.size) * 3;
  const defense = Math.max(
    0,
    0.6 * (defenseScore / defenseDenom) + 0.4 * selfDef
  );

  // 4. Raw power.
  const bst = (candidate.bst || 0) / MAX_BST;

  // 5 & 6. Stat distribution: offensive (Atk + SpA + Spe) and defensive
  //        (HP + Def + SpD), each normalized against half of MAX_BST (~360).
  const s = candidate.stats || {};
  const offensivePower =
    ((s.attack || 0) + (s["special-attack"] || 0) + (s.speed || 0)) / (MAX_BST / 2);
  const defensivePower =
    ((s.hp || 0) + (s.defense || 0) + (s["special-defense"] || 0)) / (MAX_BST / 2);

  const score =
    w.diversity      * diversity +
    w.offense        * offense +
    w.defense        * defense +
    w.bst            * bst +
    w.offensivePower * offensivePower +
    w.defensivePower * defensivePower;

  return { score, newTypes, offenseGain, patched };
}

// Build the short "why" string shown under each suggestion.
function reasonFor(meta, candidate) {
  const bits = [];
  if (meta.newTypes.length) {
    bits.push(`adds ${meta.newTypes.join(" & ")} typing`);
  }
  if (meta.offenseGain > 0) {
    bits.push(`+${meta.offenseGain} coverage`);
  }
  if (meta.patched > 0) {
    bits.push(`covers ${meta.patched} weakness${meta.patched > 1 ? "es" : ""}`);
  }
  bits.push(`BST ${candidate.bst}`);
  return bits.join(" · ");
}

function isEligible(p, team, opts) {
  if (team.some((m) => m.id === p.id)) return false;
  if (!opts.includeLegendary && (p.is_legendary || p.is_mythical)) return false;
  return true;
}

// --- Public API -------------------------------------------------------------

export function suggestTeam(allPokemon, chart, team, opts, n = 8, weights = DEFAULT_WEIGHTS) {
  if (!allPokemon || !chart) return [];
  const analysis = analyzeTeam(team, chart);

  const scored = [];
  for (const p of allPokemon) {
    if (!isEligible(p, team, opts)) continue;
    const meta = scoreCandidate(p, analysis, chart, weights);
    scored.push({ pokemon: p, score: meta.score, reason: reasonFor(meta, p) });
  }
  scored.sort((a, b) => b.score - a.score || b.pokemon.bst - a.pokemon.bst);
  return scored.slice(0, n);
}

// Greedily fill empty slots one at a time, re-analyzing after each pick.
export function autoFill(allPokemon, chart, team, opts, maxSize = 6, weights = DEFAULT_WEIGHTS) {
  if (!allPokemon || !chart) return team;
  const result = [...team];
  while (result.length < maxSize) {
    const top = suggestTeam(allPokemon, chart, result, opts, 1, weights)[0];
    if (!top) break;
    result.push(top.pokemon);
  }
  return result;
}
