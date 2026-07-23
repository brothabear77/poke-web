import { useState, useEffect, useMemo } from "react";
import { useData } from "../hooks/useData";
import { useUsageFiles } from "../hooks/useUsageFiles";
import { useSmogonIndex, useSmogonFiles, useReplayData, useSmogonMeta } from "../hooks/useSmogonFiles";
import { pokeIdByName, spriteId, smogonKeyForPokeName } from "../utils/smogonRoster";
import { buildChart } from "../utils/typeChart";
import { analyzeTeam } from "../utils/teamSuggest";
import {
  defaultBuild,
  getBuild,
  classifyRole,
  scoreTeammate,
  formatEvs,
  formatReg,
  movesByName,
} from "../utils/championsStrategy";
import { memberTechNotes } from "../utils/mechanicsAnnotations";
import TypedMarkdown from "../components/TypedMarkdown";
import { computeThreats } from "../utils/threatAnalysis";
import { retrieve, synthesizeTeamQuery } from "../utils/knowledgeRetrieval";
import { logger } from "../utils/logger";
import { coachReport, answerQuestion, COACH_QUESTIONS } from "../utils/teamCoach";
import { loadPassword, savePassword, clearPassword, callCoach, embedQuery } from "../utils/llmClient";
import TypeBadge from "../components/TypeBadge";
import { assetUrl } from "../utils/assetUrl";
import { remoteSprite, onSpriteError } from "../utils/sprite";
import "./ChampionsTeamBuilder.css";

const MAX_TEAM = 6;
const FORMATS = ["Doubles", "Singles"];
const SLOT_LEAVE_MS = 260; // must match the ctb-slot-out animation duration in CSS
const ANALYSIS_DEBOUNCE_MS = 1000; // wait after a team/build change before calling the AI
const ROSTER_PAGE_SIZE = 20; // tiles per page in the full roster picker
const STAT_LABELS = [
  ["hp", "HP"], ["attack", "Atk"], ["defense", "Def"],
  ["special-attack", "SpA"], ["special-defense", "SpD"], ["speed", "Spe"],
];
const cap = (t) => t.charAt(0).toUpperCase() + t.slice(1);
const pct1 = (n) => (n == null ? null : `${(n * 100).toFixed(1)}%`);

// Popularity label: Champions rank where we have it (the authentic figure), else the
// Smogon usage % (for the few species Champions doesn't separately rank, e.g. some megas).
const usageLabel = (p, format) =>
  p.champRank ? `Champions #${p.champRank}` : (pct1(p.usage?.[format]) ? `${pct1(p.usage[format])} usage` : "");

function loadJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

