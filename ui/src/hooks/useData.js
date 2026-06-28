import { useState, useEffect } from "react";
import { assetUrl } from "../utils/assetUrl";

const cache = new Map();

export function useData(path) {
  const [data, setData] = useState(path ? (cache.get(path) ?? null) : null);
  const [loading, setLoading] = useState(!!path && !cache.has(path));
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!path) return; // null path = skip fetch (used for lazy loading)
    if (cache.has(path)) {
      setData(cache.get(path));
      setLoading(false);
      return;
    }
    setLoading(true);
    fetch(assetUrl(path))
      .then((r) => {
        if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
        return r.json();
      })
      .then((d) => {
        cache.set(path, d);
        setData(d);
        setLoading(false);
      })
      .catch((e) => {
        setError(e.message);
        setLoading(false);
      });
  }, [path]);

  return { data, loading, error };
}
