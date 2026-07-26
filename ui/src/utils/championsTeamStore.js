// Read-only access to the Champions Team Builder's saved team, so other pages (e.g. the
// Scenario Oracle) can default to "your team" without depending on the Team Builder page itself.
// The Team Builder remains the sole WRITER of these localStorage keys
// (ui/src/pages/ChampionsTeamBuilder.jsx: "champions-team" / "champions-builds").

export function loadJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

// The saved team's Smogon species keys, in slot order (empty array if no team saved yet).
export function loadSavedTeamIds() {
  return loadJson("champions-team", []);
}

// A saved build override for one member in one format, or null if the user never edited it
// (in which case the caller should fall back to `defaultBuild` from championsStrategy.js).
export function loadBuild(id, format) {
  const store = loadJson("champions-builds", {});
  return store?.[id]?.[format] || null;
}
