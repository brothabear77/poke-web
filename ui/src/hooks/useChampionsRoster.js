import { useMemo } from "react";
import { useData } from "./useData";
import { useSmogonIndex } from "./useSmogonFiles";
import { pokeIdByName, spriteId, smogonKeyForPokeName } from "../utils/smogonRoster";

// The full Champions-legal roster (base species + Mega formes as separate tiles), shared by any
// page that needs to let a user pick a Pokémon (Team Builder, Scenario Oracle, …). Smogon
// (poke-smogon-data) is PRIMARY — same metagame as Champions, richer (checks/counters, weighted
// teammates, full sets), and covers Mega formes Champions' own site doesn't list (Mega is a
// held-item mechanic there, and several Champions-original megas don't exist in the base games
// at all). Champions' own site is a fresher (daily vs. Smogon's monthly) usage-rank overlay.
//
// `id` is the Smogon species key throughout — the one canonical identifier for team/builds/analysis.
export function useChampionsRoster(format) {
  const { index: smogonIndex, loading: smogonLoading } = useSmogonIndex();
  const { data: allPokemon, loading: indexLoading } = useData("/data/pokemon-index.json");
  const { data: champUsageIndex } = useData("/data/usage/_index.json");

  // PokeAPI id lookup (by normalized name), for sprite resolution only.
  const idByName = useMemo(() => pokeIdByName(allPokemon), [allPokemon]);
  const pokeNameById = useMemo(() => {
    const m = new Map();
    for (const p of allPokemon || []) m.set(p.id, p.name);
    return m;
  }, [allPokemon]);
  // Champions' own usage index joined to Smogon species keys (via each entry's PokeAPI name
  // + form aliases). Champions is the authentic usage-rate source — players earn Pokémon, so
  // its popularity differs from Showdown's free-access ladder, and it refreshes daily.
  const champBySmogonKey = useMemo(() => {
    const m = new Map();
    for (const c of champUsageIndex || []) {
      const pname = pokeNameById.get(c.id);
      if (pname) m.set(smogonKeyForPokeName(pname), c);
    }
    return m;
  }, [champUsageIndex, pokeNameById]);
  // Mega forme key -> its base species key (base records carry the `megas` list).
  const megaToBaseKey = useMemo(() => {
    const m = new Map();
    for (const e of smogonIndex) if (e.megas) for (const mk of e.megas) m.set(mk, e.key);
    return m;
  }, [smogonIndex]);

  // The full roster (base species + Mega formes as separate tiles), ranked by the active
  // format's CHAMPIONS usage rank (a mega inherits its base species' rank — in-game the base's
  // usage is essentially the mega's, since the Mega Stone is its top item). Species Smogon has
  // but Champions doesn't rank fall to the end by Smogon usage.
  const roster = useMemo(() => {
    const rankKey = format === "Doubles" ? "doubles_rank" : "singles_rank";
    const smogonKeys = new Set(smogonIndex.map((e) => e.key));
    const smogonSourced = smogonIndex.map((e) => {
      const baseKey = e.isMega ? megaToBaseKey.get(e.key) : e.key;
      const champEntry = baseKey ? champBySmogonKey.get(baseKey) : null;
      return {
        id: e.key,
        name: e.name,
        types: e.types,
        bst: e.bst,
        stats: e.baseStats,
        num: e.num,
        isMega: e.isMega,
        megas: e.megas,
        spriteId: spriteId(e, idByName),
        usage: e.usage,
        champId: champEntry?.id ?? null,
        champRank: champEntry?.[rankKey] ?? null,
        noSmogon: false,
      };
    });
    // A few legal Champions Pokémon have no Showdown-ladder usage, so Smogon has no stats for
    // them (e.g. Watchog, or base formes of mons only ever run mega-evolved). Add them from
    // PokeAPI metadata + Champions usage, flagged so the UI marks the missing Smogon data
    // (no empirical checks/counters, sets from Champions only).
    const pokeById = new Map((allPokemon || []).map((p) => [p.id, p]));
    const champOnly = [];
    for (const c of champUsageIndex || []) {
      const pname = pokeNameById.get(c.id);
      if (!pname) continue;
      const key = smogonKeyForPokeName(pname);
      if (smogonKeys.has(key)) continue; // already covered by Smogon
      const p = pokeById.get(c.id);
      if (!p) continue;
      champOnly.push({
        id: key,
        name: c.name,
        types: p.types,
        bst: p.bst ?? Object.values(p.stats || {}).reduce((s, v) => s + v, 0),
        stats: p.stats,
        num: p.id,
        isMega: false,
        megas: undefined,
        spriteId: p.id,
        usage: { Doubles: null, Singles: null },
        champId: c.id,
        champRank: c[rankKey] ?? null,
        noSmogon: true,
      });
    }
    return [...smogonSourced, ...champOnly].sort((a, b) => {
      const ra = a.champRank ?? Infinity, rb = b.champRank ?? Infinity;
      if (ra !== rb) return ra - rb;               // Champions rank first
      if (a.isMega !== b.isMega) return a.isMega ? 1 : -1; // base before its mega
      return (b.usage?.[format] ?? 0) - (a.usage?.[format] ?? 0); // Smogon usage tiebreak
    });
  }, [smogonIndex, idByName, champBySmogonKey, megaToBaseKey, format, allPokemon, champUsageIndex, pokeNameById]);

  const byId = useMemo(() => {
    const m = new Map();
    for (const p of roster) m.set(p.id, p);
    return m;
  }, [roster]);

  // Smogon species key → sprite id, for rendering checks/counters as sprites.
  const spriteByKey = useMemo(() => {
    const m = new Map();
    for (const p of roster) m.set(p.id, p.spriteId);
    return m;
  }, [roster]);

  return { roster, byId, spriteByKey, idByName, loading: indexLoading || smogonLoading };
}
