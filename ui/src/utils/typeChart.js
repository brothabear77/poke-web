// Type-effectiveness helpers derived from public/data/types.json.
//
// types.json is an array of 18 type objects, each with a `damage_relations`
// object listing the types it deals double / half / no damage TO. We turn that
// into a lookup `chart[attacking][defending] = multiplier` and expose helpers
// for team analysis.

export const ALL_TYPES = [
  "normal", "fire", "water", "electric", "grass", "ice",
  "fighting", "poison", "ground", "flying", "psychic", "bug",
  "rock", "ghost", "dragon", "dark", "steel", "fairy",
];

// Build chart[attacking][defending] = multiplier (2 / 1 / 0.5 / 0).
// Memoized so repeated calls with the same loaded data object are cheap.
let _cache = { src: null, chart: null };

export function buildChart(typesData) {
  if (!typesData) return null;
  if (_cache.src === typesData && _cache.chart) return _cache.chart;

  const chart = {};
  for (const att of ALL_TYPES) {
    chart[att] = {};
    for (const def of ALL_TYPES) chart[att][def] = 1;
  }

  for (const t of typesData) {
    const att = t.name;
    if (!chart[att]) continue;
    const rel = t.damage_relations || {};
    for (const d of rel.double_damage_to || []) chart[att][d.name] = 2;
    for (const d of rel.half_damage_to || []) chart[att][d.name] = 0.5;
    for (const d of rel.no_damage_to || []) chart[att][d.name] = 0;
  }

  _cache = { src: typesData, chart };
  return chart;
}

// How much damage a defender (1-2 types) takes from a single attacking type.
// Product of the per-type multipliers, so immunities (0) and 4x stacks work.
export function defenseMultiplier(chart, attackingType, defenderTypes) {
  if (!chart) return 1;
  let m = 1;
  for (const dt of defenderTypes) {
    m *= chart[attackingType]?.[dt] ?? 1;
  }
  return m;
}

// The set of defending types that an attacker's STAB types hit for > 1x.
export function offensiveCoverage(chart, attackerTypes) {
  const covered = new Set();
  if (!chart) return covered;
  for (const def of ALL_TYPES) {
    for (const att of attackerTypes) {
      if ((chart[att]?.[def] ?? 1) > 1) {
        covered.add(def);
        break;
      }
    }
  }
  return covered;
}
