// Curated competitive-mechanics knowledge layer.
//
// The usage data tells us WHICH ability / moves / item a Pokémon runs; this
// module supplies the "why" — concise effect summaries for the notable
// mechanics that actually appear in the Champions meta, plus interaction
// detectors that synthesize them (e.g. Prankster + Tailwind → fast, reliable
// team speed control). Everything here is offline and deterministic; it also
// doubles as grounding context for the optional LLM coach.
//
// Keyed by the display names exactly as they appear in the usage data
// ("Intimidate", "Tailwind", "Life Orb"). To extend coverage, add entries —
// the detectors below pick them up automatically.

// tag groups: speed-control | redirection | disruption | pivot | setup |
// priority | defensive | offensive | immunity | weather | terrain | utility

export const ABILITY_NOTES = {
  Intimidate:    { tag: "disruption",  text: "lowers both opponents' Attack on switch-in, softening physical attackers." },
  Prankster:     { tag: "priority",    text: "gives its status moves +1 priority." },
  Regenerator:   { tag: "pivot",       text: "restores 1/3 HP whenever it switches out — a low-risk pivot." },
  "Flash Fire":  { tag: "immunity",    text: "absorbs Fire moves (immune) and powers up its own Fire attacks." },
  Levitate:      { tag: "immunity",    text: "immune to Ground moves." },
  "Sap Sipper":  { tag: "immunity",    text: "immune to Grass moves, gaining +1 Attack when hit by one." },
  "Volt Absorb": { tag: "immunity",    text: "immune to Electric moves and heals from them." },
  "Water Absorb":{ tag: "immunity",    text: "immune to Water moves and heals from them." },
  Sturdy:        { tag: "defensive",   text: "survives any one-shot from full HP (built-in Focus Sash)." },
  "Mold Breaker":{ tag: "offensive",   text: "ignores abilities that would block its moves." },
  Infiltrator:   { tag: "offensive",   text: "ignores screens, Substitute, and Safeguard." },
  "Sheer Force": { tag: "offensive",   text: "boosts moves with secondary effects (and drops the side effect)." },
  Moxie:         { tag: "setup",       text: "+1 Attack after each KO — snowballs late-game." },
  Guts:          { tag: "offensive",   text: "boosts Attack when statused, so it doesn't mind burns/paralysis." },
  "Iron Fist":   { tag: "offensive",   text: "powers up punching moves." },
  Static:        { tag: "disruption",  text: "may paralyze attackers that make contact." },
  "Speed Boost": { tag: "speed-control", text: "+1 Speed every turn — outpaces the field if left in." },
  Unburden:      { tag: "speed-control", text: "doubles Speed once its held item is used up." },
  Chlorophyll:   { tag: "weather",     text: "doubles Speed in sun." },
  "Swift Swim":  { tag: "weather",     text: "doubles Speed in rain." },
  "Sand Rush":   { tag: "weather",     text: "doubles Speed in sand." },
  "Slush Rush":  { tag: "weather",     text: "doubles Speed in snow." },
  Drought:       { tag: "weather",     text: "sets harsh sunlight on entry." },
  Drizzle:       { tag: "weather",     text: "sets rain on entry." },
  "Sand Stream": { tag: "weather",     text: "sets a sandstorm on entry." },
  "Snow Warning":{ tag: "weather",     text: "sets snow on entry (boosts Ice-type Defense)." },
  Protosynthesis:{ tag: "setup",       text: "boosts its best stat in sun or off a Booster Energy." },
  "Quark Drive": { tag: "setup",       text: "boosts its best stat on Electric Terrain or off a Booster Energy." },
  "Weak Armor":  { tag: "speed-control", text: "+2 Speed (−1 Def) when hit by a physical move." },
  "Anger Point": { tag: "setup",       text: "maxes Attack if hit by a critical hit." },
  "Cursed Body": { tag: "disruption",  text: "may disable a move that hits it." },
  "Natural Cure":{ tag: "pivot",       text: "cures its status when it switches out." },
  Telepathy:     { tag: "utility",     text: "dodges its ally's spread moves in doubles." },
  Pressure:      { tag: "utility",     text: "makes foes spend PP faster." },
  Unnerve:       { tag: "disruption",  text: "stops foes from eating their Berries." },
  Frisk:         { tag: "utility",     text: "reveals a foe's held item." },
  Insomnia:      { tag: "immunity",    text: "can't be put to sleep." },
  "Inner Focus": { tag: "immunity",    text: "can't be made to flinch (ignores Fake Out)." },
  "Own Tempo":   { tag: "immunity",    text: "can't be confused or Intimidated." },
  Limber:        { tag: "immunity",    text: "can't be paralyzed." },
  Oblivious:     { tag: "immunity",    text: "can't be Taunted, infatuated, or Intimidated." },
};