export default function ChampionsTeamBuilder() {
  // Roster + build data: Smogon (poke-smogon-data) is PRIMARY — same metagame as
  // Champions, richer (checks/counters, weighted teammates, full sets), and covers
  // Mega formes Champions' own site doesn't list (Mega is a held-item mechanic there,
  // and several Champions-original megas don't exist in the base games at all).
  // Champions' own site is a fresher (daily vs. Smogon's monthly) usage-rank overlay.
  const { index: smogonIndex, loading: smogonLoading } = useSmogonIndex();
  const replayData = useReplayData();
  const smogonMeta = useSmogonMeta();
  const { data: allPokemon, loading: indexLoading } = useData("/data/pokemon-index.json");
  const { data: champUsageIndex } = useData("/data/usage/_index.json");
  const { data: movesIndex } = useData("/data/moves-index.json");
  const { data: itemsIndex } = useData("/data/items-index.json");
  const { data: abilitiesIndex } = useData("/data/abilities-index.json");
  const { data: typesData } = useData("/data/types.json");
  const { data: knowledgeEmbeddings } = useData("/data/knowledge-embeddings.json");

  const [format, setFormat] = useState("Doubles");
  const [teamIds, setTeamIds] = useState(() => loadJson("champions-team", []).slice(0, MAX_TEAM));
  const [buildsStore, setBuildsStore] = useState(() => loadJson("champions-builds", {}));
  const [expandedId, setExpandedId] = useState(null);
  const [leavingIds, setLeavingIds] = useState(new Set());
  const [rosterSearch, setRosterSearch] = useState("");
  const [rosterPage, setRosterPage] = useState(1);
  // Which matchup chip's name is revealed — single-open across all chips (tap another to switch).
  const [openChip, setOpenChip] = useState(null);
  const toggleChip = (id) => setOpenChip((cur) => (cur === id ? null : id));

  useEffect(() => { localStorage.setItem("champions-team", JSON.stringify(teamIds)); }, [teamIds]);
  useEffect(() => { localStorage.setItem("champions-builds", JSON.stringify(buildsStore)); }, [buildsStore]);
  // Back to page 1 whenever the filtered roster changes (search or format).
  useEffect(() => { setRosterPage(1); }, [rosterSearch, format]);

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

  // The full roster (305: base species + Mega formes as separate tiles), ranked by the active
  // format's CHAMPIONS usage rank (a mega inherits its base species' rank — in-game the base's
  // usage is essentially the mega's, since the Mega Stone is its top item). Species Smogon has
  // but Champions doesn't rank fall to the end by Smogon usage. `id` is the Smogon species key
  // throughout — the one canonical identifier for team/builds/analysis.
  const championsPokemon = useMemo(() => {
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
    for (const p of championsPokemon) m.set(p.id, p);
    return m;
  }, [championsPokemon]);

  // Smogon species key → sprite id, for rendering checks/counters as sprites.
  const spriteByKey = useMemo(() => {
    const m = new Map();
    for (const p of championsPokemon) m.set(p.id, p.spriteId);
    return m;
  }, [championsPokemon]);

  // Load Smogon build data for the team AND the top meta threats, so threat analysis
  // and recommendations can read real movesets/checks (not just typings).
  const threatCandidateIds = useMemo(() => {
    const onTeam = new Set(teamIds);
    // Threats need real Smogon movesets, so skip the (low-ranked) no-Smogon mons.
    return championsPokemon.filter((p) => !onTeam.has(p.id) && !p.noSmogon).slice(0, 24).map((p) => p.id);
  }, [championsPokemon, teamIds]);
  const analysisIds = useMemo(
    // Don't fetch Smogon files for no-Smogon mons (they'd 404); their builds come from Champions.
    () => [...new Set([...teamIds, ...threatCandidateIds])].filter((id) => !byId.get(id)?.noSmogon),
    [teamIds, threatCandidateIds, byId]
  );
  const { byKey: smogonById } = useSmogonFiles(analysisIds);

  // Champions per-mon usage for the TEAM ONLY — a fresher-usage overlay and the
  // fallback getBuild() falls back to for the handful of species/format combos
  // Smogon's stats happen not to cover.
  const team = useMemo(() => teamIds.map((id) => byId.get(id)).filter(Boolean), [teamIds, byId]);
  const champTeamIds = useMemo(() => team.map((p) => p.champId).filter((x) => x != null), [team]);
  const { byId: champUsageById } = useUsageFiles(champTeamIds);

  const moveMap = useMemo(() => movesByName(movesIndex), [movesIndex]);
  // Effect-text lookups (display name -> short effect), used to ground the LLM
  // in how each mechanic actually works. Data-driven, so new abilities/moves/
  // items from a future season are covered automatically.
  const abilityEffects = useMemo(() => {
    const m = new Map();
    for (const a of abilitiesIndex || []) if (a.display_name) m.set(a.display_name, a.short_effect);
    return m;
  }, [abilitiesIndex]);
  const itemEffects = useMemo(() => {
    const m = new Map();
    for (const it of itemsIndex || []) if (it.display_name) m.set(it.display_name, it.short_effect || it.flavor_text);
    return m;
  }, [itemsIndex]);
  const chart = useMemo(() => buildChart(typesData), [typesData]);
  const analysis = useMemo(() => analyzeTeam(team, chart), [team, chart]);

  const teamUsage = useMemo(
    () => team.map((p) => ({ pokemon: p, usage: smogonById.get(p.id) })).filter((m) => m.usage),
    [team, smogonById]
  );

  // Resolved build for each member: stored override, else rank-1 default
  // (Smogon primary, Champions fallback for the rare species/format Smogon misses).
  const currentBuilds = useMemo(() => {
    const m = new Map();
    for (const p of team) {
      const stored = buildsStore[p.id]?.[format];
      if (stored) m.set(p.id, stored);
      else {
        const smogonRecord = smogonById.get(p.id);
        const champUsage = p.champId != null ? champUsageById.get(p.champId) : null;
        if (smogonRecord || champUsage) m.set(p.id, defaultBuild(smogonRecord, format, champUsage));
      }
    }
    return m;
  }, [team, buildsStore, format, smogonById, champUsageById]);

  function addToTeam(p) {
    setTeamIds((ids) => (ids.length >= MAX_TEAM || ids.includes(p.id) ? ids : [...ids, p.id]));
  }
  function removeFromTeam(id) {
    // Play the drop-out animation, then actually remove after it finishes.
    setLeavingIds((prev) => new Set([...prev, id]));
    if (expandedId === id) setExpandedId(null);
    setTimeout(() => {
      setTeamIds((ids) => ids.filter((x) => x !== id));
      setLeavingIds((prev) => { const n = new Set(prev); n.delete(id); return n; });
    }, SLOT_LEAVE_MS);
  }
  function clearTeam() {
    setLeavingIds(new Set(teamIds));
    setExpandedId(null);
    setTimeout(() => {
      setTeamIds([]);
      setLeavingIds(new Set());
    }, SLOT_LEAVE_MS);
  }
  function updateBuild(id, patch) {
    setBuildsStore((prev) => {
      const base = prev[id]?.[format] || currentBuilds.get(id) || {};
      return { ...prev, [id]: { ...(prev[id] || {}), [format]: { ...base, ...patch } } };
    });
  }

  // Teammate recommendations.
  const recommendations = useMemo(() => {
    if (!chart || team.length >= MAX_TEAM || !championsPokemon.length) return [];
    const onTeam = new Set(teamIds);
    const pool = championsPokemon.filter((p) => !onTeam.has(p.id));
    if (team.length === 0) {
      return pool.slice(0, 12).map((p) => ({ pokemon: p, reason: usageLabel(p, format) }));
    }
    const scored = pool.map((p) => {
      const r = scoreTeammate(p, teamUsage, format, chart, analysis);
      return { pokemon: p, score: r.score, reason: r.reason };
    });
    scored.sort((a, b) => b.score - a.score || b.pokemon.bst - a.pokemon.bst);
    return scored.slice(0, 12);
  }, [chart, team, teamIds, championsPokemon, teamUsage, format, analysis]);

  // Full Champions roster, searchable + paginated, for the bottom picker.
  const filteredRoster = useMemo(() => {
    if (!rosterSearch.trim()) return championsPokemon;
    const q = rosterSearch.trim().toLowerCase();
    return championsPokemon.filter((p) => p.name.replace(/-/g, " ").toLowerCase().includes(q));
  }, [championsPokemon, rosterSearch]);
  const rosterTotalPages = Math.max(1, Math.ceil(filteredRoster.length / ROSTER_PAGE_SIZE));
  const rosterPageSafe = Math.min(rosterPage, rosterTotalPages);
  const pagedRoster = filteredRoster.slice((rosterPageSafe - 1) * ROSTER_PAGE_SIZE, rosterPageSafe * ROSTER_PAGE_SIZE);

  const report = useMemo(
    () => coachReport(team, currentBuilds, analysis, teamUsage, movesIndex, format, chart),
    [team, currentBuilds, analysis, teamUsage, movesIndex, format, chart]
  );

  // Top meta Pokémon (by the active format's Champions usage) for the coach's general context.
  const metaThreats = useMemo(
    () => championsPokemon.slice(0, 30).map((p) => ({
      name: p.name.replace(/-/g, " "),
      types: p.types,
      rank: p.champRank,
    })),
    [championsPokemon]
  );

  // Deterministic, move-level threat analysis: which specific meta Pokémon have
  // moves that actually hit this team super-effectively (type chart + ability
  // immunities computed in code, not by the LLM).
  const threats = useMemo(
    () => computeThreats({
      team,
      threatList: threatCandidateIds.map((id) => ({ id, rank: byId.get(id)?.champRank })),
      smogonById,
      byId,
      builds: currentBuilds,
      format,
      moveMap,
      chart,
    }),
    [team, threatCandidateIds, smogonById, byId, currentBuilds, format, moveMap, chart]
  );

  // Empirical matchups (Smogon): for each team member, the real Pokémon that most often
  // beat it (checkedBy) and that it most often beats (counters) in actual battles — signals
  // the type chart can't produce. Scores are the winner's matchup win rate.
  const empiricalMatchups = useMemo(() => {
    return team.map((p) => {
      const b = getBuild(smogonById.get(p.id), format);
      return {
        id: p.id,
        name: p.name.replace(/-/g, " "),
        checkedBy: (b.checks || []).slice(0, 5),
        counters: (b.counters || []).slice(0, 5),
      };
    }).filter((m) => m.checkedBy.length || m.counters.length);
  }, [team, smogonById, format]);

  if (indexLoading || smogonLoading) return <div className="ctb-loading">Loading Champions data…</div>;

  return (
    <div className="ctb-page">
      <div className="ctb-head">
        <h1 className="ctb-h1">
          Champions Team Builder
          {formatReg(smogonMeta?.regulation) && ` (${formatReg(smogonMeta.regulation)})`}
        </h1>
        <div className="ctb-fmt">
          {FORMATS.map((f) => (
            <button
              key={f}
              className={`ctb-fmt__btn${format === f ? " active" : ""}`}
              onClick={() => setFormat(f)}
            >{f}</button>
          ))}
        </div>
      </div>

      {/* Team slots */}
      <div className="ctb-panel">
        <div className="ctb-panel__head">
          <h2 className="ctb-panel__title">Your Team <span className="ctb-muted">({team.length}/6)</span></h2>
          {team.length > 0 && <button className="ctb-btn ctb-btn--ghost" onClick={clearTeam}>Clear</button>}
        </div>
        <div className="ctb-slots">
          {Array.from({ length: MAX_TEAM }).map((_, i) => {
            const p = team[i];
            if (!p) return <div key={i} className="ctb-slot ctb-slot--empty">Slot {i + 1}</div>;
            const build = currentBuilds.get(p.id);
            const usage = smogonById.get(p.id);
            const natures = usage ? getBuild(usage, format).natures : [];
            const role = build ? classifyRole(build, natures, p.stats) : "…";
            const leaving = leavingIds.has(p.id);
            return (
              <div
                key={p.id}
                className={`ctb-slot ctb-slot--filled ctb-slot--removable${expandedId === p.id ? " ctb-slot--active" : ""}${leaving ? " ctb-slot--leaving" : ""}`}
                onClick={() => removeFromTeam(p.id)}
                title="Click to remove"
              >
                <button
                  className="ctb-slot__info"
                  onClick={(e) => { e.stopPropagation(); setExpandedId((id) => (id === p.id ? null : p.id)); }}
                  aria-label="Build details"
                  title="Ability, moves, item, EVs"
                >i</button>
                {p.isMega && <span className="ctb-slot__mega" title="Mega Evolution">MEGA</span>}
                {p.noSmogon && <span className="ctb-slot__nosmog" title="No Smogon data — build reflects Champions usage; empirical checks & counters unavailable">no Smogon</span>}
                <img
                  className="ctb-slot__sprite"
                  src={assetUrl(`/sprites/pokemon/${p.spriteId}.png`)}
                  onError={(e) => onSpriteError(e, remoteSprite(p.spriteId))}
                  alt={p.name}
                />
                <div className="ctb-slot__name">{p.name.replace(/-/g, " ")}</div>
                <div className="ctb-slot__role">{role}</div>
                <div className="ctb-slot__types">
                  {p.types.map((t) => <TypeBadge key={t} type={t} small />)}
                </div>
              </div>
            );
          })}
        </div>

        {/* Build editor */}
        {expandedId && team.some((p) => p.id === expandedId) && (
          <MemberEditor
            key={expandedId}
            pokemon={byId.get(expandedId)}
            usage={smogonById.get(expandedId)}
            champUsage={byId.get(expandedId)?.champId != null ? champUsageById.get(byId.get(expandedId).champId) : null}
            format={format}
            build={currentBuilds.get(expandedId)}
            moveMap={moveMap}
            onChange={(patch) => updateBuild(expandedId, patch)}
            spriteByKey={spriteByKey}
            openChip={openChip}
            onToggleChip={toggleChip}
          />
        )}
      </div>

      {/* Recommendations */}
      {team.length < MAX_TEAM && (
        <div className="ctb-panel">
          <div className="ctb-panel__head">
            <h2 className="ctb-panel__title">
              {team.length === 0 ? "Top Picks to Start" : "Recommended Teammates"}
            </h2>
          </div>
          <div className="ctb-recs">
            {recommendations.map(({ pokemon, reason }) => (
              <button key={pokemon.id} className="ctb-rec" onClick={() => addToTeam(pokemon)}>
                {pokemon.isMega && <span className="ctb-rec__mega" title="Mega Evolution">MEGA</span>}
                {pokemon.noSmogon && <span className="ctb-rec__nosmog" title="No Smogon data — Champions usage only, no empirical checks/counters">no Smogon</span>}
                <img
                  className="ctb-rec__sprite"
                  src={assetUrl(`/sprites/pokemon/${pokemon.spriteId}.png`)}
                  onError={(e) => onSpriteError(e, remoteSprite(pokemon.spriteId))}
                  alt={pokemon.name}
                  loading="lazy"
                />
                <div className="ctb-rec__name">{pokemon.name.replace(/-/g, " ")}</div>
                <div className="ctb-rec__types">
                  {pokemon.types.map((t) => <TypeBadge key={t} type={t} small />)}
                </div>
                {reason && <div className="ctb-rec__reason">{reason}</div>}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Analysis */}
      {team.length > 0 && (
        <div className="ctb-panel">
          <h2 className="ctb-panel__title">Team Analysis</h2>
          <div className="ctb-analysis">
            <div className="ctb-an__block">
              <div className="ctb-an__label">Offensive coverage</div>
              <div className="ctb-an__frac">{report.coveredCount}<span>/18</span></div>
              <div className="ctb-an__badges">
                {report.gaps.length
                  ? report.gaps.map((t) => <TypeBadge key={t} type={t} small />)
                  : <span className="ctb-good">Complete coverage</span>}
              </div>
              {report.gaps.length > 0 && <div className="ctb-an__hint">gaps (not hit super-effectively)</div>}
            </div>
            <div className="ctb-an__block">
              <div className="ctb-an__label">Shared weaknesses</div>
              <div className="ctb-an__badges">
                {report.poorAgainst.length
                  ? report.poorAgainst.map((t) => (
                      <span key={t} className="ctb-weak">
                        <TypeBadge type={t} small /> ×{analysis.weakCounts[t]}
                      </span>
                    ))
                  : <span className="ctb-good">None</span>}
              </div>
            </div>
            <div className="ctb-an__block ctb-an__block--stats">
              <div><div className="ctb-an__num">{analysis.bstTotal}</div><div className="ctb-an__sub">Total BST</div></div>
              <div><div className="ctb-an__num">{analysis.bstAvg}</div><div className="ctb-an__sub">Avg BST</div></div>
            </div>
          </div>

          {/* Empirical matchups (Smogon) */}
          {empiricalMatchups.length > 0 && (
            <div className="ctb-checks">
              <div className="ctb-an__label">Empirical matchups <span className="ctb-muted">(Smogon, same meta — real win rates)</span></div>
              <div className="ctb-checks__grid">
                {empiricalMatchups.map((m) => (
                  <div key={m.id} className="ctb-checks__row">
                    <span className="ctb-checks__name">{m.name}</span>
                    {m.checkedBy.length > 0 && (
                      <div className="ctb-checks__line">
                        <span className="ctb-checks__dir ctb-checks__dir--bad">Countered by</span>
                        <span className="ctb-checks__chips">
                          {m.checkedBy.map((c) => <MatchupChip key={c.key || c.name} id={`an-${m.id}-bad-${c.key || c.name}`} openId={openChip} onToggle={toggleChip} entry={c} spriteByKey={spriteByKey} variant="bad" />)}
                        </span>
                      </div>
                    )}
                    {m.counters.length > 0 && (
                      <div className="ctb-checks__line">
                        <span className="ctb-checks__dir ctb-checks__dir--good">Counters</span>
                        <span className="ctb-checks__chips">
                          {m.counters.map((c) => <MatchupChip key={c.key || c.name} id={`an-${m.id}-good-${c.key || c.name}`} openId={openChip} onToggle={toggleChip} entry={c} spriteByKey={spriteByKey} variant="good" />)}
                        </span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Coach */}
      <CoachPanel
        report={report}
        team={team}
        currentBuilds={currentBuilds}
        format={format}
        moveMap={moveMap}
        abilityEffects={abilityEffects}
        itemEffects={itemEffects}
        metaThreats={metaThreats}
        threats={threats}
        empiricalMatchups={empiricalMatchups}
        replayData={replayData}
        byId={byId}
        spriteByKey={spriteByKey}
        openChip={openChip}
        onToggleChip={toggleChip}
        knowledgeEmbeddings={knowledgeEmbeddings}
      />

      {/* Full roster picker */}
      <div className="ctb-panel">
        <div className="ctb-panel__head">
          <h2 className="ctb-panel__title">
            All Champions Pokémon <span className="ctb-muted">({championsPokemon.length})</span>
            {team.length >= MAX_TEAM && <span className="ctb-muted"> · team full — remove a member to add more</span>}
          </h2>
          <div className="ctb-search">
            <input
              className="ctb-search__input"
              placeholder="Search…"
              value={rosterSearch}
              onChange={(e) => setRosterSearch(e.target.value)}
            />
            {rosterSearch && <button className="ctb-search__clear" onClick={() => setRosterSearch("")} aria-label="Clear">✕</button>}
          </div>
        </div>
        <div className="ctb-recs">
          {pagedRoster.map((p) => {
            const onTeam = teamIds.includes(p.id);
            return (
              <button
                key={p.id}
                className={`ctb-rec${onTeam ? " ctb-rec--on-team" : ""}`}
                onClick={() => addToTeam(p)}
                disabled={onTeam || team.length >= MAX_TEAM}
              >
                {p.isMega && <span className="ctb-rec__mega" title="Mega Evolution">MEGA</span>}
                {p.noSmogon && <span className="ctb-rec__nosmog" title="No Smogon data — Champions usage only, no empirical checks/counters">no Smogon</span>}
                <img
                  className="ctb-rec__sprite"
                  src={assetUrl(`/sprites/pokemon/${p.spriteId}.png`)}
                  onError={(e) => onSpriteError(e, remoteSprite(p.spriteId))}
                  alt={p.name}
                  loading="lazy"
                />
                <div className="ctb-rec__name">{p.name.replace(/-/g, " ")}</div>
                <div className="ctb-rec__types">
                  {p.types.map((t) => <TypeBadge key={t} type={t} small />)}
                </div>
                <div className="ctb-rec__reason">
                  {onTeam ? "On team" : usageLabel(p, format)}
                </div>
              </button>
            );
          })}
        </div>

        {rosterTotalPages > 1 && (
          <div className="ctb-pagination">
            <button disabled={rosterPageSafe === 1} onClick={() => setRosterPage(1)}>«</button>
            <button disabled={rosterPageSafe === 1} onClick={() => setRosterPage((p) => p - 1)}>‹</button>
            <span>Page {rosterPageSafe} of {rosterTotalPages}</span>
            <button disabled={rosterPageSafe === rosterTotalPages} onClick={() => setRosterPage((p) => p + 1)}>›</button>
            <button disabled={rosterPageSafe === rosterTotalPages} onClick={() => setRosterPage(rosterTotalPages)}>»</button>
          </div>
        )}
      </div>
    </div>
  );
}

// --- Build editor ----------------------------------------------------------

function Field({ label, children }) {
  return (
    <label className="ctb-field">
      <span className="ctb-field__label">{label}</span>
      {children}
    </label>
  );
}

// A checks/counters entry rendered as a sprite + win-rate pill. Falls back to the
// name if we can't resolve a sprite for the key. `variant`: "bad" = beats this mon,
// "good" = this mon beats it.
function MatchupChip({ entry, spriteByKey, variant, id, openId, onToggle, value }) {
  // Name hidden by default; revealed on hover (desktop) or tap-toggle (mobile).
  // Open state is shared (single-open): tapping another chip closes this one.
  const spId = spriteByKey?.get(entry.key);
  const pct = value ?? `${(entry.score * 100).toFixed(0)}%`;
  const label = entry.name.replace(/-/g, " ");
  const revealed = openId === id;
  return (
    <span
      className={`ctb-mchip ctb-mchip--${variant}${revealed ? " is-revealed" : ""}`}
      onClick={() => onToggle(id)}
    >
      {spId != null ? (
        <img
          className="ctb-mchip__sprite"
          src={assetUrl(`/sprites/pokemon/${spId}.png`)}
          onError={(e) => onSpriteError(e, remoteSprite(spId))}
          alt={label}
          loading="lazy"
        />
      ) : (
        <span className="ctb-mchip__name">{label}</span>
      )}
      <span className="ctb-mchip__pct">{pct}</span>
      {spId != null && <span className="ctb-mchip__tip" aria-hidden="true">{label}</span>}
    </span>
  );
}

function MemberEditor({ pokemon, usage, champUsage, format, build, moveMap, onChange, spriteByKey, openChip, onToggleChip }) {
  if (!build || (!usage && !champUsage)) return <div className="ctb-editor ctb-editor--loading">Loading build…</div>;
  const b = getBuild(usage, format, champUsage);
  const notes = memberTechNotes(pokemon, build, moveMap);

  const setMove = (i, value) => {
    const moves = [...(build.moves || [])];
    moves[i] = value || null;
    onChange({ moves });
  };

  return (
    <div className="ctb-editor">
      <div className="ctb-editor__title">
        {pokemon.name.replace(/-/g, " ")} — {format} build
        {pokemon.champRank && <span className="ctb-muted ctb-editor__rank"> · Champions #{pokemon.champRank} this week</span>}
      </div>
      {pokemon.noSmogon && (
        <div className="ctb-editor__nosmog">
          No Smogon data for this Pokémon — its sets come from Champions usage, and empirical
          checks &amp; counters aren't available.
        </div>
      )}
      <div className="ctb-editor__grid">
        <Field label="Ability">
          <select value={build.ability || ""} onChange={(e) => onChange({ ability: e.target.value })}>
            {b.abilities.map((a, i) => (
              <option key={i} value={a.name}>{a.name} ({a.percentage}%)</option>
            ))}
          </select>
        </Field>

        <Field label="Item">
          <select value={build.item || ""} onChange={(e) => onChange({ item: e.target.value })}>
            {b.items.map((it, i) => (
              <option key={i} value={it.name}>{it.name} ({it.percentage}%)</option>
            ))}
          </select>
        </Field>

        <Field label="Nature">
          <select value={build.nature || ""} onChange={(e) => onChange({ nature: e.target.value })}>
            {b.natures.map((n, i) => (
              <option key={i} value={n.name}>
                {n.name}{n.stat_up ? ` (+${n.stat_up}/-${n.stat_down})` : ""}
              </option>
            ))}
          </select>
        </Field>

        <Field label="EV Spread">
          <select
            value={formatEvs(build.evs)}
            onChange={(e) => {
              const sp = b.spreads.find((s) => formatEvs(s.evs) === e.target.value);
              if (sp) onChange({ evs: sp.evs });
            }}
          >
            {b.spreads.map((s, i) => (
              <option key={i} value={formatEvs(s.evs)}>{formatEvs(s.evs)} ({s.percentage}%)</option>
            ))}
          </select>
        </Field>

        <div className="ctb-editor__moves">
          <span className="ctb-field__label">Moves</span>
          <div className="ctb-editor__moves-grid">
            {[0, 1, 2, 3].map((i) => (
              <select key={i} value={(build.moves || [])[i] || ""} onChange={(e) => setMove(i, e.target.value)}>
                <option value="">— none —</option>
                {b.moves.map((mv, j) => (
                  <option key={j} value={mv.name}>
                    {mv.name} ({mv.percentage}%)
                  </option>
                ))}
              </select>
            ))}
          </div>
        </div>
      </div>

      {notes.length > 0 && (
        <div className="ctb-editor__notes">
          {notes.map((n, i) => (
            <div key={i} className="ctb-note">
              <span className={`ctb-note__tag ctb-note__tag--${n.tag}`}>{n.tag}</span>
              <span>{n.text}</span>
            </div>
          ))}
        </div>
      )}

      {(b.checks?.length > 0 || b.counters?.length > 0) && (
        <div className="ctb-editor__checks">
          {b.checks?.length > 0 && (
            <div className="ctb-editor__mrow">
              <span className="ctb-field__label">Countered by (Smogon)</span>
              <div className="ctb-editor__checks-list">
                {b.checks.slice(0, 6).map((c) => (
                  <MatchupChip key={c.key || c.name} id={`ed-${pokemon.id}-bad-${c.key || c.name}`} openId={openChip} onToggle={onToggleChip} entry={c} spriteByKey={spriteByKey} variant="bad" />
                ))}
              </div>
            </div>
          )}
          {b.counters?.length > 0 && (
            <div className="ctb-editor__mrow">
              <span className="ctb-field__label">Counters (Smogon)</span>
              <div className="ctb-editor__checks-list">
                {b.counters.slice(0, 6).map((c) => (
                  <MatchupChip key={c.key || c.name} id={`ed-${pokemon.id}-good-${c.key || c.name}`} openId={openChip} onToggle={onToggleChip} entry={c} spriteByKey={spriteByKey} variant="good" />
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Base stats across the bottom */}
      <div className="ctb-editor__stats">
        {STAT_LABELS.map(([key, label]) => (
          <div key={key} className="ctb-stat">
            <span className="ctb-stat__label">{label}</span>
            <span className="ctb-stat__val">{pokemon.stats?.[key] ?? "—"}</span>
          </div>
        ))}
        <div className="ctb-stat ctb-stat--total">
          <span className="ctb-stat__label">BST</span>
          <span className="ctb-stat__val">{STAT_LABELS.reduce((s, [k]) => s + (pokemon.stats?.[k] ?? 0), 0)}</span>
        </div>
      </div>
    </div>
  );
}

// --- Coach panel -----------------------------------------------------------

// Nature → Speed effect (fixed game data), so the grounding can give an effective-speed
// estimate the coach can order turns around without us shipping the full nature table.
const SPE_UP = new Set(["Jolly", "Timid", "Naive", "Hasty"]);
const SPE_DOWN = new Set(["Brave", "Relaxed", "Quiet", "Sassy"]);

// Assemble the grounding for the LLM. Crucially this includes the *effect text*
// of each ability / move / item straight from the data indexes, so the model can
// reason about how the mechanics work and how they interact — and so a future
// season's new mechanics are covered automatically (no hardcoding).
function buildFacts(report, team, currentBuilds, format, moveMap, abilityEffects, itemEffects, metaThreats, threats, empiricalMatchups, replayData, byId, knowledgeChunks) {
  if (report.empty) return "The team is empty.";
  const bringCount = format === "Doubles" ? 4 : 3;
  const roleById = new Map(report.roles.map((r) => [r.id, r.role]));
  const lines = [];
  lines.push(`Format: ${format} (Pokémon Champions metagame).`);
  lines.push(`BRING RULE: both players bring their full 6 to Team Preview but use only ${bringCount} per battle. Analyze the team as ${bringCount}-Pokémon subsets ("brings") — which ${bringCount} work best together, how those specific Pokémon interact, and what each subset struggles with — not all 6 as if simultaneously in play.`);
  lines.push(`Team offensive coverage: ${report.coveredCount}/18 types. Gaps (not hit super-effectively): ${report.gaps.map(cap).join(", ") || "none"}.`);
  lines.push(`Shared weaknesses (2+ members weak): ${report.poorAgainst.map(cap).join(", ") || "none"}.`);
  lines.push(`Solidly resisted: ${report.resisted.map(cap).join(", ") || "none"}.`);
  lines.push(`Total BST ${report.bstTotal}, avg ${report.bstAvg}.`);
  lines.push("");
  lines.push("MEMBERS (each mechanic's real effect is given so you can reason about interactions):");
  for (const p of team) {
    const b = currentBuilds.get(p.id);
    if (!b) continue;
    lines.push(`• ${p.name.replace(/-/g, " ")} [${p.types.join("/")}]${p.isMega ? " (Mega Evolution)" : ""} — ${roleById.get(p.id) || "—"}`);
    if (b.ability) lines.push(`    Ability — ${b.ability}: ${abilityEffects.get(b.ability) || "(effect unknown)"}`);
    if (b.item) lines.push(`    Item — ${b.item}: ${itemEffects.get(b.item) || "(effect unknown)"}`);
    const moves = (b.moves || []).filter(Boolean);
    if (moves.length) {
      lines.push("    Moves:");
      for (const mv of moves) {
        const e = moveMap.get(mv);
        const meta = e ? ` (${e.type}/${e.damage_class}${e.power ? `, ${e.power} BP` : ""})` : "";
        lines.push(`      - ${mv}${meta}: ${e?.short_effect || "(effect unknown)"}`);
      }
    }
    if (b.nature) lines.push(`    Nature ${b.nature}; EVs ${formatEvs(b.evs)}`);
    const spe = p.stats?.speed;
    if (spe != null) {
      const evSpe = b.evs?.speed || 0;
      const mult = SPE_UP.has(b.nature) ? 1.1 : SPE_DOWN.has(b.nature) ? 0.9 : 1;
      const eff = Math.round((spe + evSpe * 1.5) * mult);
      const tag = mult > 1 ? ", speed-boosting nature" : mult < 1 ? ", speed-lowering nature" : "";
      lines.push(`    Speed — base ${spe}${evSpe ? `, ${evSpe} Spe EV` : ""}${tag} → ~${eff} effective (use for turn order; higher moves first, barring priority/Trick Room)`);
    }
    // Curated, deterministic mechanic roles for THIS build (redirection/speed-control/
    // priority/defensive/…). These are authoritative — a role a member lacks won't appear.
    const tech = memberTechNotes(p, b, moveMap);
    if (tech.length) {
      lines.push("    Mechanic roles (curated & accurate — trust these exact roles; a capability not listed here is one this Pokémon does NOT have):");
      for (const t of tech) lines.push(`      · [${t.tag}] ${t.text}`);
    }
    // Real-game opening behavior from Showdown replays (same meta, rating-weighted). This is
    // how this Pokémon is ACTUALLY led + played turn 1 — ground the opening plan in it.
    const rd = replayData?.[format]?.species?.[p.id];
    if (rd && rd.broughtN >= 8) {
      const led = Math.round(rd.leadRate * 100);
      const wr = rd.leadWinrate ? `, wins ${Math.round(rd.leadWinrate * 100)}% when it leads` : "";
      lines.push(`    Real-game openings (Showdown replays, n=${rd.broughtN}): led ${led}% of the games it's brought${wr}.`);
      if (rd.turn1?.length) lines.push(`      Typical turn-1 move: ${rd.turn1.slice(0, 4).map((t) => `${t.move} ${t.pct}%`).join(", ")}.`);
      if (rd.partners?.length) {
        const names = rd.partners.slice(0, 3).map((x) => (byId?.get(x.key)?.name || x.key).replace(/-/g, " ") + ` ${x.pct}%`);
        lines.push(`      Usual lead partners: ${names.join(", ")}.`);
      }
    }
  }
  const megas = team.filter((p) => p.isMega);
  if (megas.length > 1) {
    lines.push("");
    lines.push(`ONE-MEGA CONSTRAINT: this team has ${megas.length} Mega formes (${megas.map((m) => m.name.replace(/-/g, " ")).join(", ")}). Only ONE can Mega Evolve per battle — the game plan must pick exactly one; the rest play as their base forme that game.`);
  }
  // If the replay openings are still partly from the previous regulation, say so — the coach
  // should treat opening suggestions as provisional until this season's sample builds up.
  const prov = replayData?.[format]?.provenance;
  if (prov?.priorReg && prov.priorShare >= 0.15) {
    lines.push("");
    lines.push(`NOTE — the replay-derived openings, lead rates, and lead pairs are ${Math.round(prov.priorShare * 100)}% from the PREVIOUS regulation (${prov.priorReg}); this season's sample is still building, so present those opening suggestions as provisional.`);
  }
  // Lead-PAIR success from replays: real win rate when two of your Pokémon are led together —
  // ranks candidate opening pairs (popularity ≠ success). Only pairs with enough games.
  const pairData = replayData?.[format]?.pairs;
  if (pairData && team.length >= 2) {
    // Shrink win rate toward 50% by sample size so a small-sample fluke (e.g. 5-0) can't
    // outrank a robustly-sampled pair, and require a real sample before recommending at all.
    const adj = (wr, n) => (wr * n + 0.5 * 15) / (n + 15);
    const rows = [];
    for (let i = 0; i < team.length; i++) for (let j = i + 1; j < team.length; j++) {
      const pd = pairData[[team[i].id, team[j].id].sort().join("|")];
      if (pd && pd.n >= 15) rows.push({ a: team[i].name.replace(/-/g, " "), b: team[j].name.replace(/-/g, " "), winrate: pd.winrate, n: pd.n, score: adj(pd.winrate, pd.n) });
    }
    if (rows.length) {
      rows.sort((x, y) => y.score - x.score);
      lines.push("");
      lines.push("LEAD-PAIR SUCCESS (real games, rating-weighted — win rate when THIS pair of your Pokémon is led together, ordered best-first by a sample-size-adjusted rank so flukes don't top the list. POPULAR ≠ BEST):");
      for (const r of rows) lines.push(`  - ${r.a} + ${r.b}: ${Math.round(r.winrate * 100)}% win rate (n=${r.n})`);
    }
  }
  if (report.teamTech?.length) {
    lines.push("");
    lines.push("Detected synergy hints (you may expand on or go beyond these):");
    for (const t of report.teamTech) lines.push(`  - ${t}`);
  }
  lines.push("");
  if (threats?.length) {
    lines.push("COMPUTED SUPER-EFFECTIVE THREATS — type effectiveness (and ability immunities) calculated from the chart; treat as GROUND TRUTH. Do NOT compute your own matchups. If a move is not listed here as super-effective against one of your Pokémon, it is NOT super-effective:");
    for (const th of threats) {
      const hitStrs = th.hits.map((h) =>
        `${h.move} (${cap(h.moveType)}${h.stab ? " STAB" : ""}${h.power ? `, ${h.power} BP` : ""}, ${h.damageClass}) → your ${h.target} ${h.mult}×`
      );
      lines.push(`  - ${th.name} [${th.types.join("/")}]${th.rank ? ` (rank ${th.rank})` : ""}: ${hitStrs.join("; ")}`);
    }
  } else {
    lines.push("COMPUTED THREATS: no common meta Pokémon has a super-effective move against your current team (per the type chart). Pressure will come from strong neutral attackers, coverage moves, or utility (speed control, Fake Out, redirection) — do not invent type advantages.");
  }
  if (empiricalMatchups?.length) {
    lines.push("");
    lines.push("EMPIRICAL MATCHUPS (Smogon, same meta — real win rates from battle logs, not a type calculation; treat as GROUND TRUTH alongside the computed threats above. % is the winner's rate):");
    for (const m of empiricalMatchups) {
      if (m.checkedBy.length) lines.push(`  - ${m.name} is BEATEN BY: ${m.checkedBy.map((c) => `${c.name} (${(c.score * 100).toFixed(0)}%)`).join(", ")}`);
      if (m.counters.length) lines.push(`  - ${m.name} BEATS: ${m.counters.map((c) => `${c.name} (${(c.score * 100).toFixed(0)}%)`).join(", ")}`);
    }
  }
  if (metaThreats?.length) {
    lines.push("");
    lines.push("OTHER COMMON META POKÉMON (popular in the format; discuss as offensive/utility threats if relevant, but do NOT assert any super-effective or immune matchup that isn't in the COMPUTED list above):");
    lines.push("  " + metaThreats.slice(0, 15).map((t) => t.name).join(", "));
  }
  if (knowledgeChunks?.length) {
    lines.push("");
    lines.push("RELEVANT STRATEGY KNOWLEDGE (general competitive reference — background only, NOT matchup facts about this team):");
    for (const c of knowledgeChunks) lines.push(`  - ${c.title}: ${c.text}`);
  }
  return lines.join("\n");
}

const BREAKDOWN_PROMPT =
  "Give me a strategic breakdown built around which Pokémon you'd actually bring together. Cover, in order:\n" +
  "• BEST BRING: the single strongest subset to bring, and how those specific Pokémon interact and cover for each other.\n" +
  "• POTENTIAL OPENING PLAYS: present the strongest openings as 2–3 separate labeled options. In Doubles each option " +
  "is a two-Pokémon LEAD PAIR (format \"A / B:\" then a brief 2-turn plan); in Singles each is a single lead. RANK them " +
  "using the LEAD-PAIR SUCCESS data (real win rates) where available — the most POPULAR pair is NOT always the best, so " +
  "prefer higher win rate while weighing sample size (n). You may also offer one promising option not in the data if " +
  "its synergy is clear, but say it's not data-backed. For each option, write turn 1 and turn 2 as concrete lines (with " +
  "a key if/then read) that respect POSITIONING — only the active Pokémon act, and bringing in a benched mon needs a " +
  "switch. Ground the lead choice and turn-1 clicks in each member's 'Real-game openings' data (real lead rates + " +
  "turn-1 plays), and don't mega more than one Pokémon.\n" +
  "• WIN CONDITION: the primary path to winning and what has to happen for it.\n" +
  "• THREATS: use ONLY the computed super-effective list and the empirical checks/counters — name the specific " +
  "Pokémon (and move, where given) that threatens the bring.\n" +
  "• IMPROVE: the top one or two ways to improve the team.\n" +
  "Keep it tight and actionable; never invent a type interaction not in the data.";

function CoachPanel({ report, team, currentBuilds, format, moveMap, abilityEffects, itemEffects, metaThreats, threats, empiricalMatchups, replayData, byId, spriteByKey, openChip, onToggleChip, knowledgeEmbeddings }) {
  const [password, setPassword] = useState(() => loadPassword());
  const [loginInput, setLoginInput] = useState("");
  const [loginError, setLoginError] = useState(null);

  const [aiText, setAiText] = useState("");      // auto-generated breakdown (incl. turn-by-turn plan)
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState(null);   // non-auth failures → rule-based stays

  const [chat, setChat] = useState([]);           // canned + free-form follow-ups
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const authed = !!password;

  // Meta attackers the team is weak to: aggregate each member's empirical "beaten by" list
  // into the opposing Pokémon that beat the most of the team (a concrete, named weakness the
  // bare type list can't express). Only mons that beat 2+ members count as team-level threats.
  const teamThreats = useMemo(() => {
    const agg = new Map();
    for (const m of empiricalMatchups || []) {
      for (const c of m.checkedBy || []) {
        let e = agg.get(c.key);
        if (!e) { e = { key: c.key, name: c.name, members: 0, scoreSum: 0 }; agg.set(c.key, e); }
        e.members += 1; e.scoreSum += c.score;
      }
    }
    return [...agg.values()]
      .map((e) => ({ key: e.key, name: e.name, count: e.members, avg: e.scoreSum / e.members }))
      .filter((e) => e.count >= 2)
      .sort((a, b) => b.count - a.count || b.avg - a.avg)
      .slice(0, 6);
  }, [empiricalMatchups]);

  // Signature of everything that feeds buildFacts — drives auto re-analysis.
  const sig = useMemo(() => {
    if (report.empty) return "";
    const teamSig = team.map((p) => {
      const b = currentBuilds.get(p.id) || {};
      return `${p.id}:${b.ability || ""}:${b.item || ""}:${b.nature || ""}:${(b.moves || []).join("/")}:${formatEvs(b.evs)}`;
    }).join("|");
    // Include the computed threats + matchups so analysis re-runs once that data loads.
    const threatSig = (threats || []).map((t) => `${t.id}x${t.hits.length}`).join(",");
    const checksSig = (empiricalMatchups || []).map((m) => `${m.id}:${m.checkedBy.length}:${m.counters.length}`).join(",");
    // Re-run once the knowledge embeddings finish loading (placeholder [] -> real vectors).
    const kSig = knowledgeEmbeddings?.length || 0;
    // Re-run once replay openings load (null -> data).
    const rSig = replayData ? "R" : "r";
    return `${teamSig}|${format}|${threatSig}|${checksSig}|k${kSig}|${rSig}`;
  }, [team, currentBuilds, format, report.empty, threats, empiricalMatchups, replayData, knowledgeEmbeddings]);

  const bringCount = format === "Doubles" ? 4 : 3;
  // AI analysis only makes sense once a full "bring" is selected (4 doubles / 3 singles).
  const enoughForAI = team.length >= bringCount;
  function systemPrompt(knowledgeChunks) {
    const knowledgeRule = knowledgeChunks?.length
      ? `REFERENCE — a "RELEVANT STRATEGY KNOWLEDGE" section is included below with general competitive ` +
        `concepts. Use it only as background strategy guidance; it is NOT specific to this team and must NOT ` +
        `be used to assert any type-effectiveness, matchup, or immunity fact.\n\n`
      : "";
    const positioningRule = format === "Doubles"
      ? `CRITICAL — DOUBLES POSITIONING: exactly TWO of your Pokémon are on the field at a time. Each turn, each ` +
        `of those two makes ONE choice (a move OR a switch) — so a turn is at most TWO of your actions, and ONLY ` +
        `the two currently-active Pokémon can act. A benched Pokémon cannot attack until it switches in, and ` +
        `switching it in spends that slot's action for the turn (it does not also move that turn). Your turn-by-turn ` +
        `plan MUST track which two Pokémon are active each turn and describe only those two acting — NEVER have ` +
        `three or four of your Pokémon act in the same turn. Also: a spread move that hits all adjacent Pokémon ` +
        `(per its effect text, e.g. Earthquake) ALSO damages your own ally in Doubles — account for that.\n\n`
      : `CRITICAL — SINGLES POSITIONING: exactly ONE of your Pokémon is active at a time; each turn it makes one ` +
        `choice (a move OR a switch). Only the active Pokémon can act — a benched Pokémon must switch in (spending ` +
        `the turn) before it can attack. Describe only the active Pokémon acting each turn.\n\n`;
    return (
      `You are a sharp competitive Pokémon team coach for the Pokémon Champions ${format} metagame. ` +
      `Use the data below — which includes how each ability, move, and item actually works — to reason ` +
      `about the team's game plan, synergies, win conditions, and matchups. Extrapolate from the mechanics ` +
      `(e.g. how an ability interacts with a move) rather than just restating them.\n\n` +
      `IMPORTANT — this format is bring-${bringCount}: each player brings all 6 to Team Preview but uses only ` +
      `${bringCount} per battle. Center your analysis on ${bringCount}-Pokémon subsets: identify the strongest ` +
      `${bringCount}-mon core(s), explain how those specific Pokémon interact and cover for each other, and note ` +
      `what each core struggles with.\n\n` +
      `CRITICAL — do NOT calculate type effectiveness yourself; you are unreliable at it. All super-effective ` +
      `matchups are precomputed for you under "COMPUTED SUPER-EFFECTIVE THREATS" and "EMPIRICAL MATCHUPS" ` +
      `(which Pokémon each member is beaten by / beats, from real battle logs), plus the team's own coverage. ` +
      `Treat those as the ONLY sources of truth for what threatens or is beaten by this team. When naming a ` +
      `threat or a favorable matchup, cite the specific opposing Pokémon (and move, if from the computed list) ` +
      `— never assert a super-effective, resisted, or immune interaction that is not in the provided data.\n\n` +
      `CRITICAL — MECHANICS: every move, ability, and item the team runs is listed below WITH its exact in-game ` +
      `effect. When you describe or recommend what something does, use ONLY that provided effect text — do NOT ` +
      `attribute an effect a move/ability/item does not have. Read the effect literally: "the user" means the ` +
      `user alone, not its ally. A move only redirects, protects an ally, boosts/lowers a stat, sets weather/terrain, ` +
      `changes Speed order, or gains priority if its listed effect text explicitly says so. (E.g. Protect only ` +
      `shields its own user — it does NOT redirect attacks or cover a teammate; redirection needs Follow Me or Rage ` +
      `Powder.) Each member also lists curated "Mechanic roles" tags (e.g. [redirection], [speed-control], ` +
      `[priority], [defensive]) — trust those labels for what a Pokémon can actually do; if a role you want ` +
      `(e.g. redirection) appears on no member, the team does NOT have it. If a play you're considering needs a ` +
      `specific effect and no member provides it, state the team lacks it rather than inventing it. A misstated ` +
      `mechanic is a critical failure.\n\n` +
      `CRITICAL — ONE MEGA PER BATTLE: at most ONE of your Pokémon may Mega Evolve in a game. If the team lists ` +
      `more than one Mega forme, the plan must pick exactly ONE to Mega Evolve; the others play as their base ` +
      `forme and are NOT Mega that game. Never describe two of your Pokémon as Mega-Evolved at the same time.\n\n` +
      `CRITICAL — MATCHUP ATTRIBUTION: each Pokémon's "is beaten by" list belongs to THAT Pokémon only — never ` +
      `transfer one member's counters onto another. When the plan reacts to an opposing Pokémon, the member that ` +
      `reacts must be the one actually threatened by it, and the reaction must actually help that member. Protect ` +
      `only saves the Pokémon that clicks it, so "answer this threat with Protect" only works when the threatened ` +
      `Pokémon protects itself — Protecting a different member does nothing for the one under threat.\n\n` +
      positioningRule +
      knowledgeRule +
      `Be concise, specific, and concrete; prefer a few bullet points. Only use the provided data.\n\n` +
      `TEAM DATA:\n` +
      buildFacts(report, team, currentBuilds, format, moveMap, abilityEffects, itemEffects, metaThreats, threats, empiricalMatchups, replayData, byId, knowledgeChunks)
    );
  }

  // Best-effort semantic retrieval: embed the query via the proxy, rank the corpus,
  // return top chunks. Any failure (incl. embeddings not yet generated) → [] so the
  // coach runs on its structured facts alone. Skips the network call entirely until
  // real embeddings exist (the shipped placeholder is []).
  async function retrieveKnowledge(queryText) {
    if (!queryText || !Array.isArray(knowledgeEmbeddings) || knowledgeEmbeddings.length === 0) return [];
    try {
      const vec = await embedQuery({ input: queryText, password });
      const hits = retrieve(vec, knowledgeEmbeddings, 3);
      logger.info("Retrieved knowledge:", hits.map((h) => `${h.title} (${h.score.toFixed(2)})`).join(" | ") || "(none)");
      return hits;
    } catch {
      return []; // embedQuery already logged the error; fall back to structured facts
    }
  }

  // A 401 anywhere means the stored password is wrong/stale — bounce to login.
  function handleAuthFailure(msg) {
    clearPassword();
    setPassword("");
    setLoginError(msg);
  }

  // Auto-analyze: whenever the team/build/format changes (and we're authed),
  // regenerate the breakdown. Debounced so build edits don't spam the proxy.
  useEffect(() => {
    if (!password || !sig || !enoughForAI) { setAiText(""); return; }
    let cancelled = false;
    setAiBusy(true);
    setAiError(null);
    const t = setTimeout(async () => {
      try {
        const chunks = await retrieveKnowledge(synthesizeTeamQuery(team, currentBuilds, report));
        if (cancelled) return;
        const reply = await callCoach({
          system: systemPrompt(chunks),
          messages: [{ role: "user", content: BREAKDOWN_PROMPT }],
          password,
        });
        if (!cancelled) setAiText(reply);
      } catch (e) {
        if (cancelled) return;
        if (e.status === 401) handleAuthFailure("That password didn't work. Try again.");
        else setAiError(e.message); // rule-based report below still shows
      } finally {
        if (!cancelled) setAiBusy(false);
      }
    }, ANALYSIS_DEBOUNCE_MS);
    return () => { cancelled = true; clearTimeout(t); };
    // sig is a string of every input to systemPrompt/buildFacts, so we key the effect
    // on it rather than the function identity — more stable, fewer redundant proxy calls.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig, password]);

  function submitLogin() {
    const pw = loginInput.trim();
    if (!pw) return;
    setLoginError(null);
    setLoginInput("");
    savePassword(pw);
    setPassword(pw); // triggers the auto-analyze effect, which validates the password
  }

  function signOut() {
    clearPassword();
    setPassword("");
    setAiText("");
    setChat([]);
  }

  function ask(key) {
    const q = COACH_QUESTIONS.find((c) => c.key === key);
    const a = answerQuestion(key, report);
    setChat((c) => [...c, { role: "user", content: q.label }, { role: "assistant", content: a }]);
  }

  async function runChat(userText) {
    if (busy) return;
    setError(null);
    const history = [...chat, { role: "user", content: userText }];
    setChat(history);
    setBusy(true);
    try {
      const chunks = await retrieveKnowledge(userText);
      const reply = await callCoach({
        system: systemPrompt(chunks),
        messages: history.map((m) => ({ role: m.role, content: m.content })),
        password,
      });
      setChat((c) => [...c, { role: "assistant", content: reply }]);
    } catch (e) {
      if (e.status === 401) handleAuthFailure("Session expired — re-enter the password.");
      else setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  function sendChat() {
    const text = input.trim();
    if (!text) return;
    setInput("");
    runChat(text);
  }

  return (
    <div className="ctb-panel ctb-coach">
      {/* Rule-based report (always — grounding + fallback) */}
      {report.empty ? (
        <p className="ctb-muted">{report.summary}</p>
      ) : (
        <div className="ctb-report">
          <p className="ctb-report__summary">{report.summary}</p>
          <div className="ctb-report__cols">
            <div>
              <div className="ctb-report__h ctb-report__h--good">Strengths</div>
              <ul>{report.strengths.map((s, i) => <li key={i}>{s}</li>)}</ul>
            </div>
            <div>
              <div className="ctb-report__h ctb-report__h--bad">Weaknesses</div>
              <ul>{report.weaknesses.length ? report.weaknesses.map((s, i) => <li key={i}>{s}</li>) : <li>None notable.</li>}</ul>
            </div>
          </div>
          <div className="ctb-matchups">
            <div>
              <span className="ctb-matchups__label">Strong into:</span>
              {report.goodAgainst.length ? report.goodAgainst.map((t) => <TypeBadge key={t} type={t} small />) : <span className="ctb-muted"> —</span>}
            </div>
            <div>
              <span className="ctb-matchups__label">Vulnerable to:</span>
              {report.poorAgainst.length ? report.poorAgainst.map((t) => <TypeBadge key={t} type={t} small />) : <span className="ctb-muted"> nothing shared</span>}
            </div>
          </div>
          {teamThreats.length > 0 && (
            <div className="ctb-threats">
              <div className="ctb-threats__label">Weak to meta attackers <span className="ctb-muted">(number = how many of your team it beats)</span></div>
              <div className="ctb-threats__chips">
                {teamThreats.map((t) => (
                  <MatchupChip
                    key={t.key}
                    id={`th-${t.key}`}
                    openId={openChip}
                    onToggle={onToggleChip}
                    entry={{ key: t.key, name: t.name, score: t.avg }}
                    spriteByKey={spriteByKey}
                    variant="bad"
                    value={String(t.count)}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Team Coach header — now titles the AI/chat section */}
      {!report.empty && (
        <div className="ctb-panel__head ctb-coach__head">
          <h2 className="ctb-panel__title">Team Coach</h2>
          {authed && (
            <div className="ctb-coach__status">
              <span className="ctb-good">● AI connected</span>
              <button className="ctb-linkbtn" onClick={signOut}>Sign out</button>
            </div>
          )}
        </div>
      )}

      {/* Login (one-time password) */}
      {!authed && !report.empty && (
        <div className="ctb-llm">
          <p className="ctb-llm__note">
            Enter the access password to turn on AI analysis. It's stored only in this browser
            and sent to the shared coach service. Without it, the coach stays fully rule-based.
          </p>
          <div className="ctb-ask">
            <input
              className="ctb-ask__input"
              type="password"
              value={loginInput}
              onChange={(e) => setLoginInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") submitLogin(); }}
              placeholder="Access password (ask the owner)"
            />
            <button className="ctb-btn" onClick={submitLogin} disabled={!loginInput.trim()}>Unlock</button>
          </div>
          {loginError && <div className="ctb-err">{loginError}</div>}
        </div>
      )}

      {/* AI analysis (auto) — between the rule-based matchups and the chat */}
      {authed && !report.empty && (
        <div className="ctb-ai">
          <div className="ctb-report__h ctb-report__h--syn">✨ AI Analysis</div>
          {!enoughForAI ? (
            <p className="ctb-muted">
              Select {bringCount} Pokémon to generate AI analysis — {format} brings {bringCount} per battle
              ({bringCount - team.length} more to go).
            </p>
          ) : (
            <>
              {aiBusy && !aiText && <p className="ctb-muted">Analyzing your team…</p>}
              {aiText && <TypedMarkdown className="ctb-ai__body" text={aiText} />}
              {aiBusy && aiText && <p className="ctb-muted">Updating…</p>}
              {aiError && <div className="ctb-err">AI unavailable ({aiError}). Showing the rule-based analysis above.</div>}
            </>
          )}
        </div>
      )}

      {/* Chat transcript */}
      {chat.length > 0 && (
        <div className="ctb-chat">
          {chat.map((m, i) => (
            m.role === "assistant"
              ? <TypedMarkdown key={i} className={`ctb-msg ctb-msg--${m.role}`} text={m.content} animate={i === chat.length - 1} />
              : <div key={i} className={`ctb-msg ctb-msg--${m.role}`}>{m.content}</div>
          ))}
          {busy && <div className="ctb-msg ctb-msg--assistant ctb-muted">…thinking</div>}
        </div>
      )}
      {error && <div className="ctb-err">{error}</div>}

      {/* Canned questions (rule-based) — only when AI isn't connected */}
      {!authed && !report.empty && (
        <div className="ctb-qbtns">
          {COACH_QUESTIONS.map((q) => (
            <button key={q.key} className="ctb-qbtn" onClick={() => ask(q.key)}>{q.label}</button>
          ))}
        </div>
      )}

      {/* Free-form chat (needs login + a full bring) */}
      {authed && enoughForAI && !report.empty && (
        <div className="ctb-ask">
          <input
            className="ctb-ask__input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") sendChat(); }}
            placeholder="Ask the coach anything…"
            disabled={busy}
          />
          <button className="ctb-btn" onClick={sendChat} disabled={busy || !input.trim()}>Send</button>
        </div>
      )}
    </div>
  );
}
