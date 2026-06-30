import { useState, useMemo } from "react";
import { useData } from "../hooks/useData";
import "./ItemBrowser.css";

const CATEGORY_LABELS = {
  "standard-balls":   "Poké Balls",
  "special-balls":    "Special Balls",
  "apricorn-balls":   "Apricorn Balls",
  "held-items":       "Held Items",
  "bad-held-items":   "Bad Held Items",
  "choice":           "Choice Items",
  "mega-stones":      "Mega Stones",
  "z-crystals":       "Z-Crystals",
  "plates":           "Plates",
  "memories":         "Memories",
  "type-enhancement": "Type Boosts",
  "type-protection":  "Type Protection",
  "scarves":          "Scarves",
  "vitamins":         "Vitamins",
  "nature-mints":     "Nature Mints",
  "training":         "Training",
  "effort-training":  "Effort Training",
  "stat-boosts":      "Stat Boosts",
  "evolution":        "Evolution Items",
  "species-specific": "Species Items",
  "healing":          "Healing",
  "medicine":         "Medicine",
  "revival":          "Revival",
  "status-cures":     "Status Cures",
  "pp-recovery":      "PP Recovery",
  "in-a-pinch":       "Berries (Battle)",
  "jewels":           "Jewels",
  "loot":             "Loot",
  "collectibles":     "Collectibles",
  "spelunking":       "Fossils",
  "flutes":           "Flutes",
  "mulch":            "Mulch",
  "apricorn-box":     "Apricorns",
  "picky-healing":    "Picky Healing",
  "other":            "Other",
};

const PAGE_SIZE_OPTIONS = [25, 50, 100];

export default function ItemBrowser() {
  const { data: items, loading } = useData("/data/items-index.json");
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [sort, setSort] = useState({ key: "id", dir: "asc" });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);

  const categories = useMemo(() => {
    if (!items) return [];
    return [...new Set(items.map((i) => i.category))].sort();
  }, [items]);

  const filtered = useMemo(() => {
    if (!items) return [];
    let list = items;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter((i) => i.display_name.toLowerCase().includes(q) || i.name.includes(q));
    }
    if (categoryFilter) list = list.filter((i) => i.category === categoryFilter);
    list = [...list].sort((a, b) => {
      const va = a[sort.key] ?? "";
      const vb = b[sort.key] ?? "";
      if (va < vb) return sort.dir === "asc" ? -1 : 1;
      if (va > vb) return sort.dir === "asc" ? 1 : -1;
      return 0;
    });
    return list;
  }, [items, search, categoryFilter, sort]);

  const totalPages = Math.ceil(filtered.length / pageSize);
  const visible = filtered.slice((page - 1) * pageSize, page * pageSize);

  function toggleSort(key) {
    setSort((s) => s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" });
    setPage(1);
  }

  function resetPage() { setPage(1); }

  if (loading) return <div className="ib-loading">Loading items...</div>;

  return (
    <div className="item-browser">
      <div className="ib-filters">
        <div className="search-wrap">
          <input
            className="filter-input"
            placeholder="Search items..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); resetPage(); }}
          />
          {search && (
            <button className="search-clear" onClick={() => { setSearch(""); resetPage(); }} aria-label="Clear search">✕</button>
          )}
        </div>
        <select
          className="filter-select"
          value={categoryFilter}
          onChange={(e) => { setCategoryFilter(e.target.value); resetPage(); }}
        >
          <option value="">All Categories</option>
          {categories.map((c) => (
            <option key={c} value={c}>{CATEGORY_LABELS[c] ?? c}</option>
          ))}
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

      <div className="ib-count">{filtered.length} items</div>

      <div className="ib-table-wrap">
        <table className="ib-table">
          <thead>
            <tr>
              <th className="ib-th ib-th--num ib-th--sortable" onClick={() => toggleSort("id")}>
                # {sort.key === "id" && <span className="ib-sort-icon">{sort.dir === "asc" ? "▲" : "▼"}</span>}
              </th>
              <th className="ib-th ib-th--icon" />
              <th className="ib-th ib-th--sortable" onClick={() => toggleSort("display_name")}>
                Name {sort.key === "display_name" && <span className="ib-sort-icon">{sort.dir === "asc" ? "▲" : "▼"}</span>}
              </th>
              <th className="ib-th">Category</th>
              <th className="ib-th">Description</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((item) => (
              <tr key={item.id}>
                <td className="ib-td ib-td--num ib-td--muted">{item.id}</td>
                <td className="ib-td ib-td--icon">
                  {item.sprite && (
                    <img className="ib-sprite" src={item.sprite} alt={item.display_name} loading="lazy" />
                  )}
                </td>
                <td className="ib-td ib-td--name">{item.display_name}</td>
                <td className="ib-td">
                  <span className="ib-category">{CATEGORY_LABELS[item.category] ?? item.category}</span>
                </td>
                <td className="ib-td ib-td--desc">
                  {item.short_effect ?? item.flavor_text ?? ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="ib-pagination">
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
