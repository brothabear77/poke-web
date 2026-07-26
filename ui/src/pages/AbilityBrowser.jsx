import { useState, useMemo } from "react";
import { useData } from "../hooks/useData";
import "./AbilityBrowser.css";

const PAGE_SIZE_OPTIONS = [25, 50, 100];

export default function AbilityBrowser() {
  const { data: abilities, loading } = useData("/data/abilities-index.json");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState({ key: "display_name", dir: "asc" });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);

  const filtered = useMemo(() => {
    if (!abilities) return [];
    let list = abilities;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(
        (a) =>
          a.display_name.toLowerCase().includes(q) ||
          a.name.includes(q) ||
          (a.short_effect ?? "").toLowerCase().includes(q)
      );
    }
    list = [...list].sort((a, b) => {
      const va = (a[sort.key] ?? "").toString().toLowerCase();
      const vb = (b[sort.key] ?? "").toString().toLowerCase();
      if (va < vb) return sort.dir === "asc" ? -1 : 1;
      if (va > vb) return sort.dir === "asc" ? 1 : -1;
      return 0;
    });
    return list;
  }, [abilities, search, sort]);

  const totalPages = Math.ceil(filtered.length / pageSize);
  const visible = filtered.slice((page - 1) * pageSize, page * pageSize);

  function toggleSort(key) {
    setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" }));
    setPage(1);
  }

  function resetPage() { setPage(1); }

  if (loading) return <div className="ab-loading">Loading abilities…</div>;

  return (
    <div className="ability-browser">
      <div className="ab-filters">
        <div className="search-wrap">
          <input
            className="filter-input"
            placeholder="Search abilities…"
            value={search}
            onChange={(e) => { setSearch(e.target.value); resetPage(); }}
          />
          {search && (
            <button className="search-clear" onClick={() => { setSearch(""); resetPage(); }} aria-label="Clear search">✕</button>
          )}
        </div>
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

      <div className="ab-count">{filtered.length} abilities</div>

      <div className="ab-table-wrap">
        <table className="ab-table">
          <thead>
            <tr>
              <th className="ab-th ab-th--name ab-th--sortable" onClick={() => toggleSort("display_name")}>
                Name {sort.key === "display_name" && <span className="ab-sort-icon">{sort.dir === "asc" ? "▲" : "▼"}</span>}
              </th>
              <th className="ab-th">Description</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((a) => (
              <tr key={a.name}>
                <td className="ab-td ab-td--name">{a.display_name}</td>
                <td className="ab-td ab-td--desc">{a.short_effect ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="ab-pagination">
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
