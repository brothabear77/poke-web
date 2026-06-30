import { useState, useEffect } from "react";
import { assetUrl } from "../utils/assetUrl";

// Lazy-loads the Champions usage JSON for a *dynamic set* of Pokémon ids (the
// current team members). `useData` only handles a single static path, so this
// hook fans out over an id list, fetching any not-yet-cached files and exposing
// them as a Map keyed by id. Results are cached at module scope so switching a
// Pokémon out and back in (or selecting a teammate) costs no refetch.

const cache = new Map(); // id -> usage json

export function useUsageFiles(ids) {
  const [byId, setById] = useState(() => {
    const m = new Map();
    for (const id of ids || []) if (cache.has(id)) m.set(id, cache.get(id));
    return m;
  });
  const [loading, setLoading] = useState(false);

  // Stable dependency: sorted, comma-joined id list.
  const key = (ids || []).slice().sort((a, b) => a - b).join(",");

  useEffect(() => {
    const list = key ? key.split(",").map(Number) : [];
    const missing = list.filter((id) => !cache.has(id));

    // Always rebuild the map from cache so removed ids drop out immediately.
    const build = () => {
      const m = new Map();
      for (const id of list) if (cache.has(id)) m.set(id, cache.get(id));
      return m;
    };

    if (missing.length === 0) {
      setById(build());
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    Promise.all(
      missing.map((id) =>
        fetch(assetUrl(`/data/usage/${id}.json`))
          .then((r) => (r.ok ? r.json() : null))
          .then((d) => { if (d) cache.set(id, d); })
          .catch(() => {})
      )
    ).then(() => {
      if (cancelled) return;
      setById(build());
      setLoading(false);
    });

    return () => { cancelled = true; };
  }, [key]);

  return { byId, loading };
}
