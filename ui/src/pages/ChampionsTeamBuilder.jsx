import { useState, useEffect, useMemo } from "react";
import { useData } from "../hooks/useData";
import { useUsageFiles } from "../hooks/useUsageFiles";
import { buildChart } from "../utils/typeChart";
import { analyzeTeam } from "../utils/teamSuggest";
import {
  defaultBuild,
  getBuild,
  classifyRole,
  scoreTeammate,
  idToNameMap,
  formatEvs,
  movesByName,
} from "../utils/championsStrategy";
import { memberTechNotes } from "../utils/mechanicsAnnotations";
import { coachReport, answerQuestion, COACH_QUESTIONS } from "../utils/teamCoach";
import { loadLlmSettings, saveLlmSettings, callLLM, LLM_DEFAULTS } from "../utils/llmClient";
import TypeBadge from "../components/TypeBadge";
import { assetUrl } from "../utils/assetUrl";
import "./ChampionsTeamBuilder.css";

const MAX_TEAM = 6;
const FORMATS = ["Doubles", "Singles"];
const remoteSprite = (id) =>
  `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${id}.png`;
const cap = (t) => t.charAt(0).toUpperCase() + t.slice(1);

function loadJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

export default function ChampionsTeamBuilder() {
  const { data: usageIndex } = useData("/data/usage/_index.json");
  const { data: allPokemon, loading: indexLoading } = useData("/data/pokemon-index.json");
  const { data: movesIndex } = useData("/data/moves-index.json");
  const { data: itemsIndex } = useData("/data/items-index.json");
  const { data: abilitiesIndex } = useData("/data/abilities-index.json");
  const { data: typesData } = useData("/data/types.json");

  const [format, setFormat] = useState("Doubles");
  const [teamIds, setTeamIds] = useState(() => loadJson("champions-team", []).slice(0, MAX_TEAM));
  const [buildsStore, setBuildsStore] = useState(() => loadJson("champions-builds", {}));
  const [expandedId, setExpandedId] = useState(null);
  const [search, setSearch] = useState("");

  useEffect(() => { localStorage.setItem("champions-team", JSON.stringify(teamIds)); }, [teamIds]);
  useEffect(() => { localStorage.setItem("champions-builds", JSON.stringify(buildsStore)); }, [buildsStore]);

  const { byId: memberUsage } = useUsageFiles(teamIds);

  const byId = useMemo(() => {
    const m = new Map();
    for (const p of allPokemon || []) m.set(p.id, p);
    return m;
  }, [allPokemon]);

  const rankKey = format === "Doubles" ? "doubles_rank" : "singles_rank";
  const rankById = useMemo(() => {
    const m = new Map();
    for (const e of usageIndex || []) m.set(e.id, e);
    return m;
  }, [usageIndex]);

  const championsPokemon = useMemo(() => {
    if (!allPokemon || !usageIndex) return [];
    return usageIndex
      .map((e) => byId.get(e.id))
      .filter(Boolean)
      .sort((a, b) => (rankById.get(a.id)?.[rankKey] ?? 1e9) - (rankById.get(b.id)?.[rankKey] ?? 1e9));
  }, [allPokemon, usageIndex, byId, rankById, rankKey]);

  const idToName = useMemo(() => idToNameMap(usageIndex), [usageIndex]);
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
  const team = useMemo(() => teamIds.map((id) => byId.get(id)).filter(Boolean), [teamIds, byId]);
  const analysis = useMemo(() => analyzeTeam(team, chart), [team, chart]);

  const teamUsage = useMemo(
    () => team.map((p) => ({ pokemon: p, usage: memberUsage.get(p.id) })).filter((m) => m.usage),
    [team, memberUsage]
  );

  // Resolved build for each member: stored override, else rank-1 default.
  const currentBuilds = useMemo(() => {
    const m = new Map();
    for (const p of team) {
      const stored = buildsStore[p.id]?.[format];
      if (stored) m.set(p.id, stored);
      else {
        const usage = memberUsage.get(p.id);
        if (usage) m.set(p.id, defaultBuild(usage, format));
      }
    }
    return m;
  }, [team, buildsStore, format, memberUsage]);

  function addToTeam(p) {
    setTeamIds((ids) => (ids.length >= MAX_TEAM || ids.includes(p.id) ? ids : [...ids, p.id]));
  }
  function removeFromTeam(id) {
    setTeamIds((ids) => ids.filter((x) => x !== id));
    if (expandedId === id) setExpandedId(null);
  }
  function clearTeam() {
    setTeamIds([]);
    setExpandedId(null);
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
      return pool.slice(0, 12).map((p) => ({
        pokemon: p,
        reason: `#${rankById.get(p.id)?.[rankKey] ?? "?"} most-used`,
      }));
    }
    const scored = pool.map((p) => {
      const r = scoreTeammate(p, idToName.get(p.id), teamUsage, format, chart, analysis);
      return { pokemon: p, score: r.score, reason: r.reason };
    });
    scored.sort((a, b) => b.score - a.score || b.pokemon.bst - a.pokemon.bst);
    return scored.slice(0, 12);
  }, [chart, team, teamIds, championsPokemon, teamUsage, format, analysis, idToName, rankById, rankKey]);

  const filteredRecs = useMemo(() => {
    if (!search.trim()) return recommendations;
    const q = search.trim().toLowerCase();
    return recommendations.filter((r) => r.pokemon.name.replace(/-/g, " ").includes(q));
  }, [recommendations, search]);

  const report = useMemo(
    () => coachReport(team, currentBuilds, analysis, teamUsage, movesIndex, format, chart),
    [team, currentBuilds, analysis, teamUsage, movesIndex, format, chart]
  );

  if (indexLoading) return <div className="ctb-loading">Loading Champions data…</div>;

  return (
    <div className="ctb-page">
      <div className="ctb-head">
        <h1 className="ctb-h1">Champions Team Builder</h1>
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
            const usage = memberUsage.get(p.id);
            const natures = usage ? getBuild(usage, format).natures : [];
            const role = build ? classifyRole(build, natures, p.stats) : "…";
            return (
              <div
                key={p.id}
                className={`ctb-slot ctb-slot--filled${expandedId === p.id ? " ctb-slot--active" : ""}`}
                onClick={() => setExpandedId((id) => (id === p.id ? null : p.id))}
              >
                <button
                  className="ctb-slot__remove"
                  onClick={(e) => { e.stopPropagation(); removeFromTeam(p.id); }}
                  aria-label="Remove"
                >✕</button>
                <img
                  className="ctb-slot__sprite"
                  src={assetUrl(`/sprites/pokemon/${p.id}.png`)}
                  onError={(e) => { if (!e.target.src.startsWith("http")) e.target.src = remoteSprite(p.id); }}
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
            pokemon={byId.get(expandedId)}
            usage={memberUsage.get(expandedId)}
            format={format}
            build={currentBuilds.get(expandedId)}
            moveMap={moveMap}
            onChange={(patch) => updateBuild(expandedId, patch)}
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
            <div className="ctb-search">
              <input
                className="ctb-search__input"
                placeholder="Search…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              {search && <button className="ctb-search__clear" onClick={() => setSearch("")} aria-label="Clear">✕</button>}
            </div>
          </div>
          <div className="ctb-recs">
            {filteredRecs.map(({ pokemon, reason }) => (
              <button key={pokemon.id} className="ctb-rec" onClick={() => addToTeam(pokemon)}>
                <img
                  className="ctb-rec__sprite"
                  src={assetUrl(`/sprites/pokemon/${pokemon.id}.png`)}
                  onError={(e) => { if (!e.target.src.startsWith("http")) e.target.src = remoteSprite(pokemon.id); }}
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
      />
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

function MemberEditor({ pokemon, usage, format, build, moveMap, onChange }) {
  if (!usage || !build) return <div className="ctb-editor ctb-editor--loading">Loading build…</div>;
  const b = getBuild(usage, format);
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
      </div>
      <div className="ctb-editor__grid">
        <Field label="Ability">
          <select value={build.ability || ""} onChange={(e) => onChange({ ability: e.target.value })}>
            {b.abilities.map((a) => (
              <option key={a.name} value={a.name}>{a.name} ({a.percentage}%)</option>
            ))}
          </select>
        </Field>

        <Field label="Item">
          <select value={build.item || ""} onChange={(e) => onChange({ item: e.target.value })}>
            {b.items.map((it) => (
              <option key={it.name} value={it.name}>{it.name} ({it.percentage}%)</option>
            ))}
          </select>
        </Field>

        <Field label="Nature">
          <select value={build.nature || ""} onChange={(e) => onChange({ nature: e.target.value })}>
            {b.natures.map((n) => (
              <option key={n.name} value={n.name}>
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
                {b.moves.map((mv) => (
                  <option key={mv.name} value={mv.name}>
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
    </div>
  );
}

// --- Coach panel -----------------------------------------------------------

// Assemble the grounding for the LLM. Crucially this includes the *effect text*
// of each ability / move / item straight from the data indexes, so the model can
// reason about how the mechanics work and how they interact — and so a future
// season's new mechanics are covered automatically (no hardcoding).
function buildFacts(report, team, currentBuilds, format, moveMap, abilityEffects, itemEffects) {
  if (report.empty) return "The team is empty.";
  const roleById = new Map(report.roles.map((r) => [r.id, r.role]));
  const lines = [];
  lines.push(`Format: ${format} (Pokémon Champions metagame).`);
  lines.push(`Team offensive coverage: ${report.coveredCount}/18 types. Gaps (not hit super-effectively): ${report.gaps.map(cap).join(", ") || "none"}.`);
  lines.push(`Shared weaknesses (2+ members weak): ${report.poorAgainst.map(cap).join(", ") || "none"}.`);
  lines.push(`Solidly resisted: ${report.resisted.map(cap).join(", ") || "none"}.`);
  lines.push(`Total BST ${report.bstTotal}, avg ${report.bstAvg}.`);
  lines.push("");
  lines.push("MEMBERS (each mechanic's real effect is given so you can reason about interactions):");
  for (const p of team) {
    const b = currentBuilds.get(p.id);
    if (!b) continue;
    lines.push(`• ${p.name.replace(/-/g, " ")} [${p.types.join("/")}] — ${roleById.get(p.id) || "—"}`);
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
  }
  if (report.teamTech?.length) {
    lines.push("");
    lines.push("Detected synergy hints (you may expand on or go beyond these):");
    for (const t of report.teamTech) lines.push(`  - ${t}`);
  }
  return lines.join("\n");
}

function CoachPanel({ report, team, currentBuilds, format, moveMap, abilityEffects, itemEffects }) {
  const [chat, setChat] = useState([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [llm, setLlm] = useState(() => loadLlmSettings());
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  // AI is usable if a key is set (direct providers) or a proxy URL + password are set.
  const aiReady = llm.provider === "proxy" ? !!llm.proxyUrl && !!llm.password : !!llm.apiKey;

  function ask(key) {
    const q = COACH_QUESTIONS.find((c) => c.key === key);
    const a = answerQuestion(key, report);
    setChat((c) => [...c, { role: "user", content: q.label }, { role: "assistant", content: a }]);
  }

  function saveSettings(next) {
    // Any manual change takes ownership away from the .env autofill.
    const clean = { provider: next.provider, apiKey: next.apiKey, model: next.model, proxyUrl: next.proxyUrl, password: next.password, fromEnv: false };
    setLlm(clean);
    saveLlmSettings(clean);
  }

  function systemPrompt() {
    return (
      `You are a sharp competitive Pokémon team coach for the Pokémon Champions ${format} metagame. ` +
      `Use the data below — which includes how each ability, move, and item actually works — to reason ` +
      `about the team's game plan, synergies, win conditions, and matchups. Extrapolate from the mechanics ` +
      `(e.g. how an ability interacts with a move) rather than just restating them. Be concise, specific, and ` +
      `concrete; prefer a few bullet points. Only use the provided team data.\n\n` +
      `TEAM DATA:\n` +
      buildFacts(report, team, currentBuilds, format, moveMap, abilityEffects, itemEffects)
    );
  }

  async function runLlm(userText) {
    if (busy) return;
    setError(null);
    const history = [...chat, { role: "user", content: userText }];
    setChat(history);
    setBusy(true);
    try {
      const reply = await callLLM({
        provider: llm.provider,
        apiKey: llm.apiKey,
        model: llm.model,
        proxyUrl: llm.proxyUrl,
        password: llm.password,
        system: systemPrompt(),
        messages: history.map((m) => ({ role: m.role, content: m.content })),
      });
      setChat((c) => [...c, { role: "assistant", content: reply }]);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  function sendLlm() {
    const text = input.trim();
    if (!text) return;
    setInput("");
    runLlm(text);
  }

  return (
    <div className="ctb-panel ctb-coach">
      <div className="ctb-panel__head">
        <h2 className="ctb-panel__title">Team Coach</h2>
        <div className="ctb-coach__actions">
          {aiReady && !report.empty && (
            <button className="ctb-btn" onClick={() => runLlm("Give me a full strategic breakdown of this team: its game plan and win condition, the key synergies, the biggest weaknesses, and the top one or two ways to improve it.")} disabled={busy}>
              ✨ Analyze with AI
            </button>
          )}
          <button className="ctb-btn ctb-btn--ghost" onClick={() => setSettingsOpen((o) => !o)}>
            {aiReady ? `⚙ ${LLM_DEFAULTS[llm.provider]?.label || "AI"}` : "Connect AI (free)"}
          </button>
        </div>
      </div>

      {settingsOpen && (
        <div className="ctb-llm">
          <p className="ctb-llm__note">
            {llm.fromEnv ? (
              <><strong>✓ Key autofilled from ui/.env</strong> ({LLM_DEFAULTS[llm.provider]?.label}). Override it below if you like. </>
            ) : (
              <>Optional AI analysis. Your key is stored only in this browser and calls the provider
              directly — without one, the coach stays fully offline and rule-based. </>
            )}
            {llm.provider === "groq" && !llm.fromEnv && (
              <>Groq is free: grab a key at <strong>console.groq.com/keys</strong> (no credit card).</>
            )}
          </p>
          <div className="ctb-llm__row">
            <select value={llm.provider} onChange={(e) => saveSettings({ ...llm, provider: e.target.value, model: LLM_DEFAULTS[e.target.value].model })}>
              {Object.entries(LLM_DEFAULTS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
            <input
              className="ctb-llm__model"
              value={llm.model}
              onChange={(e) => saveSettings({ ...llm, model: e.target.value })}
              placeholder="model"
            />
          </div>
          {llm.provider === "proxy" ? (
            <input
              className="ctb-llm__key"
              type="password"
              value={llm.password}
              onChange={(e) => saveSettings({ ...llm, password: e.target.value })}
              placeholder="Shared password (ask the owner)"
            />
          ) : (
            <input
              className="ctb-llm__key"
              type="password"
              value={llm.apiKey}
              onChange={(e) => saveSettings({ ...llm, apiKey: e.target.value })}
              placeholder={llm.provider === "groq" ? "Groq API key (gsk_…)" : "API key"}
            />
          )}
        </div>
      )}

      {/* Rule-based report */}
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

          {report.teamTech?.length > 0 && (
            <div className="ctb-tech">
              <div className="ctb-report__h ctb-report__h--syn">Synergy &amp; Game Plan</div>
              <ul>{report.teamTech.map((t, i) => <li key={i}>{t}</li>)}</ul>
            </div>
          )}
        </div>
      )}

      {/* Chat transcript */}
      {chat.length > 0 && (
        <div className="ctb-chat">
          {chat.map((m, i) => (
            <div key={i} className={`ctb-msg ctb-msg--${m.role}`}>{m.content}</div>
          ))}
          {busy && <div className="ctb-msg ctb-msg--assistant ctb-muted">…thinking</div>}
        </div>
      )}
      {error && <div className="ctb-err">{error}</div>}

      {/* Canned questions */}
      {!report.empty && (
        <div className="ctb-qbtns">
          {COACH_QUESTIONS.map((q) => (
            <button key={q.key} className="ctb-qbtn" onClick={() => ask(q.key)}>{q.label}</button>
          ))}
        </div>
      )}

      {/* Free-form LLM input */}
      {aiReady && !report.empty && (
        <div className="ctb-ask">
          <input
            className="ctb-ask__input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") sendLlm(); }}
            placeholder="Ask the coach anything…"
            disabled={busy}
          />
          <button className="ctb-btn" onClick={sendLlm} disabled={busy || !input.trim()}>Send</button>
        </div>
      )}
    </div>
  );
}
