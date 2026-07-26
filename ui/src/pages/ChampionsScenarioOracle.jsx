import { useState, useEffect, useMemo } from "react";
import { useChampionsRoster } from "../hooks/useChampionsRoster";
import { useSmogonFiles } from "../hooks/useSmogonFiles";
import { getBuild, defaultBuild, formatEvs } from "../utils/championsStrategy";
import { computeMatchup } from "../utils/damageCalc";
import { loadSavedTeamIds } from "../utils/championsTeamStore";
import TypeBadge from "../components/TypeBadge";
import { assetUrl } from "../utils/assetUrl";
import { remoteSprite, onSpriteError } from "../utils/sprite";
import "./ChampionsScenarioOracle.css";

const FORMATS = ["Doubles", "Singles"];
const ROSTER_PAGE_SIZE = 24;

function Field({ label, children }) {
  return (
    <label className="cso-field">
      <span className="cso-field__label">{label}</span>
      {children}
    </label>
  );
}

// Search + tile grid for picking a Pokémon for one side. Shown until a mon is picked.
function MonPicker({ roster, onPick }) {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? roster.filter((p) => p.name.replace(/-/g, " ").toLowerCase().includes(q)) : roster;
  }, [roster, search]);
  const shown = filtered.slice(0, page * ROSTER_PAGE_SIZE);

  return (
    <div className="cso-picker">
      <div className="cso-search">
        <input
          className="cso-search__input"
          placeholder="Search Pokémon…"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
        />
        {search && <button className="cso-search__clear" onClick={() => setSearch("")}>✕</button>}
      </div>
      <div className="cso-picker__grid">
        {shown.map((p) => (
          <button key={p.id} className="cso-tile" onClick={() => onPick(p.id)}>
            <img
              className="cso-tile__sprite"
              src={assetUrl(`/sprites/pokemon/${p.spriteId}.png`)}
              onError={(e) => onSpriteError(e, remoteSprite(p.spriteId))}
              alt=""
            />
            <div className="cso-tile__name">{p.name.replace(/-/g, " ")}</div>
            <div className="cso-tile__types">
              {p.types.map((t) => <TypeBadge key={t} type={t} small />)}
            </div>
          </button>
        ))}
      </div>
      {shown.length < filtered.length && (
        <button className="cso-btn cso-btn--ghost" onClick={() => setPage((p) => p + 1)}>
          Show more ({filtered.length - shown.length} left)
        </button>
      )}
    </div>
  );
}

