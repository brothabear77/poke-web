// Browser-side semantic retrieval for the Team Coach knowledge layer.
//
// The corpus (ui/knowledge/corpus.json) is embedded at build time into
// public/data/knowledge-embeddings.json. At runtime we embed a query through the
// proxy (see embedQuery in llmClient.js), then rank the corpus chunks by cosine
// similarity here and inject the top few into the coach prompt as reference prose.
// Everything degrades gracefully: no query vector or no chunks -> [] (coach runs
// on its structured facts alone).

export function cosineSim(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

// Top-k chunks by similarity to queryVec. Returns [{ title, text, score }].
export function retrieve(queryVec, chunks, k = 3) {
  if (!queryVec || !Array.isArray(chunks) || chunks.length === 0) return [];
  const scored = [];
  for (const c of chunks) {
    if (!c.vector) continue;
    scored.push({ title: c.title, text: c.text, score: cosineSim(queryVec, c.vector) });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, k);
}

// Build a compact semantic description of the team to embed for the auto breakdown.
// (Free-form chat embeds the user's message instead.) Pulls from the same data the
// coach already computes: member types + chosen abilities, roles, and detected tech.
export function synthesizeTeamQuery(team, currentBuilds, report) {
  const types = new Set();
  const abilities = [];
  for (const p of team || []) {
    for (const t of p.types || []) types.add(t);
    const ability = currentBuilds?.get(p.id)?.ability;
    if (ability) abilities.push(ability);
  }
  const roles = (report?.roles || []).map((r) => r.role);
  const tech = report?.teamTech || [];

  const parts = [];
  if (types.size) parts.push(`Types: ${[...types].join(", ")}.`);
  if (roles.length) parts.push(`Roles: ${roles.join(", ")}.`);
  if (abilities.length) parts.push(`Abilities: ${abilities.join(", ")}.`);
  if (tech.length) parts.push(`Tech and game plan: ${tech.join("; ")}.`);
  return parts.join(" ");
}