export const MOVE_NOTES = {
  Protect:        { tag: "utility",       text: "scouts and stalls — key for doubles tempo." },
  Tailwind:       { tag: "speed-control", text: "doubles your whole side's Speed for 3 turns." },
  "Trick Room":   { tag: "speed-control", text: "reverses turn order for 5 turns so slow Pokémon move first." },
  "Follow Me":    { tag: "redirection",   text: "draws all single-target attacks onto itself to shield a partner." },
  "Rage Powder":  { tag: "redirection",   text: "draws single-target attacks onto itself to shield a partner." },
  "Helping Hand": { tag: "utility",       text: "boosts an ally's attack by 50% for the turn." },
  Taunt:          { tag: "disruption",    text: "blocks the target's status moves for 3 turns." },
  Encore:         { tag: "disruption",    text: "locks the target into repeating its last move for 3 turns — but FAILS if the target has not used a move yet, so it does nothing on turn 1 or against a foe that just switched in; use it only after the target has committed a move." },
  "Will-O-Wisp":  { tag: "disruption",    text: "burns the target, halving its physical damage." },
  "Thunder Wave": { tag: "disruption",    text: "paralyzes the target, quartering its Speed." },
  Yawn:           { tag: "disruption",    text: "forces a switch or puts the target to sleep next turn." },
  Spore:          { tag: "disruption",    text: "guaranteed sleep (the strongest sleep move)." },
  "Icy Wind":     { tag: "speed-control", text: "chips both foes and lowers their Speed." },
  Electroweb:     { tag: "speed-control", text: "hits both foes and lowers their Speed." },
  "Fake Out":     { tag: "priority",      text: "priority flinch on turn one to disrupt a lead." },
  "Wide Guard":   { tag: "defensive",     text: "blocks spread moves for your side this turn." },
  Reflect:        { tag: "defensive",     text: "halves physical damage to your side for 5 turns." },
  "Light Screen": { tag: "defensive",     text: "halves special damage to your side for 5 turns." },
  Substitute:     { tag: "defensive",     text: "sets a decoy that blocks status and chip." },
  "Destiny Bond": { tag: "disruption",    text: "if it faints, it drags the attacker down with it." },
  "Leech Seed":   { tag: "utility",       text: "drains the target's HP each turn." },
  Toxic:          { tag: "disruption",    text: "badly poisons for escalating damage." },
  "Knock Off":    { tag: "disruption",    text: "removes the target's item (and hits hard)." },
  "U-turn":       { tag: "pivot",         text: "deals damage then pivots out." },
  "Volt Switch":  { tag: "pivot",         text: "deals damage then pivots out." },
  "Flip Turn":    { tag: "pivot",         text: "deals damage then pivots out." },
  "Swords Dance": { tag: "setup",         text: "+2 Attack to set up a sweep." },
  "Nasty Plot":   { tag: "setup",         text: "+2 Sp. Atk to set up a sweep." },
  "Dragon Dance": { tag: "setup",         text: "+1 Attack and +1 Speed to set up a sweep." },
  "Calm Mind":    { tag: "setup",         text: "+1 Sp. Atk and +1 Sp. Def." },
  "Bulk Up":      { tag: "setup",         text: "+1 Attack and +1 Defense." },
  "Iron Defense": { tag: "setup",         text: "+2 Defense (often paired with Body Press)." },
  "Stealth Rock": { tag: "utility",       text: "chips foes on switch-in (entry hazard)." },
  "Sucker Punch": { tag: "priority",      text: "priority, but only works if the target attacks." },
  "Aqua Jet":     { tag: "priority",      text: "priority Water move to pick off weakened foes." },
  "Shadow Sneak": { tag: "priority",      text: "priority Ghost move to pick off weakened foes." },
  "Grassy Glide": { tag: "priority",      text: "priority on Grassy Terrain." },
  "Extreme Speed":{ tag: "priority",      text: "strong +2 priority move." },
  "Bullet Punch": { tag: "priority",      text: "priority Steel move." },
  "Ice Shard":    { tag: "priority",      text: "priority Ice move to pick off weakened foes." },
  "Mach Punch":   { tag: "priority",      text: "priority Fighting move." },
  "Quick Attack": { tag: "priority",      text: "priority Normal move." },
  "Foul Play":    { tag: "offensive",     text: "uses the target's own Attack stat against it." },
  "Body Press":   { tag: "offensive",     text: "damages using Defense instead of Attack." },
};

