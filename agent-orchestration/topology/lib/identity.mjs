// Agent identity. An agent has two identifiers with different jobs and different lifetimes:
//
//   id     a short stable slug minted once at creation. It is the address every machine surface
//          uses — session names, mailbox paths, routing predicates, delegation tokens, journals.
//          It is never derived from the name, so a name collision can never disturb an address.
//   name   first + last + a title derived from the role. This is what people see. Humans never
//          need to read an id; agents and machines may.
//
// Generation of the two is deliberately decoupled: mintId() takes nothing from the name, and
// mintName() takes nothing from the id. A name is checked against the existing roster before it
// is handed out, so two agents in one repo never share a display identity.
import { randomBytes } from "node:crypto";
import { slug } from "./util.mjs";

const FIRST = [
  "Ada", "Bell", "Cyrus", "Dara", "Emil", "Fern", "Goro", "Hana", "Ilya", "Juno",
  "Kiran", "Lior", "Mira", "Noor", "Osric", "Petra", "Quill", "Rune", "Sable", "Tovi",
  "Umi", "Vesna", "Wren", "Xan", "Yara", "Zev", "Anwen", "Basil", "Cleo", "Dmitri",
  "Esme", "Faro", "Greta", "Hollis", "Ines", "Jasper", "Kaya", "Lars", "Maeve", "Niko",
];
const LAST = [
  "Alderton", "Braith", "Calloway", "Duvall", "Eastwood", "Fairbairn", "Grieve", "Halloran",
  "Ivers", "Jarrow", "Keswick", "Lindqvist", "Merrow", "Nakamura", "Okonkwo", "Prentice",
  "Quintero", "Rasmussen", "Stroud", "Thorne", "Ulriksen", "Vale", "Whitlock", "Xiang",
  "Yarrow", "Zabala", "Ashcroft", "Bellweather", "Corriveau", "Dunmore",
];

/** Title per role. Every built-in role plus `lead` has one; anything else falls back. */
const TITLES = {
  lead: "Engineering Lead",
  orchestrator: "Delivery Coordinator",
  worker: "Engineer",
  designer: "Design Engineer",
  judge: "Review Judge",
  reviewer: "Staff Reviewer",
  researcher: "Research Engineer",
  implementer: "Implementation Engineer",
};

export function titleForRole(role) {
  return TITLES[role] || "Engineer";
}

/**
 * A stable agent id. Independent of the name: 8 characters, minted once and stored.
 * Short enough to read in a session name, wide enough that a repo's roster will not collide.
 *
 * The first character is forced into [a-f] because an id must be usable in EVERY place an id is
 * used, and the strictest of those — a spec's `agents[].id` slug rule — requires a leading letter.
 * A digit-leading id parses fine as a directory name and a tmux session, then fails validation the
 * first time someone writes it into a spec or a workflow reference. Constraining the generator is
 * one rule; relaxing each consumer is a rule per consumer, forever.
 */
export function mintId(rand = randomBytes) {
  const hex = rand(4).toString("hex");
  return `${"abcdef"[parseInt(hex[0], 16) % 6]}${hex.slice(1)}`;
}

/**
 * The per-spawn discriminator. Shaped like an abbreviated git sha so a session name reads the way
 * an engineer expects, but it is random rather than derived from content — its only job is to tell
 * two live spawns of the same agent apart.
 */
export function mintSpawn(rand = randomBytes) {
  return rand(4).toString("hex").slice(0, 7);
}

/**
 * Mint a display identity that no existing agent already holds.
 * `taken` is the set of full names already in use in this repo. Generation is decoupled from the
 * id, so retrying on collision costs nothing and changes no address.
 */
export function mintName(role, { taken = new Set(), rand = randomBytes, attempts = 200 } = {}) {
  const title = titleForRole(role);
  for (let i = 0; i < attempts; i += 1) {
    const first = FIRST[rand(1)[0] % FIRST.length];
    const last = LAST[rand(1)[0] % LAST.length];
    const full = `${first} ${last}`;
    if (!taken.has(full)) return { first_name: first, last_name: last, full_name: full, title };
  }
  // Deterministic escape hatch: suffix until unique rather than looping forever or throwing.
  for (let n = 2; ; n += 1) {
    const first = FIRST[0];
    const last = `${LAST[0]}-${n}`;
    const full = `${first} ${last}`;
    if (!taken.has(full)) return { first_name: first, last_name: last, full_name: full, title };
  }
}

/** How an agent is shown to a person: never the id. */
export function displayName(agent) {
  if (!agent) return "unknown agent";
  const full = agent.full_name || [agent.first_name, agent.last_name].filter(Boolean).join(" ");
  return agent.title ? `${full}, ${agent.title}` : full || agent.id || "unknown agent";
}

/** How an agent is addressed by machines: never the display name. */
export function addressOf(agent) {
  return agent?.id || null;
}

/** Session name for one spawn of one agent: stable address plus a per-spawn discriminator. */
export function sessionName(agentId, spawn) {
  return `${agentId}-${spawn}`;
}

/**
 * The other direction: which agent, and which spawn, is this session name?
 *
 * The two identifiers travel together in one string precisely so that a name found in `tmux ls` —
 * or in a gateway tab, or pasted by a person — can be resolved back without a lookup table. Parsing
 * is anchored on the discriminator rather than on the id, because an id may contain `-` while the
 * discriminator never does: it is exactly seven hex characters, minted by `mintSpawn`.
 *
 * Returns `{ agentId, spawn }`, or `null` when the name is not a spawn session — a run session
 * (`p1-slow-20260905-…`) and a durable role-session (`ao-<id>`) both correctly return null.
 */
export function parseSessionName(name) {
  const match = /^(.+)-([0-9a-f]{7})$/.exec(String(name ?? ""));
  return match ? { agentId: match[1], spawn: match[2] } : null;
}

/** The on-disk directory name for an agent's definition and its per-agent cwd. */
export function agentDirName(agent) {
  return agent?.id ? String(agent.id) : slug(agent?.full_name || "agent");
}
