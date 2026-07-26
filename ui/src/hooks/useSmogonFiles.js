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

let replayCache = null;      // replay-derived openings: { Doubles:{key:{...}}, Singles:{...} }
let replayPromise = null;

let metaCache = null;        // { source, month, regulation, formats, cutoff, battles, ... }
let metaPromise = null;

// Stable empty-array singleton: `useSmogonIndex` must NOT return a fresh `[]` literal while
// data is loading, or every consumer downstream (useMemo/useEffect deps keyed on the `index`
// reference) sees a "new" value on every render — a classic cascade into runaway re-renders
// (confirmed: it caused a genuine "Maximum update depth exceeded" loop in a page that keyed an
// effect on data derived from this index while loading).
const EMPTY_INDEX = [];

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

  return { index: index || EMPTY_INDEX, loading };
}

// Replay-derived opening data (leads / turn-1 plays / lead partners), loaded once. Returns
// null until it arrives or if unavailable, so the coach degrades gracefully without it.
export function useReplayData() {
  const [data, setData] = useState(replayCache);

  useEffect(() => {
    if (replayCache) { setData(replayCache); return; }
    let cancelled = false;
    replayPromise = replayPromise || fetch(`${SMOGON_DATA_BASE}/replays.json`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { replayCache = d || null; return replayCache; })
      .catch(() => { replayCache = null; return null; });
    replayPromise.then((d) => { if (!cancelled) setData(d); });
    return () => { cancelled = true; };
  }, []);

  return data;
}

// Feed metadata (resolved regulation, month, cutoff, battle counts), loaded once. Returns
// null until it arrives or if unavailable — callers should treat the regulation as optional.
export function useSmogonMeta() {
  const [data, setData] = useState(metaCache);

  useEffect(() => {
    if (metaCache) { setData(metaCache); return; }
    let cancelled = false;
    metaPromise = metaPromise || fetch(`${SMOGON_DATA_BASE}/_meta.json`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { metaCache = d || null; return metaCache; })
      .catch(() => { metaCache = null; return null; });
    metaPromise.then((d) => { if (!cancelled) setData(d); });
    return () => { cancelled = true; };
  }, []);

  return data;
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
