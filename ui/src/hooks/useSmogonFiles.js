import { useState, useEffect } from "react";
import { SMOGON_DATA_BASE } from "../config.js";

// Loads the poke-smogon-data feed: the roster index once, and per-species records for a
// dynamic set of keys (team members + threats). Mirrors useUsageFiles but keyed by the
// Smogon species key (e.g. "garchomp", "staraptormega") and fetched from the external
// (same-origin in prod) Pages base. Everything is module-cached, and every failure is
// swallowed so the builder degrades to Champions-only if the feed is unreachable.

let indexCache = null;      // array of { key, name, num, types, bst, isMega, megas? }
let indexPromise = null;
const fileCache = new Map(); // key -> full species record

export function useSmogonIndex() {
  const [index, setIndex] = useState(indexCache);
  const [loading, setLoading] = useState(!indexCache);

  useEffect(() => {
    if (indexCache) { setIndex(indexCache); setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    indexPromise = indexPromise || fetch(`${SMOGON_DATA_BASE}/index.json`)
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => { indexCache = Array.isArray(d) ? d : []; return indexCache; })
      .catch(() => { indexCache = []; return indexCache; });
    indexPromise.then((d) => { if (!cancelled) { setIndex(d); setLoading(false); } });
    return () => { cancelled = true; };
  }, []);

  return { index: index || [], loading };
}

export function useSmogonFiles(keys) {
  const [byKey, setByKey] = useState(() => {
    const m = new Map();
    for (const k of keys || []) if (fileCache.has(k)) m.set(k, fileCache.get(k));
    return m;
  });
  const [loading, setLoading] = useState(false);

  const depKey = (keys || []).filter(Boolean).slice().sort().join(",");

  useEffect(() => {
    const list = depKey ? depKey.split(",") : [];
    const missing = list.filter((k) => !fileCache.has(k));

    const build = () => {
      const m = new Map();
      for (const k of list) if (fileCache.has(k)) m.set(k, fileCache.get(k));
      return m;
    };

    if (missing.length === 0) { setByKey(build()); setLoading(false); return; }

    let cancelled = false;
    setLoading(true);
    Promise.all(
      missing.map((k) =>
        fetch(`${SMOGON_DATA_BASE}/${k}.json`)
          .then((r) => (r.ok ? r.json() : null))
          .then((d) => { if (d) fileCache.set(k, d); })
          .catch(() => {})
      )
    ).then(() => {
      if (cancelled) return;
      setByKey(build());
      setLoading(false);
    });

    return () => { cancelled = true; };
  }, [depKey]);

  return { byKey, loading };
}
