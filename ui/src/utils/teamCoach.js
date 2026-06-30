// Rule-based team "coach".
//
// Turns the computed team facts (analyzeTeam output + per-member usage builds)
// into a structured report and natural-language strings describing strengths,
// weaknesses, and type matchups — fully offline, no LLM required. The same
// report object is also fed to the optional BYO-key LLM as grounding context.

import { ALL_TYPES } from "./typeChart";
import {
  getBuild,
  classifyRole,
  movesByName,
  movesetCoverage,
  effectiveSpeed,
} from "./championsStrategy";
import { memberTechNotes, teamTechHighlights } from "./mechanicsAnnotations";

const cap = (t) => t.charAt(0).toUpperCase() + t.slice(1);
const list = (arr) => {
  if (arr.length === 0) return "";
  if (arr.length === 1) return arr[0];
  if (arr.length === 2) return `${arr[0]} and ${arr[1]}`;
  return `${arr.slice(0, -1).join(", ")}, and ${arr[arr.length - 1]}`;
};

// teamUsage: [{ pokemon, usage }]  builds: Map<id, buildState>
export function coachReport(team, builds, analysis, teamUsage, movesIndex, format, chart) {
  if (!team.length) {
    return { empty: true, summary: "Add Pokémon to your team to get a breakdown." };
  }

  const usageById = new Map(teamUsage.map((m) => [m.pokemon.id, m.usage]));
  const moveMap = movesByName(movesIndex);

  // Aggregate real-moveset coverage (falls back to STAB if no moves chosen yet).
  const realCovered = new Set();
  for (const p of team) {
    const b = builds.get(p.id);
    if (b?.moves?.length) {
      for (const t of movesetCoverage(b.moves, moveMap, chart)) realCovered.add(t);
    }
  }
  const covered = realCovered.size ? realCovered : analysis.offensiveCovered;
  const coveredArr = ALL_TYPES.filter((t) => covered.has(t));
  const gaps = ALL_TYPES.filter((t) => !covered.has(t));

  // Solid resists: 2+ members resist, none weak.
  const resisted = ALL_TYPES.filter(
    (t) => analysis.resistCounts[t] >= 2 && analysis.weakCounts[t] === 0
  );

  // Role composition + per-member call-outs.
  const roles = [];
  const speeds = [];
  for (const p of team) {
    const b = builds.get(p.id);
    const usage = usageById.get(p.id);
    const natures = usage ? getBuild(usage, format).natures : [];
    const role = b ? classifyRole(b, natures, p.stats) : "—";
    roles.push({
      id: p.id,
      name: p.name.replace(/-/g, " "),
      role,
      item: b?.item || null,
      nature: b?.nature || null,
    });
    if (b) speeds.push(effectiveSpeed(p.stats?.speed || 0, b, natures));
  }
  const fastCount = speeds.filter((s) => s >= 110).length;

  // --- Strengths ---
  const strengths = [];
  if (coveredArr.length >= 12)
    strengths.push(`Broad offensive coverage — hits ${coveredArr.length}/18 types super-effectively.`);
  if (resisted.length)
    strengths.push(`Solidly resists ${list(resisted.map(cap))}.`);
  if (fastCount >= 3)
    strengths.push(`Good speed control with ${fastCount} fast members.`);
  if (analysis.bstAvg >= 540)
    strengths.push(`High raw power (avg BST ${analysis.bstAvg}).`);

  // --- Weaknesses ---
  const weaknesses = [];
  for (const t of analysis.sharedWeaknesses) {
    weaknesses.push(`${analysis.weakCounts[t]} members are weak to ${cap(t)}.`);
  }
  if (gaps.length >= 8)
    weaknesses.push(`Limited coverage — no super-effective answer to ${list(gaps.slice(0, 4).map(cap))}${gaps.length > 4 ? "…" : ""}.`);
  if (!strengths.length && !weaknesses.length)
    strengths.push("Balanced so far — no glaring holes.");

  // --- Tech / mechanics synthesis ---
  const techByMember = team
    .map((p) => ({
      id: p.id,
      name: p.name.replace(/-/g, " "),
      notes: memberTechNotes(p, builds.get(p.id), moveMap).map((n) => n.text),
    }))
    .filter((m) => m.notes.length);
  const teamTech = teamTechHighlights(team, builds);

  // --- Matchups ---
  const goodAgainst = coveredArr;                 // defensive types you pressure
  const poorAgainst = analysis.sharedWeaknesses;  // attacking types that beat 2+

  const summary =
    `A ${team.length}-mon ${format} team` +
    (poorAgainst.length ? `, pressured by ${list(poorAgainst.map(cap))}` : ", with no shared weaknesses") +
    (coveredArr.length ? `; hits ${coveredArr.length}/18 types hard.` : ".");

  return {
    empty: false,
    summary,
    strengths,
    weaknesses,
    goodAgainst,
    poorAgainst,
    coveredCount: coveredArr.length,
    gaps,
    resisted,
    roles,
    speeds,
    techByMember,
    teamTech,
    bstAvg: analysis.bstAvg,
    bstTotal: analysis.bstTotal,
  };
}

