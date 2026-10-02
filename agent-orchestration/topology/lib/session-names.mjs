// tmux session names and session identity (TM-274, ADR-0030).
//
// A session is named `[team--]node--repo--role--persona`, for example
// `core--agents1--bytedesk-marketplace--lead--ada` or `agents1--bytedesk-marketplace--reviewer--linus`.
// Segments are slugged to [a-z0-9-] with no `--` inside, so `--` is only ever the separator.
//
// A session that holds a team run is `[team--]node--repo--<workflow>--<persona>`: the workflow is the
// role segment, and the persona is allocated per run from the same registry, so two concurrent runs of
// one workflow get two names.
//
// The name is a LABEL, never a key. Every session gets a ULID and records who it is — `@ao-id`,
// `@ao-agent`, `@ao-role`, `@ao-repo`, `@ao-repo-origin`, `@ao-node`, `@ao-team`, `@ao-run`,
// `@ao-workflow`, `@ao-kind` — as tmux
// session user options, mirrored into the durable records, and every reader resolves identity from
// that. There is no numeric collision suffix: one live session per agent, distinct agents for
// parallel work, and personas unique per scope (persona-registry.mjs) make names unique by design.
//
// Legacy names stay recognised until those sessions end: a role-session `ao-<id>` (id minted by
// identity.mjs mintId) and a spawn `<id>-<7 hex>`, parsed exactly as the old parseSessionName did.
import { randomBytes } from "node:crypto";
import { hostname as osHostname, homedir } from "node:os";
import { basename } from "node:path";
import { globalConfigPath } from "./config.mjs";
import { repositoryConsumer } from "./repoid.mjs";
import { readJson, run } from "./util.mjs";

export const SEPARATOR = "--";
/** Per-segment caps, so a long folder or name cannot push the role out of sight. */
export const PART_CAPS = Object.freeze({ team: 16, node: 24, repo: 32, role: 16, persona: 24 });

/**
 * One segment in tmux-safe form: lowercase, every other run of characters becomes ONE `-` (so `--`
 * cannot appear inside a segment), trimmed, capped. tmux rewrites `.` and refuses `:`; spaces and
 * parentheses come from folders like "bytedesk-marketplace (copy)".
 */
export function slugPart(value, cap) {
  return String(value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")
    .slice(0, cap).replace(/-+$/, "");
}

/** The short hostname: everything before the first `.`. */
export function shortHost(name = osHostname()) {
  return slugPart(String(name ?? "").split(".")[0], PART_CAPS.node) || "host";
}

/**
 * This node's name, which is also its NATS leaf-node name: `AO_NODE_NAME`, else `node.name` in the
 * ao user config ($XDG_CONFIG_HOME/agent-orchestration/config.json), else the short hostname.
 */
export async function nodeName({ env = process.env, home = homedir(), hostname = osHostname() } = {}) {
  const configured = env.AO_NODE_NAME
    || (await readJson(globalConfigPath(home, env)).catch(() => null))?.node?.name;
  return slugPart(configured, PART_CAPS.node) || shortHost(hostname);
}

/** `owner/repo` (or `repo`) from a git remote URL in any of its usual forms. */
export function originPath(url) {
  const path = String(url ?? "").trim().replace(/\/+$/, "").replace(/\.git$/, "")
    .replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]+\//i, "").replace(/^[^@/]+@[^:/]+:/, "");
  return path.split("/").filter(Boolean).slice(-2).join("/") || null;
}

/**
 * The repository a consumer belongs to: `{ slug, origin }`. `slug` is the `origin` remote's
 * repository name (owner stripped); `origin` keeps `owner/repo`. With no remote, the main checkout's
 * folder name and its path. A linked worktree resolves to its repository either way.
 */
export async function repoIdentity(consumer) {
  const main = await repositoryConsumer(consumer);
  const remote = await run("git", ["-C", main, "remote", "get-url", "origin"], { allowFailure: true, timeoutMs: 10_000 })
    .catch(() => ({ code: 1, stdout: "" }));
  const origin = remote.code === 0 ? originPath(remote.stdout) : null;
  if (origin) return { slug: slugPart(origin.split("/").pop(), PART_CAPS.repo) || "repo", origin };
  return { slug: slugPart(basename(main), PART_CAPS.repo) || "repo", origin: main };
}

/** `[team--]node--repo--role--persona`. Pure; the caller supplies an allocated persona. */
export function composeSessionName({ team = null, node, repo, role, persona }) {
  const parts = [
    slugPart(team, PART_CAPS.team),
    slugPart(node, PART_CAPS.node) || "host",
    slugPart(repo, PART_CAPS.repo) || "repo",
    slugPart(role, PART_CAPS.role) || "agent",
    slugPart(persona, PART_CAPS.persona) || "agent",
  ];
  return (parts[0] ? parts : parts.slice(1)).join(SEPARATOR);
}

