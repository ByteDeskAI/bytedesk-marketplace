// The per-repo agent library. Agents are a first-class resource type alongside templates, skills,
// roles and providers: one directory per agent under `.bytedesk/agent-orchestration/agents/<id>/`,
// holding the definition, the file-backed system prompt, and the agent's own working directory.
//
// The directory doubles as the agent's cwd at spawn time. That is deliberate — Claude Code keys its
// memory by working directory, so a per-agent cwd gives each agent its own memory without inventing
// a memory layer. The real work tree is reached with --add-dir and explained in the prompt.
import { readdirSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { consumerResourceDirs, exists, fail, invariant, nowIso, writeJson } from "./util.mjs";
import { addressOf, agentDirName, displayName, mintId, mintName, titleForRole } from "./identity.mjs";

export const AGENTS_KIND = "agents";
const DEFINITION = "agent.json";
const PROMPT = "prompt.md";

/** Search order mirrors the other resource types: repo first, then user config, then plugin. */
export function agentDirs({ pluginRoot, consumer, home, extra = [] }) {
  const dirs = [...extra];
  if (consumer) dirs.push(...consumerResourceDirs(consumer, AGENTS_KIND));
  if (home) dirs.push(join(home, ".config", "agent-orchestration", AGENTS_KIND));
  if (pluginRoot) dirs.push(join(pluginRoot, AGENTS_KIND));
  return dirs;
}

/** The writable home for this repo's agents — always the current convention, never the legacy one. */
export function agentsRoot(consumer) {
  return consumerResourceDirs(consumer, AGENTS_KIND)[0];
}

/**
 * Every agent visible from `dirs`, nearest definition winning on duplicate ids.
 * The read is synchronous because `materializeSpec` — which resolves a spec's agent references —
 * is synchronous and so is every caller of it. A roster is a handful of small JSON files.
 */
export function listAgentsSync(dirs) {
  const seen = new Map();
  for (const dir of dirs) {
    let entries = [];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || seen.has(entry.name)) continue;
      const file = join(dir, entry.name, DEFINITION);
      let raw;
      try {
        raw = JSON.parse(readFileSync(file, "utf8"));
      } catch {
        continue;
      }
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
      seen.set(entry.name, { ...raw, id: raw.id || entry.name, _dir: join(dir, entry.name), _file: file });
    }
  }
  return [...seen.values()];
}

export async function listAgents(dirs) {
  return listAgentsSync(dirs);
}

/** Loose comparison for human-typed references: case and spacing around the comma do not matter. */
const humanKey = (value) => String(value || "").trim().replace(/\s+/g, " ").replace(/\s*,\s*/g, ", ").toLowerCase();

/**
 * Match a reference against a roster. A reference is the id (how machines address an agent), the
 * full name, or the "Full Name, Title" form the CLI itself prints. Ids match exactly because a
 * machine produced them; the two human forms match loosely because a person typed them — and the
 * displayed form has to be accepted, or the string every operator surface shows is not a string
 * they can paste back in.
 */
export function matchAgent(roster, ref) {
  const wanted = String(ref || "").trim();
  if (!wanted) return null;
  const byId = roster.find((a) => a.id === wanted);
  if (byId) return byId;
  const key = humanKey(wanted);
  return roster.find((a) => humanKey(a.full_name) === key || humanKey(displayName(a)) === key) || null;
}

/** Resolve a reference — id or full name — to a stored agent, or null. */
export async function resolveAgentRef(ref, dirs) {
  return matchAgent(await listAgents(dirs), ref);
}

/** The lead of a repo, or null. Exactly one is allowed; more than one is a store error. */
export async function findLead(dirs) {
  const leads = (await listAgents(dirs)).filter((a) => a.role === "lead");
  invariant(
    leads.length <= 1,
    "TOPOLOGY_MULTIPLE_LEADS",
    `A repo may declare one lead; found ${leads.length}: ${leads.map((a) => displayName(a)).join("; ")}. Demote all but one.`,
  );
  return leads[0] || null;
}

/**
 * Create an agent. The id is minted independently of the name; the name is checked against the
 * existing roster so no two agents in a repo share a display identity.
 */
