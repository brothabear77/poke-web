import { useState, useMemo } from "react";
import { useData } from "../hooks/useData";
import TypeBadge from "../components/TypeBadge";
import { TYPE_COLORS } from "../utils/typeColors";
import "./MoveBrowser.css";

const TYPES = Object.keys(TYPE_COLORS);
const DAMAGE_CLASSES = ["physical", "special", "status"];
const PAGE_SIZE_OPTIONS = [25, 50, 100, 200];

const COL_DEFS = [
  { key: "id",          label: "#",      numeric: true  },
  { key: "display_name",label: "Name",   numeric: false },
  { key: "type",        label: "Type",   numeric: false },
  { key: "damage_class",label: "Class",  numeric: false },
  { key: "power",       label: "Power",  numeric: true  },
  { key: "accuracy",    label: "Acc.",   numeric: true  },
  { key: "pp",          label: "PP",     numeric: true  },
];

export default function MoveBrowser() {
  const { data: moves, loading } = useData("/data/moves-index.json");
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [classFilter, setClassFilter] = useState("");
  const [sort, setSort] = useState({ key: "id", dir: "asc" });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);

  const filtered = useMemo(() => {
    if (!moves) return [];
    let list = moves;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter((m) => m.display_name.toLowerCase().includes(q) || m.name.includes(q));
    }
    if (typeFilter) list = list.filter((m) => m.type === typeFilter);
    if (classFilter) list = list.filter((m) => m.damage_class === classFilter);

    list = [...list].sort((a, b) => {
      const va = a[sort.key] ?? -Infinity;
      const vb = b[sort.key] ?? -Infinity;
      if (va < vb) return sort.dir === "asc" ? -1 : 1;
      if (va > vb) return sort.dir === "asc" ? 1 : -1;
      return 0;
    });
    return list;
  }, [moves, search, typeFilter, classFilter, sort]);

  const totalPages = Math.ceil(filtered.length / pageSize);
  const visible = filtered.slice((page - 1) * pageSize, page * pageSize);

  function toggleSort(key) {
    setSort((s) => s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "desc" });
    setPage(1);
  }

  function resetPage() { setPage(1); }

  if (loading) return <div className="moves-loading">Loading moves...</div>;

  return (
    <div className="move-browser">
      <div className="mb-filters">
        <div className="search-wrap">
          <input
            className="filter-input"
            placeholder="Search moves..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); resetPage(); }}
          />
          {search && (
            <button className="search-clear" onClick={() => { setSearch(""); resetPage(); }} aria-label="Clear search">✕</button>
          )}
        </div>
        <select
          className="filter-select"
          value={typeFilter}
          onChange={(e) => { setTypeFilter(e.target.value); resetPage(); }}
        >
          <option value="">All Types</option>
          {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <select
          className="filter-select"
          value={classFilter}
          onChange={(e) => { setClassFilter(e.target.value); resetPage(); }}
        >
          <option value="">All Classes</option>
          {DAMAGE_CLASSES.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select
          className="filter-select"
          value={pageSize}
          onChange={(e) => { setPageSize(Number(e.target.value)); resetPage(); }}
        >
          {PAGE_SIZE_OPTIONS.map((n) => (
            <option key={n} value={n}>{n} per page</option>
          ))}
        </select>
      </div>

      <div className="mb-count">{filtered.length} moves</div>

      <div className="mb-table-wrap">
        <table className="mb-table">
          <thead>
            <tr>
              {COL_DEFS.map((col) => (
                <th
                  key={col.key}
                  className={`mb-th${col.numeric ? " mb-th--num" : ""}${sort.key === col.key ? " mb-th--sorted" : ""}`}
                  onClick={() => toggleSort(col.key)}
                >
                  {col.label}
                  {sort.key === col.key && (
                    <span className="mb-sort-icon">{sort.dir === "asc" ? " ▲" : " ▼"}</span>
                  )}
                </th>
              ))}
              <th className="mb-th">Effect</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((mv) => (
              <tr key={mv.id}>
                <td className="mb-td mb-td--num mb-td--muted">{mv.id}</td>
                <td className="mb-td mb-td--name">{mv.display_name}</td>
                <td className="mb-td">
                  {mv.type && <TypeBadge type={mv.type} small />}
                </td>
                <td className="mb-td">
                  <span className={`mb-class mb-class--${mv.damage_class}`}>
                    {mv.damage_class ?? "—"}
                  </span>
                </td>
                <td className="mb-td mb-td--num">{mv.power ?? "—"}</td>
                <td className="mb-td mb-td--num">{mv.accuracy != null ? `${mv.accuracy}%` : "—"}</td>
                <td className="mb-td mb-td--num">{mv.pp ?? "—"}</td>
                <td className="mb-td mb-td--effect">{mv.short_effect ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="mb-pagination">
          <button disabled={page === 1} onClick={() => setPage(1)}>«</button>
          <button disabled={page === 1} onClick={() => setPage((p) => p - 1)}>‹</button>
          <span>Page {page} of {totalPages}</span>
          <button disabled={page === totalPages} onClick={() => setPage((p) => p + 1)}>›</button>
          <button disabled={page === totalPages} onClick={() => setPage(totalPages)}>»</button>
        </div>
      )}
    </div>
  );
}