export const ITEM_NOTES = {
  "Life Orb":     { tag: "offensive",  text: "+30% damage at the cost of recoil." },
  "Focus Sash":   { tag: "defensive",  text: "survives any one hit from full HP at 1 HP." },
  "Choice Scarf": { tag: "speed-control", text: "+50% Speed, but locks into one move." },
  "Choice Band":  { tag: "offensive",  text: "+50% Attack, but locks into one move." },
  "Choice Specs": { tag: "offensive",  text: "+50% Sp. Atk, but locks into one move." },
  "Assault Vest": { tag: "defensive",  text: "+50% Sp. Def, but no status moves." },
  "Sitrus Berry": { tag: "defensive",  text: "heals ~25% HP once when it drops to half." },
  Leftovers:      { tag: "defensive",  text: "passively heals each turn for longevity." },
  "Rocky Helmet": { tag: "defensive",  text: "chips attackers that make contact." },
  "Lum Berry":    { tag: "utility",    text: "cures any status once (or wakes from sleep)." },
  "Mental Herb":  { tag: "utility",    text: "blocks the first Taunt/Encore/disable." },
  "Covert Cloak": { tag: "defensive",  text: "blocks added move effects (flinch, drops, etc.)." },
  "Safety Goggles":{ tag: "immunity",  text: "ignores weather damage and powder moves." },
  "Clear Amulet": { tag: "immunity",   text: "prevents stat drops (ignores Intimidate)." },
  "Booster Energy":{ tag: "setup",     text: "triggers Protosynthesis/Quark Drive without weather/terrain." },
  "Weakness Policy":{ tag: "setup",    text: "+2 Atk and +2 Sp. Atk after taking a super-effective hit." },
  "Quick Claw":   { tag: "speed-control", text: "20% chance to move first regardless of Speed." },
  "Light Clay":   { tag: "defensive",  text: "extends Reflect/Light Screen to 8 turns." },
  "White Herb":   { tag: "utility",    text: "restores lowered stats once." },
  "Expert Belt":  { tag: "offensive",  text: "+20% to super-effective hits." },
  "Wide Lens":    { tag: "offensive",  text: "+10% accuracy (shores up shaky moves)." },
  "Muscle Band":  { tag: "offensive",  text: "+10% to physical moves." },
  "Wise Glasses": { tag: "offensive",  text: "+10% to special moves." },
  "Chesto Berry": { tag: "utility",    text: "wakes up immediately (enables Rest)." },
  "Bright Powder":{ tag: "defensive",  text: "slightly lowers foes' accuracy." },
};