// The compact build editor for one side: ability/item/nature/EV-spread + 4 moves, seeded from
// the canonical (rank-1) build and editable. Lighter than the Team Builder's MemberEditor — no
// checks/counters chips or stat bars, since the Oracle only needs a build to feed the calculator.
function BuildEditor({ record, format, build, onChange }) {
  const b = useMemo(() => getBuild(record, format), [record, format]);
  const setMove = (i, value) => {
    const moves = [...(build.moves || [])];
    moves[i] = value;
    onChange({ moves });
  };
  return (
    <div className="cso-editor">
      <Field label="Ability">
        <select value={build.ability || ""} onChange={(e) => onChange({ ability: e.target.value })}>
          {b.abilities.map((a, i) => <option key={i} value={a.name}>{a.name} ({a.percentage}%)</option>)}
        </select>
      </Field>
      <Field label="Item">
        <select value={build.item || ""} onChange={(e) => onChange({ item: e.target.value })}>
          {b.items.map((it, i) => <option key={i} value={it.name}>{it.name} ({it.percentage}%)</option>)}
        </select>
      </Field>
      <Field label="Nature">
        <select value={build.nature || ""} onChange={(e) => onChange({ nature: e.target.value })}>
          {b.natures.map((n, i) => (
            <option key={i} value={n.name}>{n.name}{n.stat_up ? ` (+${n.stat_up}/-${n.stat_down})` : ""}</option>
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
          {b.spreads.map((s, i) => <option key={i} value={formatEvs(s.evs)}>{formatEvs(s.evs)} ({s.percentage}%)</option>)}
        </select>
      </Field>
      <div className="cso-editor__moves">
        <span className="cso-field__label">Moves</span>
        <div className="cso-editor__moves-grid">
          {[0, 1, 2, 3].map((i) => (
            <select key={i} value={(build.moves || [])[i] || ""} onChange={(e) => setMove(i, e.target.value)}>
              <option value="">— none —</option>
              {b.moves.map((mv, j) => <option key={j} value={mv.name}>{mv.name} ({mv.percentage}%)</option>)}
            </select>
          ))}
        </div>
      </div>
    </div>
  );
}

// One side of the matchup: picker until a mon is chosen, then its card + build editor.
function SidePanel({ label, roster, pokemon, record, format, build, onPick, onChange, onClear }) {
  return (
    <div className="cso-panel">
      <div className="cso-panel__head">
        <h2 className="cso-panel__title">{label}</h2>
        {pokemon && <button className="cso-btn cso-btn--ghost" onClick={onClear}>Change</button>}
      </div>
      {!pokemon ? (
        <MonPicker roster={roster} onPick={onPick} />
      ) : (
        <>
          <div className="cso-picked">
            <img
              className="cso-picked__sprite"
              src={assetUrl(`/sprites/pokemon/${pokemon.spriteId}.png`)}
              onError={(e) => onSpriteError(e, remoteSprite(pokemon.spriteId))}
              alt=""
            />
            <div className="cso-picked__info">
              <div className="cso-picked__name">
                {pokemon.name.replace(/-/g, " ")}
                {pokemon.isMega && <span className="cso-picked__mega">MEGA</span>}
              </div>
              <div className="cso-picked__types">
                {pokemon.types.map((t) => <TypeBadge key={t} type={t} small />)}
              </div>
            </div>
          </div>
          {build && <BuildEditor record={record} format={format} build={build} onChange={onChange} />}
        </>
      )}
    </div>
  );
}

function MoveRow({ move, isBest }) {
  return (
    <div className={`cso-move${isBest ? " cso-move--best" : ""}`}>
      <span className="cso-move__name">{move.name}</span>
      <span className="cso-move__result">{move.result ? move.result.str : "no effect"}</span>
    </div>
  );
}

const WINNER_CLASS = { a: "cso-verdict--win", b: "cso-verdict--lose", even: "cso-verdict--even", unclear: "cso-verdict--even" };

export default function ChampionsScenarioOracle() {
  const [format, setFormat] = useState("Doubles");
  const { roster, byId, loading } = useChampionsRoster(format);

  const [aId, setAId] = useState(null);
  const [bId, setBId] = useState(null);
  const [aOverride, setAOverride] = useState(null);
  const [bOverride, setBOverride] = useState(null);

  // Default "Yours" to the first mon of your saved Team Builder team (if any), and "Opponent"
  // to a different roster mon — a sensible starting matchup rather than an empty prompt. Runs
  // once at cold start (guarded on BOTH ids still being null): computing them together in one
  // effect avoids a race where a separate "seed B" effect would read A's pre-update value.
  // Depend on roster.length (a primitive), NOT the roster/byId objects themselves: while
  // useSmogonIndex's data is still loading it falls back to a brand-new `[]` on every render,
  // so those object references churn every render and would otherwise re-fire this effect in
  // an unbounded loop (React's "Maximum update depth exceeded") during that loading window.
  useEffect(() => {
    if (aId || bId || !roster.length) return;
    const saved = loadSavedTeamIds();
    const firstOwned = saved.find((id) => byId.has(id));
    const initialA = firstOwned || roster[0]?.id || null;
    setAId(initialA);
    setBId(roster.find((p) => p.id !== initialA)?.id || null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roster.length, aId, bId]);

  const { byKey: smogonById } = useSmogonFiles([aId, bId].filter(Boolean));
  const aPokemon = aId ? byId.get(aId) : null;
  const bPokemon = bId ? byId.get(bId) : null;
  const aRecord = aId ? smogonById.get(aId) : null;
  const bRecord = bId ? smogonById.get(bId) : null;

  const aCanonical = useMemo(() => (aPokemon ? defaultBuild(aRecord, format) : null), [aPokemon, aRecord, format]);
  const bCanonical = useMemo(() => (bPokemon ? defaultBuild(bRecord, format) : null), [bPokemon, bRecord, format]);
  // Reset manual edits whenever the picked mon or format changes, so the editor re-seeds canonical.
  useEffect(() => { setAOverride(null); }, [aId, format]);
  useEffect(() => { setBOverride(null); }, [bId, format]);
  const aBuild = aOverride || aCanonical;
  const bBuild = bOverride || bCanonical;

  const [matchup, setMatchup] = useState(null);
  const [computing, setComputing] = useState(false);
  useEffect(() => {
    if (!aPokemon || !bPokemon || !aBuild || !bBuild) { setMatchup(null); return; }
    let cancelled = false;
    setComputing(true);
    computeMatchup({ a: { entry: aPokemon, build: aBuild }, b: { entry: bPokemon, build: bBuild }, format })
      .then((r) => { if (!cancelled) setMatchup(r); })
      .catch(() => { if (!cancelled) setMatchup(null); })
      .finally(() => { if (!cancelled) setComputing(false); });
    return () => { cancelled = true; };
  }, [aPokemon, bPokemon, aBuild, bBuild, format]);

  if (loading) return <div className="cso-loading">Loading Champions data…</div>;

  return (
    <div className="cso-page">
      <div className="cso-head">
        <h1 className="cso-h1">Matchup</h1>
        <div className="cso-fmt">
          {FORMATS.map((f) => (
            <button key={f} className={`cso-fmt__btn${format === f ? " active" : ""}`} onClick={() => setFormat(f)}>
              {f}
            </button>
          ))}
        </div>
      </div>
      <p className="cso-intro">
        Pick one of your Pokémon and an opponent to see real damage both directions, Speed, best
        move, and who wins the exchange — computed from the same damage calculator that grounds
        the Team Coach.
      </p>

      <div className="cso-sides">
        <SidePanel
          label="Yours" roster={roster} pokemon={aPokemon} record={aRecord} format={format}
          build={aBuild} onPick={setAId} onChange={(patch) => setAOverride({ ...aBuild, ...patch })}
          onClear={() => setAId(null)}
        />
        <div className="cso-vs">VS</div>
        <SidePanel
          label="Opponent" roster={roster} pokemon={bPokemon} record={bRecord} format={format}
          build={bBuild} onPick={setBId} onChange={(patch) => setBOverride({ ...bBuild, ...patch })}
          onClear={() => setBId(null)}
        />
      </div>

      {aPokemon && bPokemon && (
        <div className="cso-panel cso-results">
          <h2 className="cso-panel__title">Result</h2>
          {computing && <div className="cso-computing">Computing…</div>}
          {matchup && (
            <>
              <div className="cso-speed">
                <span className={matchup.speed.faster === "a" ? "cso-speed__winner" : ""}>
                  {aPokemon.name.replace(/-/g, " ")} {matchup.speed.aSpe}
                </span>
                <span className="cso-speed__vs">vs</span>
                <span className={matchup.speed.faster === "b" ? "cso-speed__winner" : ""}>
                  {matchup.speed.bSpe} {bPokemon.name.replace(/-/g, " ")}
                </span>
                {matchup.speed.note && <span className="cso-speed__note">{matchup.speed.note}</span>}
              </div>

              <div className="cso-moves-cols">
                <div className="cso-moves-col">
                  <div className="cso-moves-col__label">{aPokemon.name.replace(/-/g, " ")}'s moves</div>
                  {matchup.a.moves.map((m) => <MoveRow key={m.name} move={m} isBest={matchup.a.best?.name === m.name} />)}
                </div>
                <div className="cso-moves-col">
                  <div className="cso-moves-col__label">{bPokemon.name.replace(/-/g, " ")}'s moves</div>
                  {matchup.b.moves.map((m) => <MoveRow key={m.name} move={m} isBest={matchup.b.best?.name === m.name} />)}
                </div>
              </div>

              <div className={`cso-verdict ${WINNER_CLASS[matchup.verdict.winner] || ""}`}>
                {matchup.verdict.text}
              </div>

              <div className="cso-caveats">
                Assumes both Pokémon stay in and repeatedly use their single best damaging move —
                ignores switching, status, recoil, stat changes, protect, and multi-turn effects.
                Builds are canonical (or your edits above); Speed includes Choice Scarf but not
                Tailwind or manual stat boosts.
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
