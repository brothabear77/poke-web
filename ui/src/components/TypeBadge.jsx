import { TYPE_COLORS } from "../utils/typeColors";
import "./TypeBadge.css";

export default function TypeBadge({ type, small }) {
  const color = TYPE_COLORS[type] ?? "#888";
  return (
    <span
      className={`type-badge${small ? " type-badge--small" : ""}`}
      style={{ background: color }}
    >
      {type}
    </span>
  );
}