// Type-resist ("pinch") berries — each halves one super-effective hit of its type.
const RESIST_BERRY_TYPE = {
  "Shuca Berry": "Ground", "Chople Berry": "Fighting", "Occa Berry": "Fire",
  "Passho Berry": "Water", "Colbur Berry": "Dark", "Roseli Berry": "Fairy",
  "Kasib Berry": "Ghost", "Wacan Berry": "Electric", "Yache Berry": "Ice",
  "Haban Berry": "Dragon", "Rindo Berry": "Grass", "Babiri Berry": "Steel",
  "Charti Berry": "Rock", "Tanga Berry": "Bug", "Payapa Berry": "Psychic",
  "Coba Berry": "Flying", "Kebia Berry": "Poison", "Chilan Berry": "Normal",
};

const STATUS_PRIORITY_HIGHLIGHTS = {
  Tailwind: "near-guaranteed fast Tailwind for team speed control",
  "Trick Room": "priority Trick Room that beats most other setters",
  Taunt: "priority Taunt to shut down a foe before it acts",
  "Will-O-Wisp": "priority burns to cripple physical attackers",
  "Thunder Wave": "priority paralysis for speed control",
  Encore: "fast Encore — BUT Encore needs the target to have ALREADY moved, and Prankster makes this Pokémon move FIRST, so a turn-1 Encore (or one on a foe that just switched in) FAILS with nothing to lock; do NOT open with Encore — save it for a later turn after the foe has committed to a move",
  "Light Screen": "fast screens", Reflect: "fast screens",
};

const CHOICE_ITEMS = new Set(["Choice Scarf", "Choice Band", "Choice Specs"]);
const REDIRECTION = new Set(["Follow Me", "Rage Powder"]);

// Per-member tech notes: a blend of raw annotations and synthesized interactions.
// moveMap: Map<move display name, move-index entry> (for status detection).
export function memberTechNotes(pokemon, build, moveMap) {
  if (!build) return [];
  const notes = [];
  const name = (pokemon?.name || "").replace(/-/g, " ");
  const Name = name.charAt(0).toUpperCase() + name.slice(1);
  const moves = (build.moves || []).filter(Boolean);
  const isStatus = (mv) => moveMap?.get(mv)?.damage_class === "status";

  // --- Ability ---
  const ab = ABILITY_NOTES[build.ability];
  if (ab) notes.push({ kind: "ability", tag: ab.tag, text: `${build.ability}: ${ab.text}` });

  // Prankster synthesis: which status moves get priority, with notable call-outs.
  if (build.ability === "Prankster") {
    const statusMoves = moves.filter(isStatus);
    const highlights = statusMoves.map((m) => STATUS_PRIORITY_HIGHLIGHTS[m]).filter(Boolean);
    if (highlights.length) {
      notes.push({ kind: "combo", tag: "priority", text: `Prankster + ${statusMoves.filter((m) => STATUS_PRIORITY_HIGHLIGHTS[m]).join("/")} → ${highlights.join("; ")}.` });
    } else if (statusMoves.length) {
      notes.push({ kind: "combo", tag: "priority", text: `Prankster gives +1 priority to its status moves (${statusMoves.join(", ")}).` });
    }
  }

  // Booster Energy + paradox ability.
  if (build.item === "Booster Energy" && (build.ability === "Protosynthesis" || build.ability === "Quark Drive")) {
    notes.push({ kind: "combo", tag: "setup", text: `Booster Energy triggers ${build.ability} immediately for a free boost to its best stat.` });
  }

  // Iron Defense + Body Press.
  if (moves.includes("Iron Defense") && moves.includes("Body Press")) {
    notes.push({ kind: "combo", tag: "setup", text: "Iron Defense + Body Press: each +2 Defense also raises its Body Press damage." });
  }

  // Trick Room user that is itself slow (wants to move first under it).
  if (moves.includes("Trick Room") && (pokemon?.stats?.speed ?? 99) <= 60) {
    notes.push({ kind: "combo", tag: "speed-control", text: `${Name} is slow enough to capitalize on its own Trick Room.` });
  }

  // --- Notable moves (dedup by tag emphasis: speed control, redirection, priority, setup, disruption) ---
  const seenMoveTags = new Set();
  for (const m of moves) {
    const note = MOVE_NOTES[m];
    if (!note) continue;
    // Skip generic ones already implied by a combo above.
    if (m === "Tailwind" && build.ability === "Prankster") continue;
    if (REDIRECTION.has(m)) {
      notes.push({ kind: "move", tag: note.tag, text: `${m}: ${note.text}` });
    } else if (["speed-control", "redirection", "priority", "setup", "disruption"].includes(note.tag) && !seenMoveTags.has(note.tag)) {
      notes.push({ kind: "move", tag: note.tag, text: `${m}: ${note.text}` });
      seenMoveTags.add(note.tag);
    }
  }

  // --- Item ---
  if (build.item) {
    const it = ITEM_NOTES[build.item];
    if (it) {
      notes.push({ kind: "item", tag: it.tag, text: `${build.item}: ${it.text}` });
    } else if (RESIST_BERRY_TYPE[build.item]) {
      notes.push({ kind: "item", tag: "defensive", text: `${build.item}: halves one super-effective ${RESIST_BERRY_TYPE[build.item]} hit.` });
    }
    if (CHOICE_ITEMS.has(build.item) && moves.length > 1) {
      notes.push({ kind: "combo", tag: "utility", text: `Locked by ${build.item} — pick the move each turn carefully (it can't switch moves without switching out).` });
    }
  }

  return notes;
}