export async function createAgent(consumer, spec = {}, dirs = null) {
  const role = String(spec.role || "worker");
  const searchDirs = dirs || [agentsRoot(consumer)];
  const existing = await listAgents(searchDirs);

  if (role === "lead") {
    const lead = existing.find((a) => a.role === "lead");
    invariant(
      !lead,
      "TOPOLOGY_LEAD_EXISTS",
      `This repo already has a lead: ${displayName(lead)}. A repo may declare one lead.`,
    );
  }

  const taken = new Set(existing.map((a) => a.full_name).filter(Boolean));
  const id = spec.id || mintId();
  invariant(!existing.some((a) => a.id === id), "TOPOLOGY_AGENT_EXISTS", `Agent id ${id} already exists.`);
  invariant(
    !spec.full_name || !taken.has(spec.full_name),
    "TOPOLOGY_AGENT_NAME_TAKEN",
    `This repo already has an agent named ${spec.full_name}. Two agents may not share a display identity — pick another name or let one be minted.`,
  );
  const named = spec.full_name
    ? {
        first_name: spec.first_name || String(spec.full_name).split(" ")[0] || "",
        last_name: spec.last_name || String(spec.full_name).split(" ").slice(1).join(" "),
        full_name: spec.full_name,
        title: spec.title || titleForRole(role),
      }
    : mintName(role, { taken });

  const agent = {
    id,
    ...named,
    role,
    coordinates_only: role === "lead" ? spec.coordinates_only !== false : spec.coordinates_only === true,
    reports_to: spec.reports_to ?? null,
    cli: spec.cli || "claude",
    candidates: spec.candidates,
    model: spec.model,
    skills: Array.isArray(spec.skills) ? spec.skills : [],
    mcp: Array.isArray(spec.mcp) ? spec.mcp : [],
    instructions: typeof spec.instructions === "string" ? spec.instructions : "",
    instructions_file: spec.instructions_file || PROMPT,
    args: Array.isArray(spec.args) ? spec.args : [],
    env: spec.env && typeof spec.env === "object" ? spec.env : {},
    auto_approve: spec.auto_approve === true,
    created_at: nowIso(),
  };

  const dir = join(agentsRoot(consumer), agentDirName(agent));
  await mkdir(dir, { recursive: true });
  await writeJson(join(dir, DEFINITION), agent);
  if (!(await exists(join(dir, PROMPT)))) {
    await writeFile(join(dir, PROMPT), spec.prompt || defaultPrompt(agent, consumer, dir), "utf8");
  }
  return { ...agent, _dir: dir, _file: join(dir, DEFINITION) };
}

/**
 * The prompt an agent is born with. It has to explain the cwd arrangement, because the agent's
 * working directory is its own identity directory while the work lives in the repo root — an agent
 * that does not know that will write its output into its own folder and look like it succeeded.
 */
export function defaultPrompt(agent, consumer, dir = join(agentsRoot(consumer), agentDirName(agent))) {
  return `# ${displayName(agent)}

You are **${agent.full_name}**, ${agent.title} on this project.

## Where you are, and where the work is

Your working directory is \`${dir}\` — your own agent directory. It is yours: notes, scratch files
and whatever memory your CLI keeps are scoped to it, and nothing you leave here collides with
another agent.

**Your working directory is NOT the project.** The project you work on is \`${consumer}\`, and you
have been granted access to it.

**Every path you use for project work must be absolute and begin with \`${consumer}/\`.** A relative
path — \`src/app.ts\`, \`./README.md\`, \`docs/\` — resolves against your own agent directory instead.
Written that way a file looks saved while being nowhere the project can see it; read that way an
existing file reports as missing. This is the one mistake that looks like success, so check the
paths in your own commands before you run them.

## Who you are

- Address: \`${agent.id}\` — machines and other agents use this. People never see it.
- Role: ${agent.role}
${agent.reports_to ? `- You report to: \`${agent.reports_to}\`\n` : ""}${
    agent.coordinates_only
      ? `
## You coordinate; you do not implement

You do not write project code yourself. You receive requests, decide who should handle them,
delegate, and report back. When work arrives that belongs to someone on your team, hand it to them
rather than doing it.
`
      : ""
  }`;
}

/** Load an agent by id, failing with a message a person can act on. */
export async function requireAgent(ref, dirs) {
  const agent = await resolveAgentRef(ref, dirs);
  if (!agent) fail("TOPOLOGY_AGENT_NOT_FOUND", `No agent matches ${JSON.stringify(ref)} in this repo.`);
  return agent;
}

export { displayName, addressOf };
