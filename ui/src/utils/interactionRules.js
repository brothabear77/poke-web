// Deterministic cross-mechanic interaction detection for the coach grounding.
//
// mechanicsAnnotations.js already covers PER-MEMBER mechanic roles (memberTechNotes) and light
// intra-team hints (teamTechHighlights). This module is additive: it detects INTERACTIONS that
// span two entities — two of your Pokémon, or one of yours vs. a meta threat's top set — which
// memberTechNotes can't express and which @smogon/calc's raw KO numbers don't make explicit
// (e.g. "your contact move procs their Rocky Helmet" is a qualitative fact, not a damage number).
//
// Every check here is a plain lookup against curated tables keyed by exact display names, exactly
// like mechanicsAnnotations.js — no fuzzy matching, no RAG. Detection is precise because the whole
// point is GROUND TRUTH the LLM can cite without guessing.
//
// Some of the plan's originally-scoped rules are intentionally NOT duplicated here because
// teamTechHighlights (mechanicsAnnotations.js) already emits them into a different grounding
// section: Tailwind+Trick Room clash and bare Intimidate presence. One originally-scoped rule
// ("weather setter + its own abuser on the same mon") doesn't make mechanical sense — a Pokémon
// has exactly one ability slot, so it can't hold both a setter and an abuser ability at once.

// --- curated tables ---------------------------------------------------------

const WEATHER_SETTERS = {
  Drought: "Sun",
  Drizzle: "Rain",
  "Sand Stream": "Sandstorm",
  "Snow Warning": "Snow",
  "Primordial Sea": "Heavy Rain",
  "Desolate Land": "Harsh Sun",
};

const WEATHER_ABUSERS = {
  Chlorophyll: { weather: "Sun", boost: "doubles Speed" },
  "Swift Swim": { weather: "Rain", boost: "doubles Speed" },
  "Sand Rush": { weather: "Sandstorm", boost: "doubles Speed" },
  "Slush Rush": { weather: "Snow", boost: "doubles Speed" },
  "Solar Power": { weather: "Sun", boost: "+50% Sp. Atk (costs HP each turn)" },
  "Sand Force": { weather: "Sandstorm", boost: "+30% to Rock/Ground/Steel moves" },
};

const TERRAIN_SETTERS = {
  "Grassy Surge": "Grassy Terrain",
  "Electric Surge": "Electric Terrain",
  "Psychic Surge": "Psychic Terrain",
  "Misty Surge": "Misty Terrain",
};

// Moves that specifically benefit from a matching terrain (beyond the terrain's blanket effect).
const TERRAIN_MOVE_ABUSERS = {
  "Grassy Terrain": { move: "Grassy Glide", note: "gains +1 priority" },
  "Electric Terrain": { move: "Rising Voltage", note: "doubles in power" },
};

const CONTACT_PUNISH_ABILITIES = new Set([
  "Rough Skin", "Iron Barbs", "Static", "Flame Body", "Poison Point",
  "Effect Spore", "Cursed Body", "Gooey", "Tangling Hair", "Mummy", "Aftermath",
]);
const CONTACT_PUNISH_ITEMS = new Set(["Rocky Helmet"]);

const IMMUNITY_ABILITIES = {
  Levitate: "Ground",
  "Flash Fire": "Fire",
  "Water Absorb": "Water",
  "Storm Drain": "Water",
  "Volt Absorb": "Electric",
  "Lightning Rod": "Electric",
  "Motor Drive": "Electric",
  "Sap Sipper": "Grass",
  "Earth Eater": "Ground",
  "Well-Baked Body": "Fire",
  "Dry Skin": "Water",
};

const REDIRECTION_MOVES = new Set(["Follow Me", "Rage Powder"]);
const SETUP_MOVES = new Set([
  "Swords Dance", "Dragon Dance", "Nasty Plot", "Calm Mind", "Quiver Dance",
  "Bulk Up", "Shell Smash", "Agility", "Iron Defense", "Work Up",
]);
const CHOICE_ITEMS = new Set(["Choice Band", "Choice Specs", "Choice Scarf"]);

const titleCase = (s) => s.replace(/-/g, " ").replace(/(^|\s)\S/g, (c) => c.toUpperCase());