// Team-level synthesis: the recurring engines that define how the team wins.
export function teamTechHighlights(team, builds) {
  const highlights = [];
  const titleCase = (s) => s.replace(/(^|\s)\S/g, (c) => c.toUpperCase());
  const named = (arr) => arr.map((p) => titleCase(p.name.replace(/-/g, " "))).join(", ");

  const tailwind = team.filter((p) => (builds.get(p.id)?.moves || []).includes("Tailwind"));
  const trickroom = team.filter((p) => (builds.get(p.id)?.moves || []).includes("Trick Room"));
  const intimidate = team.filter((p) => builds.get(p.id)?.ability === "Intimidate");
  const redirect = team.filter((p) => (builds.get(p.id)?.moves || []).some((m) => REDIRECTION.has(m)));
  const fakeout = team.filter((p) => (builds.get(p.id)?.moves || []).includes("Fake Out"));
  const setup = team.filter((p) => (builds.get(p.id)?.moves || []).some((m) => MOVE_NOTES[m]?.tag === "setup"));

  if (tailwind.length) highlights.push(`Speed control: ${named(tailwind)} can set Tailwind to double your side's Speed.`);
  if (trickroom.length) highlights.push(`Trick Room mode: ${named(trickroom)} flips turn order for slow attackers — build around it (don't mix with Tailwind).`);
  if (tailwind.length && trickroom.length) highlights.push(`⚠ You have both Tailwind and Trick Room — they cancel each other; usually pick one speed mode.`);
  if (intimidate.length >= 1) highlights.push(`Intimidate from ${named(intimidate)} chips opposing Attack to ease physical matchups.`);
  if (redirect.length) highlights.push(`Redirection: ${named(redirect)} can soak attacks (Follow Me/Rage Powder) to protect a sweeper.`);
  if (fakeout.length) highlights.push(`Fake Out pressure from ${named(fakeout)} buys tempo for setup or a KO.`);
  if (setup.length) highlights.push(`Win condition: ${named(setup)} can snowball with a setup move once their checks are gone.`);

  return highlights;
}
