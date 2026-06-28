import { useState } from "react";
import { useData } from "../hooks/useData";
import { TYPE_COLORS } from "../utils/typeColors";
import "./TypeChart.css";

const MULTIPLIERS = { double_damage: 2, half_damage: 0.5, no_damage: 0 };

function buildMatrix(types) {
  const names = types.map((t) => t.name);
  // matrix[attacker][defender] = multiplier
  const matrix = {};
  for (const t of types) {
    matrix[t.name] = {};
    for (const def of names) matrix[t.name][def] = 1;

    for (const d of t.damage_relations.double_damage_to || [])
      matrix[t.name][d.name] = 2;
    for (const d of t.damage_relations.half_damage_to || [])
      matrix[t.name][d.name] = 0.5;
    for (const d of t.damage_relations.no_damage_to || [])
      matrix[t.name][d.name] = 0;
  }
  return { matrix, names };
}

function cellLabel(val) {
  if (val === 2) return "2×";
  if (val === 0.5) return "½";
  if (val === 0) return "0";
  return "";
}

function cellClass(val) {
  if (val === 2) return "tc-cell tc-cell--2x";
  if (val === 0.5) return "tc-cell tc-cell--half";
  if (val === 0) return "tc-cell tc-cell--0";
  return "tc-cell tc-cell--1x";
}

export default function TypeChart() {
  const { data: types, loading } = useData("/data/types.json");
  const [mode, setMode] = useState("attack"); // attack | defense
  const [focus, setFocus] = useState(null);

  if (loading) return <div className="tc-loading">Loading type data...</div>;
  if (!types) return null;

  const { matrix, names } = buildMatrix(types);

  // Defense: rows = defending types, cols = attacking types
  // Attack:  rows = attacking types, cols = defending types (what you hit)

  function getVal(row, col) {
    return mode === "attack" ? matrix[row]?.[col] ?? 1 : matrix[col]?.[row] ?? 1;
  }

  const rowLabel = mode === "attack" ? "Attacking type" : "Defending type";
  const colLabel = mode === "attack" ? "vs. defender" : "vs. attacker";

  return (
    <div className="type-chart">
      <div className="tc-controls">
        <button
          className={`tc-mode-btn${mode === "attack" ? " active" : ""}`}
          onClick={() => setMode("attack")}
        >
          Offense
        </button>
        <button
          className={`tc-mode-btn${mode === "defense" ? " active" : ""}`}
          onClick={() => setMode("defense")}
        >
          Defense
        </button>
        <span className="tc-hint">
          {mode === "attack"
            ? "Row = attacker type · Column = defender type"
            : "Row = defender type · Column = attacker type"}
        </span>
      </div>

      {focus && (
        <div className="tc-focus-panel">
          <TypeHeader type={focus} />
          <div className="tc-focus-body">
            {mode === "attack" ? (
              <>
                <TypeGroup label="2× damage to" vals={names.filter((n) => matrix[focus]?.[n] === 2)} />
                <TypeGroup label="½ damage to" vals={names.filter((n) => matrix[focus]?.[n] === 0.5)} />
                <TypeGroup label="0 damage to" vals={names.filter((n) => matrix[focus]?.[n] === 0)} />
              </>
            ) : (
              <>
                <TypeGroup label="2× damage from" vals={names.filter((n) => matrix[n]?.[focus] === 2)} />
                <TypeGroup label="½ damage from" vals={names.filter((n) => matrix[n]?.[focus] === 0.5)} />
                <TypeGroup label="0 damage from" vals={names.filter((n) => matrix[n]?.[focus] === 0)} />
              </>
            )}
          </div>
        </div>
      )}

      <div className="tc-scroll">
        <table className="tc-table">
          <thead>
            <tr>
              <th className="tc-corner">{rowLabel} &#8595;</th>
              {names.map((col) => (
                <th key={col} className="tc-col-head">
                  <div
                    className="tc-type-label"
                    style={{ background: TYPE_COLORS[col] }}
                    onClick={() => setFocus(focus === col ? null : col)}
                    title={col}
                  >
                    {col.slice(0, 3)}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {names.map((row) => (
              <tr key={row} className={focus === row ? "tc-row-focused" : ""}>
                <td
                  className="tc-row-head"
                  style={{ background: TYPE_COLORS[row] }}
                  onClick={() => setFocus(focus === row ? null : row)}
                >
                  {row}
                </td>
                {names.map((col) => {
                  const val = getVal(row, col);
                  return (
                    <td
                      key={col}
                      className={cellClass(val) + (focus === col ? " tc-col-focused" : "")}
                    >
                      {cellLabel(val)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function TypeHeader({ type }) {
  return (
    <span className="tc-focus-badge" style={{ background: TYPE_COLORS[type] }}>
      {type}
    </span>
  );
}

function TypeGroup({ label, vals }) {
  if (!vals.length) return null;
  return (
    <div className="tc-focus-group">
      <span className="tc-focus-label">{label}:</span>
      <div className="tc-focus-types">
        {vals.map((t) => (
          <span key={t} className="tc-focus-type" style={{ background: TYPE_COLORS[t] }}>
            {t}
          </span>
        ))}
      </div>
    </div>
  );
}