// --- detector ----------------------------------------------------------------
// ctx: {
//   format: "Doubles" | "Singles",
//   members: [{ name, types, ability, item, moves }],   // your team, from currentBuilds
//   threats: [{ name, types, ability, item }],            // top meta threats' top sets
//   moveFlag: (moveName) => { contact, priority, target, category, type },  // from @smogon/calc, cached
//   speedOrder: { tiers: [{ name, spe, mine, id? }] },     // real L50 speeds, for priority-vs-faster
// }
// Returns string[] — ground-truth sentences, capped by the caller.
export function detectInteractions(ctx) {
  const { format, members = [], threats = [], moveFlag, speedOrder } = ctx;
  const notes = [];
  const isDoubles = format === "Doubles";

  // 1. Weather synergy: a setter's weather matches another member's weather-abuser ability.
  for (const setter of members) {
    const weather = WEATHER_SETTERS[setter.ability];
    if (!weather) continue;
    for (const abuser of members) {
      if (abuser === setter) continue;
      const abuse = WEATHER_ABUSERS[abuser.ability];
      if (abuse && abuse.weather === weather) {
        notes.push(`${titleCase(setter.name)}'s ${setter.ability} sets ${weather}, which turns on ${titleCase(abuser.name)}'s ${abuser.ability} (${abuse.boost}).`);
      }
    }
  }

  // 2. Terrain synergy: a terrain setter + another member running the terrain's abuser move.
  for (const setter of members) {
    const terrain = TERRAIN_SETTERS[setter.ability];
    if (!terrain) continue;
    const abuse = TERRAIN_MOVE_ABUSERS[terrain];
    if (!abuse) continue;
    for (const other of members) {
      if (other === setter) continue;
      if ((other.moves || []).includes(abuse.move)) {
        notes.push(`${titleCase(setter.name)}'s ${setter.ability} sets ${terrain}, so ${titleCase(other.name)}'s ${abuse.move} ${abuse.note}.`);
      }
    }
  }

  // 3 & 4. Spread moves that also hit your own ally in Doubles (target "allAdjacent", e.g.
  // Earthquake/Discharge) — safe if a teammate is immune to that move's type, otherwise a real risk.
  if (isDoubles) {
    for (const attacker of members) {
      for (const mv of attacker.moves || []) {
        const flag = moveFlag?.(mv);
        if (!flag || flag.target !== "allAdjacent") continue;
        const immuneAlly = members.find((m) => m !== attacker && IMMUNITY_ABILITIES[m.ability] && flag.type && IMMUNITY_ABILITIES[m.ability] === flag.type);
        if (immuneAlly) {
          notes.push(`${titleCase(attacker.name)}'s ${mv} hits both foes and your ally, but ${titleCase(immuneAlly.name)} is immune to it via ${immuneAlly.ability} — safe to click with that pairing active.`);
        } else if (members.length > 1) {
          notes.push(`${titleCase(attacker.name)}'s ${mv} also hits your own ally in Doubles — no teammate is immune to it, so position or Protect around it.`);
        }
      }
    }
  }

  // 5. Redirection can shield a frail setup sweeper.
  const redirectors = members.filter((m) => (m.moves || []).some((mv) => REDIRECTION_MOVES.has(mv)));
  const setupUsers = members.filter((m) => (m.moves || []).some((mv) => SETUP_MOVES.has(mv)));
  for (const r of redirectors) {
    for (const s of setupUsers) {
      if (r === s) continue;
      notes.push(`${titleCase(r.name)}'s redirection can draw attacks off ${titleCase(s.name)} while it sets up.`);
    }
  }

  // 7. Choice item wants Speed/consistency; Trick Room wants the team slow — flag the tension.
  const choiceHolders = members.filter((m) => CHOICE_ITEMS.has(m.item));
  const trickRoomers = members.filter((m) => (m.moves || []).includes("Trick Room"));
  if (choiceHolders.length && trickRoomers.length) {
    notes.push(`${choiceHolders.map((m) => titleCase(m.name)).join("/")} holding a Choice item sits awkwardly with ${trickRoomers.map((m) => titleCase(m.name)).join("/")}'s Trick Room — Trick Room wants your team slow, but a Choice Scarf holder is built to be fast, and Choice Band/Specs holders lose their locked move's value if forced to pivot around the room.`);
  }

  // 8 & 9. Your contact moves vs. a threat's contact-punish item/ability.
  for (const attacker of members) {
    const contactMoves = (attacker.moves || []).filter((mv) => moveFlag?.(mv)?.contact);
    if (!contactMoves.length) continue;
    for (const threat of threats) {
      if (threat.item && CONTACT_PUNISH_ITEMS.has(threat.item)) {
        notes.push(`${titleCase(attacker.name)}'s contact moves (e.g. ${contactMoves[0]}) take ${threat.item} chip from ${threat.name} — expect the recoil or use a non-contact option.`);
      }
      if (threat.ability && CONTACT_PUNISH_ABILITIES.has(threat.ability)) {
        notes.push(`Hitting ${threat.name} with ${titleCase(attacker.name)}'s contact moves (e.g. ${contactMoves[0]}) risks its ${threat.ability}.`);
      }
    }
  }

  // 10. Opposing Intimidate softens your physical attackers on switch-in.
  const intimidateThreats = threats.filter((t) => t.ability === "Intimidate");
  for (const threat of intimidateThreats) {
    for (const member of members) {
      const hasPhysical = (member.moves || []).some((mv) => moveFlag?.(mv)?.category === "Physical");
      if (hasPhysical) {
        notes.push(`${threat.name}'s Intimidate drops ${titleCase(member.name)}'s Attack on switch-in — lean on a special option, set up first, or pivot rather than trading blows immediately.`);
      }
    }
  }

  // 12. A slower member's priority move still goes first against a faster threat.
  if (speedOrder?.tiers?.length) {
    const speByName = new Map(speedOrder.tiers.map((t) => [t.name, t]));
    for (const member of members) {
      const mine = speByName.get(member.name);
      if (!mine) continue;
      const priorityMoves = (member.moves || []).filter((mv) => {
        const f = moveFlag?.(mv);
        return f && f.priority > 0 && f.category !== "Status";
      });
      if (!priorityMoves.length) continue;
      for (const threat of threats) {
        const theirs = speByName.get(threat.name);
        if (theirs && theirs.spe > mine.spe) {
          notes.push(`${titleCase(member.name)} is slower than ${threat.name}, but its priority move ${priorityMoves[0]} still hits first.`);
        }
      }
    }
  }

  // 15. Grassy Terrain passively heals grounded Pokémon each turn.
  const grassySetter = members.find((m) => m.ability === "Grassy Surge");
  if (grassySetter) {
    notes.push(`${titleCase(grassySetter.name)}'s Grassy Surge sets Grassy Terrain, healing ~1/16 max HP each turn for your grounded Pokémon while it's up (Flying-types/Levitate users don't benefit).`);
  }

  // Dedup identical strings (can happen with multiple members triggering the same phrasing).
  return [...new Set(notes)];
}
