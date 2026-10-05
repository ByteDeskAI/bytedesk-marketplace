// Broadcast addressing. Four complete audiences, unioned by the comma that `--to` already means, so
// there is no new list semantics to learn and no intersection grammar — a grammar with scope state
// is the thing nobody can hold in their head.
//
//   @run          this run's roster, minus the sender, minus the orchestrator
//   @repo         the enrolled standing agents of the DESTINATION repository
//   @role:<role>  both scopes: run members with that run role, and repo agents with that repo role
//   @idle         whatever the census currently calls dispatchable
//
// An `@`-prefixed token is the ONLY new syntax. Every existing form — an agent id, a collective
// fan-out id, a "Full Name" — goes through the unchanged `expandFanout` path, byte for byte.
//
// Expansion happens at exactly one place: inside `sendMessage`, before the per-recipient loop.
// `forwardMessageToWorkflow` routes back through `sendMessage`, so a forwarding agent cannot bypass
// admission by control flow rather than by convention.
import { readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { invariant, readJson } from "./util.mjs";
import { expandFanout } from "./mailbox.mjs";

/**
 * `MAX_FANOUT = 8` prices tmux sessions and mailboxes — a fan-out child is a whole process. A
 * broadcast recipient is one inbox file plus one pointer. Different cost model, so a different
 * constant, rather than borrowing a number that was measured against a different thing.
 */
export const MAX_BROADCAST = 24;

/** The four audiences, spelled out, so a typo is refused rather than read as an agent id. */
const AUDIENCES = "@run, @repo, @role:<role>, @idle";

export function isAudience(token) {
  return typeof token === "string" && token.startsWith("@");
}

function parseAudience(token) {
  if (token === "@run" || token === "@repo" || token === "@idle") return { kind: token.slice(1), token };
  const role = /^@role:([A-Za-z][A-Za-z0-9_-]{0,39})$/.exec(token);
  if (role) return { kind: "role", role: role[1].toLowerCase(), token };
  return null;
}

/**
 * The repository directory, read in-process from `collectPresenceAgents` — the function, not the
 * published snapshot, so the frozen Presence v1 fixtures are untouched by this feature.
 *
 * It is a DIRECTORY, not an authority. Every candidate it names is still validated downstream by
 * `routeMessage` and by `known.has()`, so presence can only ever narrow the set it offers.
 */
async function directory(ctx) {
  if (ctx.cache.presence) return ctx.cache.presence;
  const collect = ctx.collectPresence
    ?? (async (options) => (await import("./presence.mjs")).collectPresenceAgents(options));
  ctx.cache.presence = (await collect({ consumer: ctx.consumer, env: ctx.env, home: ctx.home })) ?? [];
  return ctx.cache.presence;
}

/** Enrolled, and standing rather than a pane this run already owns — `@run` covers those. */
function standingEntry(entry) {
  return entry?.enrollment === "enrolled" && entry.session?.kind !== "run" && entry.session?.kind !== "spawn";
}

async function idleIds(ctx) {
  const read = ctx.census
    ?? (async (options) => (await import("./census.mjs")).readCensus(options));
  const document = await read({ consumer: ctx.consumer, env: ctx.env, home: ctx.home }).catch(() => null);
  // Refuse rather than degrade. A missing or stale census does not mean "everybody is free", and
  // broadcasting work into a busy room is worse than an error the operator can act on.
  invariant(
    document && !document.stale,
    "TOPOLOGY_CENSUS_UNAVAILABLE",
    document
      ? `The census for this repository is stale (${Math.round((document.ageMs ?? 0) / 1000)}s old), so nothing in it is dispatchable and @idle cannot name anyone. Start the repository supervisor and try again.`
      : "There is no census for this repository, so @idle cannot name anyone. Start the repository supervisor (`ao-topology supervise`) and try again.",
  );
  return (document.agents ?? []).filter((agent) => agent.dispatchable).map((agent) => agent.agentId);
}

async function resolveAudience(audience, ctx) {
  switch (audience.kind) {
    case "run":
      return ctx.run.agents.filter((agent) => agent.role !== "orchestrator").map((agent) => agent.id);
    case "repo":
      return (await directory(ctx)).filter(standingEntry).map((entry) => entry.agentId);
    case "role": {
      const inRun = ctx.run.agents
        .filter((agent) => String(agent.role || "").toLowerCase() === audience.role)
        .map((agent) => agent.id);
      const inRepo = (await directory(ctx))
        .filter((entry) => entry.enrollment === "enrolled"
          && (String(entry.repoRole || "").toLowerCase() === audience.role
            || String(entry.runRole || "").toLowerCase() === audience.role))
        .map((entry) => entry.agentId);
      return [...inRun, ...inRepo];
    }
    case "idle":
      return idleIds(ctx);
    default:
      return [];
  }
}

/**
 * Resolve `--to` into the concrete agents a message is actually written for.
 *
 * Returns `[{ id, delivery }]`, and the `delivery` tag is the load-bearing half. A standing lead or
 * reviewer is normally NOT in a run's `run.agents`, and `sendMessage` asserts `known.has(recipient)`
 * before writing into `agentDir(runDir, recipient)` — so a bare id list makes `@repo` throw
 * TOPOLOGY_UNKNOWN_AGENT for exactly the agents the feature exists to reach, and the "helpful" fix
 * is to drop them silently. Tagging each expansion `run` or `standing` instead lets the caller pick
 * the ENVELOPE PATH PER RECIPIENT: run members get an inbox file, standing agents get the durable
 * mailbox, which already skips the lead-readiness gate for same-repo mail while still running
 * `routeMessage`.
 */
export async function expandAddresses({
  run, to, from = null, external = false, consumer = null,
  env = process.env, home = homedir(), maxRecipients = MAX_BROADCAST,
  collectPresence = null, census = null,
} = {}) {
  const tokens = (Array.isArray(to) ? to : [to]).filter(Boolean).map(String);
  // The literal branch is `expandFanout`, unchanged and unwrapped, so every existing address form
  // produces byte-identical output and nothing that does not say `@` pays for this module at all.
  if (!tokens.some(isAudience)) return expandFanout(run, tokens).map((id) => ({ id, delivery: "run" }));

  // Admission is not widened here, it is repeated: expansion yields concrete ids BEFORE the caller's
  // external branch, so a broadcast is N ordinary sends each individually admitted through the
  // identical path. The one new invariant closes the whole interesting attack — an outsider
  // enumerating and reaching every standing agent, bypassing the lead that routing.mjs exists to be.
  // An outsider still reaches the lead exactly as it does today, by naming it.
  invariant(
    !external,
    "TOPOLOGY_BROADCAST_EXTERNAL",
    `A message from outside this repository cannot address ${tokens.filter(isAudience).join(", ")}. Send its lead one message and ask it to tell the room — that is what a front door is for.`,
  );

  const known = new Set(run.agents.map((agent) => agent.id));
  const ctx = { run, consumer, env, home, collectPresence, census, cache: {} };
  const order = [];
  const seen = new Set();
  const add = (id) => {
    if (!id || seen.has(id)) return;
    seen.add(id);
    order.push({ id, delivery: known.has(id) ? "run" : "standing" });
  };

  for (const token of tokens) {
    if (!isAudience(token)) {
      for (const id of expandFanout(run, [token])) {
        if (seen.has(id)) continue;
        seen.add(id);
        // A literal token keeps today's envelope path even when it names somebody outside the
        // roster, so `sendMessage` still refuses it with TOPOLOGY_UNKNOWN_AGENT exactly as before.
        order.push({ id, delivery: "run" });
      }
      continue;
    }
    const audience = parseAudience(token);
    invariant(audience, "TOPOLOGY_ADDRESS_UNKNOWN", `"${token}" is not an audience. The audiences are: ${AUDIENCES}.`);
    const resolved = (await resolveAudience(audience, ctx)).filter((id) => id && id !== from);
    // Refuse an audience that reaches nobody. A broadcast that silently went nowhere is the same
    // failure as a silently unreached recipient, which is the thing this layer exists to prevent.
    invariant(resolved.length > 0, "TOPOLOGY_BROADCAST_EMPTY", `${token} names nobody right now, so there is nothing to send. Check \`ao-topology census\` and the run roster.`);
    for (const id of resolved) add(id);
  }

  const limit = Number.isInteger(maxRecipients) && maxRecipients > 0 ? maxRecipients : MAX_BROADCAST;
  // Refuse, never truncate. A silently unreached recipient is exactly what this layer exists to
  // prevent, so the count and the limit are both named and the operator decides.
  invariant(
    order.length <= limit,
    "TOPOLOGY_BROADCAST_TOO_WIDE",
    `${tokens.join(", ")} resolves to ${order.length} recipients; the limit is ${limit}. Nothing was sent — address a smaller audience, or raise it with --max-recipients if this repository can carry it.`,
  );
  return order;
}

// ── Standing mail: a repository's lead, by path or slug (TM-271) ─────────────────────────────────

/**
 * Every repository this host knows: the services list (`repos.json`) and every lead registration.
 * A slug is the main checkout's directory name, so all linked worktrees of one repository share it.
 */
export async function registeredRepositories({ env = process.env, home = homedir() } = {}) {
  // Loaded on use, like the presence directory above: nothing that does not address a repository pays.
  const { readServiceRepos } = await import("./services-client.mjs");
  const { leadRegistryDir } = await import("./lead.mjs");
  const { repositoryConsumer } = await import("./repoid.mjs");
  const byKey = new Map();
  const add = (key, root) => { if (key && root && !byKey.has(key)) byKey.set(key, { key, root, slug: basename(root) }); };
  for (const repo of await readServiceRepos(env, home)) add(repo.key, await repositoryConsumer(repo.consumer).catch(() => repo.consumer));
  const dir = leadRegistryDir(env, home);
  for (const name of (await readdir(dir).catch(() => [])).filter((n) => /^[0-9a-f]{16}\.json$/.test(n))) {
    const id = (await readJson(join(dir, name)).catch(() => null))?.repo_id;
    if (typeof id === "string" && id) add(name.slice(0, -5), basename(id) === ".git" ? dirname(id) : id);
  }
  return [...byKey.values()];
}

/** `lead@<slug|path>` is shorthand for `--to-repo <slug|path>`. */
export function repoLeadRef(to) {
  const match = typeof to === "string" ? /^lead@(.+)$/.exec(to) : null;
  return match ? match[1] : null;
}

/**
 * Resolve a repository named by path or slug to its root and registered lead. Refuses an unknown or
 * ambiguous name and a repository with no lead: nothing is sent to a guess.
 */
export async function resolveRepoLead(ref, { env = process.env, home = homedir(), cwd = process.cwd() } = {}) {
  invariant(typeof ref === "string" && ref.trim(), "TOPOLOGY_REPO_REQUIRED", "Name the repository by path or slug (--to-repo <path|slug>).");
  const { repositoryConsumer, canonicalRepoId, repoKey } = await import("./repoid.mjs");
  const { readLeadRegistration } = await import("./lead.mjs");
  const known = await registeredRepositories({ env, home });
  let root;
  if (isAbsolute(ref) || ref.startsWith(".") || ref.includes("/")) {
    const path = resolve(cwd, ref);
    invariant(await stat(path).then((s) => s.isDirectory(), () => false), "TOPOLOGY_REPO_UNKNOWN", `${path} is not a directory, so it names no repository. Nothing was sent.`);
    root = await repositoryConsumer(path);
  } else {
    const matches = known.filter((repo) => repo.slug === ref || repo.key === ref);
    const names = known.map((repo) => repo.slug).sort().join(", ") || "none";
    invariant(matches.length > 0, "TOPOLOGY_REPO_UNKNOWN", `No registered repository is named "${ref}" (registered: ${names}). Pass its path instead. Nothing was sent.`);
    invariant(matches.length === 1, "TOPOLOGY_REPO_AMBIGUOUS", `"${ref}" names ${matches.length} registered repositories (${matches.map((repo) => repo.root).join(", ")}). Pass the path instead. Nothing was sent.`);
    root = matches[0].root;
  }
  const lead = (await readLeadRegistration({ consumer: root, env, home }).catch(() => null))?.record?.agent_id ?? null;
  invariant(lead, "TOPOLOGY_REPO_NO_LEAD", `${root} has no registered lead, so there is nobody to address. Start one with \`ao-topology lead ensure --consumer ${root}\`. Nothing was sent.`);
  return { consumer: root, lead, key: repoKey((await canonicalRepoId(root)).id) };
}

/** TM-372: the standing-mail broadcast audience — every registered repository's lead. */
export const ALL_LEADS = "@all-leads";

/**
 * Every registered repository's lead, one target per repository. Same rules as `expandAddresses`:
 * the sender is never its own recipient (the loop guard), an audience that reaches nobody is refused,
 * and one wider than the limit is refused, never truncated.
 */
async function allLeads({ from, env, home, maxRecipients }) {
  const { readLeadRegistration } = await import("./lead.mjs");
  const targets = [];
  for (const repo of await registeredRepositories({ env, home })) {
    // A deleted checkout keeps its registration; it has no inbox to reach, so it is not addressed.
    if (!(await stat(repo.root).then((s) => s.isDirectory(), () => false))) continue;
    const lead = (await readLeadRegistration({ consumer: repo.root, env, home }).catch(() => null))?.record?.agent_id ?? null;
    if (lead && lead !== from) targets.push({ consumer: repo.root, to: lead, key: repo.key });
  }
  invariant(targets.length > 0, "TOPOLOGY_BROADCAST_EMPTY", `${ALL_LEADS} names nobody right now: no registered repository has a lead other than the sender. Nothing was sent.`);
  const limit = Number.isInteger(maxRecipients) && maxRecipients > 0 ? maxRecipients : MAX_BROADCAST;
  invariant(
    targets.length <= limit,
    "TOPOLOGY_BROADCAST_TOO_WIDE",
    `${ALL_LEADS} resolves to ${targets.length} recipients; the limit is ${limit}. Nothing was sent — address the leads you need by --to-repo, or raise it with --max-recipients.`,
  );
  return targets;
}

/**
 * The ONE standing-mail resolver every send entry shares. Returns `[{ consumer, to, key? }]`:
 * the literal recipient in `consumer` (unchanged), a repository's lead (`--to-repo`, `lead@<repo>`),
 * or every registered repository's lead (`@all-leads`). Every refusal happens here, before any send.
 */
export async function resolveStandingTargets({ to, toRepo = null, consumer, from = null, env = process.env, home = homedir(), cwd = process.cwd(), maxRecipients = MAX_BROADCAST } = {}) {
  if (to === ALL_LEADS) {
    invariant(!toRepo, "TOPOLOGY_ADDRESS_CONFLICT", `Pass --to-repo or --to ${ALL_LEADS}, not both.`);
    return allLeads({ from, env, home, maxRecipients });
  }
  const ref = toRepo ?? repoLeadRef(to);
  if (ref !== null) {
    invariant(!toRepo || !to, "TOPOLOGY_ADDRESS_CONFLICT", "Pass --to-repo or --to, not both: --to-repo already names the recipient (that repository's lead).");
    const target = await resolveRepoLead(ref, { env, home, cwd });
    return [{ consumer: target.consumer, to: target.lead, key: target.key }];
  }
  return [{ consumer, to }];
}