/**
 * The persona candidates for a holder, in order: its own `candidates` when it brings them (a run
 * draws from the first-name pool), else first name, then first-last (ADR-0030).
 */
export function personaCandidates(agent) {
  if (Array.isArray(agent?.candidates)) return [...new Set(agent.candidates.map((value) => slugPart(value, PART_CAPS.persona)).filter(Boolean))];
  const words = String(agent?.full_name ?? "").trim().split(/\s+/).filter(Boolean);
  const first = agent?.first_name || words[0] || "";
  const last = agent?.last_name || words.slice(1).join(" ");
  return [...new Set([first, first && last ? `${first} ${last}` : ""]
    .map((value) => slugPart(value, PART_CAPS.persona)).filter(Boolean))];
}

// -- ULID --------------------------------------------------------------------------------------------

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
export const ULID_PATTERN = /^[0-9A-HJKMNP-TV-Z]{26}$/;

/** A ULID: 48-bit millisecond time + 80 random bits, Crockford base32, 26 characters, sortable. */
export function ulid(now = Date.now(), rand = randomBytes) {
  let time = "";
  for (let t = Math.floor(now), i = 0; i < 10; i += 1, t = Math.floor(t / 32)) time = CROCKFORD[t % 32] + time;
  let bits = 0n;
  for (const byte of rand(10)) bits = (bits << 8n) | BigInt(byte);
  let random = "";
  for (let i = 0; i < 16; i += 1, bits >>= 5n) random = CROCKFORD[Number(bits & 31n)] + random;
  return time + random;
}

// -- Metadata ----------------------------------------------------------------------------------------

/** The tmux user options that carry identity. Keys are what readers get back. */
export const SESSION_OPTIONS = Object.freeze({
  id: "@ao-id",
  agent: "@ao-agent",
  role: "@ao-role",
  repo: "@ao-repo",
  repoOrigin: "@ao-repo-origin",
  node: "@ao-node",
  team: "@ao-team",
  run: "@ao-run",
  workflow: "@ao-workflow",
  kind: "@ao-kind",
});
const KEYS = Object.keys(SESSION_OPTIONS);

/** A tmux `-F` fragment listing every identity option, tab-separated, in KEYS order. */
export const IDENTITY_FORMAT = KEYS.map((key) => `#{${SESSION_OPTIONS[key]}}`).join("\t");

/** Inverse of IDENTITY_FORMAT: tab fields → `{ id, agent, … }`, empty fields dropped. */
export function parseIdentityFields(fields) {
  const meta = {};
  KEYS.forEach((key, index) => { if (fields?.[index]) meta[key] = fields[index]; });
  return meta;
}

const LEGACY_ROLE = /^ao-([a-f][0-9a-f]{7})$/;
const LEGACY_SPAWN = /^(.+)-([0-9a-f]{7})$/;

/**
 * Who a session (or a pane in it) belongs to: recorded metadata first, then the two legacy shapes.
 * Returns `{ agentId, sessionId, role, repo, repoOrigin, node, team, runId, spawn, kind, source }`
 * or `null`. A session named anything at all is identified when it carries `@ao-agent`; an
 * `ao-`-looking name without metadata and not legacy-shaped is not. `kind` is `role-session`,
 * `spawn` (one agent's run session) or `run` (a pane in a team session).
 */
export function sessionIdentity({ name, meta = {} } = {}) {
  if (meta.agent) {
    const kind = ["role-session", "spawn", "run"].includes(meta.kind) ? meta.kind : meta.run ? "spawn" : "role-session";
    return { agentId: meta.agent, sessionId: meta.id ?? null, role: meta.role ?? null, repo: meta.repo ?? null, repoOrigin: meta.repoOrigin ?? null,
      node: meta.node ?? null, team: meta.team ?? null, runId: meta.run ?? null, workflow: meta.workflow ?? null, spawn: kind === "spawn" ? meta.id ?? null : null, kind, source: "metadata" };
  }
  const base = { sessionId: null, role: null, repo: null, repoOrigin: null, node: null, team: null, runId: null, workflow: null, source: "legacy" };
  let match = LEGACY_ROLE.exec(String(name ?? ""));
  if (match) return { ...base, agentId: match[1], spawn: null, kind: "role-session" };
  match = LEGACY_SPAWN.exec(String(name ?? ""));
  if (match) return { ...base, agentId: match[1], spawn: match[2], kind: "spawn" };
  return null;
}

/** The legacy durable role-session name, `ao-<id>`, still reattached to until it ends. */
export function legacyRoleSessionName(agentId) {
  return `ao-${agentId}`;
}
