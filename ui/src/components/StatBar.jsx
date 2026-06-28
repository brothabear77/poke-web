import { STAT_COLORS, STAT_LABELS } from "../utils/typeColors";
import "./StatBar.css";

const MAX_STAT = 255;

export default function StatBar({ statName, value }) {
  const pct = Math.min(100, (value / MAX_STAT) * 100).toFixed(1);
  const color = STAT_COLORS[statName] ?? "#aaa";
  return (
    <div className="stat-row">
      <span className="stat-label">{STAT_LABELS[statName] ?? statName}</span>
      <span className="stat-value">{value}</span>
      <div className="stat-bar-bg">
        <div className="stat-bar-fill" style={{ width: `${pct}%`, background: color }} />
      </div>
    </div>
  );
}
