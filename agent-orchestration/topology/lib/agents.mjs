// The per-repo agent library. Agents are a first-class resource type alongside templates, skills,
// roles and providers: one directory per agent under `.bytedesk/agent-orchestration/agents/<id>/`,
// holding the definition, the file-backed system prompt, and the agent's own working directory.
//
// The directory doubles as the agent's cwd at spawn time. That is deliberate — Claude Code keys its
// memory by working directory, so a per-agent cwd gives each agent its own memory without inventing
// a memory layer. The real work tree is reached with --add-dir and explained in the prompt.
import { readdirSync, readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { isAbsolute, join, dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PROMPT_MODES } from "./config.mjs";
import { refreshPrompt } from "./prompt-lifecycle.mjs";
import { consumerResourceDirs, exists, fail, invariant, nowIso, writeJson } from "./util.mjs";
import { addressOf, agentDirName, displayName, mintId, mintName, titleForRole } from "./identity.mjs";
import { orchName, subjectTakenBy } from "./orch-transport.mjs";
import { safeGitText } from "./safe-git.mjs";

function libraryConsumer(consumer) {
  try {
    const paths = safeGitText(consumer, ['worktree', 'list', '--porcelain'], { raw: true });
    const first = paths.split('\n').find(line => line.startsWith('worktree '));
    return first ? first.slice(9) : consumer;
  } catch { return consumer; }
}
export const AGENTS_KIND = "agents";
const DEFINITION = "agent.json";
const PROMPT = "prompt.md";

/** Search order mirrors the other resource types: repo first, then user config, then plugin. */
export function agentDirs({ pluginRoot, consumer, home, extra = [] }) {
  const dirs = [...extra];
  if (consumer) dirs.push(...consumerResourceDirs(libraryConsumer(consumer), AGENTS_KIND), ...consumerResourceDirs(consumer, AGENTS_KIND));
  if (home) dirs.push(join(home, ".config", "agent-orchestration", AGENTS_KIND));
  if (pluginRoot) dirs.push(join(pluginRoot, AGENTS_KIND));
  return [...new Set(dirs)];
}

/** The writable home for this repo's agents — always the current convention, never the legacy one. */
export function agentsRoot(consumer) {
  return consumerResourceDirs(libraryConsumer(consumer), AGENTS_KIND)[0];
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
export async function createAgent(consumer, spec = {}, dirs = null, context = {}) {
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
  // TM-487: NATS subjects carry orchName(id), which is not injective (`a.b` and `a_b` both become
  // `a_b`), so two such agents would share one inbox and dead-letter each other's mail. Refused here,
  // at the one place agents are registered, rather than re-encoding subjects existing inboxes use.
  const clash = subjectTakenBy(id, existing.map((a) => a.id));
  invariant(!clash, "TOPOLOGY_AGENT_SUBJECT_TAKEN", `Agent id ${id} maps to the mailbox subject token "${orchName(id)}", which agent ${clash} already uses; pick an id that differs after non [A-Za-z0-9_-] characters become "_" (and past the first 64 characters).`);
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
    // Template provenance: which named template this instance was minted from. The instance gets
    // a fresh identity regardless — the template shapes it, it never shares one.
    template: spec.template || null,
    coordinates_only: ['lead', 'observer'].includes(role) ? spec.coordinates_only !== false : spec.coordinates_only === true,
    own_state_only: role === 'observer',
    reports_to: spec.reports_to ?? null,
    cli: spec.cli || "claude",
    candidates: spec.candidates,
    model: spec.model,
    skills: Array.isArray(spec.skills) ? spec.skills : [],
    mcp: Array.isArray(spec.mcp) ? spec.mcp : [],
    instructions: [spec.instructions, spec.prompt].filter(value => typeof value === "string" && value.trim()).join("\n\n"),
    instructions_file: spec.instructions_file || PROMPT,
    args: Array.isArray(spec.args) ? spec.args : [],
    env: spec.env && typeof spec.env === "object" ? spec.env : {},
    // TM-214: absent means on; explicit false opts out. A reviewer is never auto-approved (TM-150):
    // its stored definition must say false, so no path that reads agent.json can launch it unprompted.
    auto_approve: role === 'reviewer' ? false : spec.auto_approve !== false,
    created_at: nowIso(),
  };

  const dir = join(agentsRoot(consumer), agentDirName(agent));
  await mkdir(dir, { recursive: true });
  await writeJson(join(dir, DEFINITION), agent);
  if (!(await exists(join(dir, PROMPT)))) {
    await writeFile(join(dir, PROMPT), spec.prompt || defaultPrompt(agent, consumer, dir), "utf8");
  }
  const enriched = { ...agent, _dir: dir, _file: join(dir, DEFINITION) };
  const state = await refreshPrompt({ agent: enriched, consumer, pluginRoot: dirname(dirname(dirname(fileURLToPath(import.meta.url)))), ...context });
  invariant(state.status !== "invalid-config", "TOPOLOGY_PROMPT_INVALID", "Cannot create agent with invalid prompt configuration.", { errors: state.errors });
  return enriched;
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

/**
 * TM-296. Set an agent's own instructions in its agent.json: `text` inline, or `file` (a Markdown
 * path) as its instructions file. agent.json is tracked, so the file is stored RELATIVE to the agent
 * directory and must sit inside the agent directory or `repo`; a path outside the repository would
 * name a file other hosts and worktrees do not have. They REPLACE the agent's previous own instructions;
 * `mode` says whether they compose after the template (append) or in place of it (replace). The
 * stored shape stays a string plus `instructions_mode`, which every existing reader understands.
 * The running agent picks the change up through the ordinary prompt refresh / restart-required flow.
 */
export async function setAgentInstructions(agent, { file = null, text = null, mode = "append", repo = null } = {}) {
  invariant((file === null) !== (text === null), "TOPOLOGY_INSTRUCTIONS_SOURCE", "Pass exactly one of --file <md> or --text <s>.");
  invariant(PROMPT_MODES.includes(mode), "TOPOLOGY_INSTRUCTIONS_MODE", 'Use --mode append or --mode replace.');
  invariant(text === null || text.trim(), "TOPOLOGY_INSTRUCTIONS_SOURCE", "--text must not be empty.");
  let storedFile = PROMPT;
  if (file !== null) {
    invariant(await exists(file), "TOPOLOGY_INSTRUCTIONS_FILE_NOT_FOUND", `No instructions file at ${file}.`);
    const inside = (root) => { const rel = relative(resolve(root), resolve(file)); return rel && !rel.startsWith("..") && !isAbsolute(rel); };
    invariant(inside(agent._dir) || (repo && inside(repo)), "TOPOLOGY_INSTRUCTIONS_FILE_OUTSIDE_REPO",
      `${file} is outside the repository${repo ? ` (${repo})` : ""}; agent.json is tracked, so other hosts would not have it. Move the file into the repository, or pass --text.`);
    storedFile = relative(agent._dir, resolve(file));
  }
  const stored = JSON.parse(await readFile(agent._file, "utf8"));
  const next = { ...stored, instructions: text ?? "", instructions_file: storedFile, instructions_mode: mode };
  await writeJson(agent._file, next);
  return { ...next, _dir: agent._dir, _file: agent._file };
}

/** Load an agent by id, failing with a message a person can act on. */
export async function requireAgent(ref, dirs) {
  const agent = await resolveAgentRef(ref, dirs);
  if (!agent) fail("TOPOLOGY_AGENT_NOT_FOUND", `No agent matches ${JSON.stringify(ref)} in this repo.`);
  return agent;
}

export { displayName, addressOf };