export const COACH_QUESTIONS = [
  { key: "synergy",    label: "What's my game plan?" },
  { key: "weaknesses", label: "What are my weaknesses?" },
  { key: "coverage",   label: "How's my coverage?" },
  { key: "teammate",   label: "How do I improve?" },
  { key: "wincon",     label: "What's my win condition?" },
];

export function answerQuestion(key, report) {
  if (!report || report.empty) return "Add some Pokémon first and I'll break down the team.";
  switch (key) {
    case "synergy":
      if (report.teamTech?.length) return report.teamTech.join(" ");
      return "No standout mechanical synergy yet — your members mostly act independently. Adding speed control (Tailwind / Trick Room), Intimidate, or redirection would give the team a game plan.";
    case "weaknesses":
      if (!report.poorAgainst.length)
        return "No shared weaknesses — no single attacking type beats 2+ of your members. Nicely balanced defensively.";
      return (
        `Watch out for ${list(report.poorAgainst.map(cap))}. ` +
        report.weaknesses.filter((w) => /weak to/.test(w)).join(" ") +
        " Consider a member that resists those types."
      );
    case "coverage":
      return (
        `You hit ${report.coveredCount}/18 types super-effectively.` +
        (report.gaps.length
          ? ` Gaps: ${list(report.gaps.map(cap))}. A move or member covering those rounds you out.`
          : " That's complete offensive coverage.")
      );
    case "teammate": {
      const needs = report.poorAgainst.length
        ? `something that resists ${list(report.poorAgainst.map(cap))}`
        : report.gaps.length
          ? `coverage for ${list(report.gaps.slice(0, 3).map(cap))}`
          : "more raw power or speed";
      return `Your team most wants ${needs}. The teammate recommendations above are ranked with that in mind.`;
    }
    case "wincon": {
      if (report.teamTech?.length) {
        const wc = report.teamTech.find((t) => /Win condition|Trick Room mode|Speed control/.test(t));
        if (wc) return wc + " " + report.teamTech.filter((t) => t !== wc).slice(0, 1).join(" ");
      }
      const sweepers = report.roles.filter((r) => /Sweeper/.test(r.role));
      if (sweepers.length)
        return `Lean on your sweeper${sweepers.length > 1 ? "s" : ""}: ${list(sweepers.map((r) => r.name))}. Clear their checks, then sweep.`;
      const attackers = report.roles.filter((r) => /Attacker/.test(r.role));
      if (attackers.length)
        return `No dedicated sweeper — win through your attackers (${list(attackers.map((r) => r.name))}) and chip damage.`;
      return "This is a bulky team — win by grinding out matchups and wearing the opponent down.";
    }
    default:
      return report.summary;
  }
}
