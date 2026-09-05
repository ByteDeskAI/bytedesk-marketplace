/**
 * The topology backend: launch a one-agent orchestration in the sibling
 * agent-orchestration plugin's tmux layer, INSIDE the worktree tm already made.
 *
 * This is the backend ADR-0001 (agent-orchestration/docs/adr/0001-authoritative-
 * orchestration-layer.md) makes the default. What it buys over the raw `tmux`
 * backend is everything the topology layer already has and a bare `claude -p`
 * pane does not: an identity from the repo's agent library, a file mailbox and
 * journal, a bootstrap briefing, and a provider failover chain.
 *
 * Rules this module never breaks:
 *   1. **tm owns the checkout.** `--consumer <req.worktree>` — the checkout
 *      dispatch provisioned — and the spec leaves `cwd` at its default of
 *      `{{consumer}}`. The topology layer takes a working directory; it never
 *      derives one. That is the ADR's whole worktree-ownership rule: ONE
 *      worktree per task, no second checkout anywhere.
 *   2. argv-only, `shell: false`. The prompt is a task's handoff — arbitrary
 *      markdown that can contain backticks, `$()` and quotes — and it travels
 *      exactly one way: as the `instructions` string inside the JSON spec FILE
 *      whose path is the argv element. Never an argv element itself, never
 *      shell source.
 *   3. The prompt ALSO lands in the worktree at tmux's `PROMPT_FILE`, for the
 *      same reason the tmux backend puts it there: the spec file is a temp file
 *      that vanishes, and a human (or a resumed session) needs to read exactly
 *      what the worker was told. One filename across both backends, and
 *      `createWorktree` gitignores it before any backend can dirty the checkout.
 *   4. Bounded: the launch waits for the agent's pane to come up (the provider
 *      adapters allow ~30s per agent), so the child gets an explicit timeout and
 *      a capped buffer. A launch that overruns is a refusal, not a hang.
 *
 * The run handle is `topology:<tmux session>` — paste-able into `tmux attach -t`,
 * and what ./collect.mjs reads liveness from.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { detectHostCaps } from "../hostcaps.mjs";
import { config } from "../store.mjs";
import { PROMPT_FILE } from "./tmux.mjs";

export const name = "topology";

/** The launch waits for panes to report ready; this bounds the whole thing. */
export const LAUNCH_TIMEOUT_MS = 180_000;
/** `--json` prints one run object; a launcher that floods stdout must not grow our heap. */
export const MAX_BUFFER_BYTES = 4 * 1024 * 1024;

/** Where the durable copy of the prompt lives, relative to the worktree root. */
export { PROMPT_FILE };

/**
 * Where a repo keeps its agent library, relative to the consumer. Current
 * convention first, the layer's own legacy path second — the same two the
 * topology layer's `consumerResourceDirs` searches, so a repo mid-migration
 * resolves identically here and there.
 */
export const AGENT_DIRS = [join(".bytedesk", "agent-orchestration", "agents"), join(".orchestration", "agents")];

/** Available exactly when hostcaps found ao-topology AND tmux to run it in. */
export function available(caps = null) {
  const report = caps ?? detectHostCaps();
  return Boolean(report?.backends?.topology?.available);
}

/**
 * The repo's agent roster, read as JSON off disk.
 *
 * Deliberately NOT an import of the topology layer's own `agents.mjs`: that is a
 * sibling plugin, resolved at runtime from a path hostcaps probed, and importing
 * across that boundary would make dispatch fail to load whenever the sibling
 * moves. The on-disk shape (`<dir>/<id>/agent.json`) is the contract; a
 * malformed definition is simply not in the roster.
 */
export function roster(consumer, { readdirImpl = readdirSync, readImpl = readFileSync } = {}) {
  const found = [];
  const seen = new Set();
  for (const kind of AGENT_DIRS) {
    let entries = [];
    try {
      entries = readdirImpl(join(consumer, kind), { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || seen.has(entry.name)) continue;
      try {
        const raw = JSON.parse(readImpl(join(consumer, kind, entry.name, "agent.json"), "utf8"));
        if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
        seen.add(entry.name);
        found.push({ ...raw, id: raw.id || entry.name });
      } catch {
        /* an unreadable definition is not a roster entry */
      }
    }
  }
  return found;
}

/**
 * Which stored agent a dispatch borrows its identity from, as a reference the
 * topology layer resolves (`agents[].agent` takes an id or a full name).
 *
 * `dispatch.topologyAgent` pins one. Otherwise the first non-lead agent: a repo
 * has exactly one lead and it is the human-facing one, so spending it on a
 * dispatched worker is the wrong default. No roster, or a roster that is only a
 * lead, returns null and the spec goes inline.
 */
export function agentRef(consumer, { p, list = null } = {}) {
  const wanted = p ? config(p).dispatch?.topologyAgent : null;
  const agents = list ?? roster(consumer);
  if (wanted) {
    const hit = agents.find((a) => a.id === wanted || a.full_name === wanted);
    return hit ? hit.id : null;
  }
  return agents.find((a) => a.role !== "lead")?.id ?? null;
}

/**
 * The orchestration spec, as a pure value. Keeping it side-effect-free is what
 * lets a test prove the shape — one agent, no cwd of its own, the prompt as
 * DATA — without a launcher.
 *
 * The single agent's role is `orchestrator` because the spec schema requires
 * exactly one, and a solo worker conducts itself. When `ref` names a stored
 * agent the entry inherits that agent's cli chain, skills, mcp servers and
 * system prompt; the handoff is appended to it as `instructions` rather than
 * replacing it, so the identity survives.
 */
export function specFor(req, ref = null, { candidates = null } = {}) {
  const agent = ref
    ? { id: "worker", agent: ref, role: "orchestrator", instructions: req.prompt }
    : { id: "worker", role: "orchestrator", candidates: candidates || "claude", instructions: req.prompt };
  return {
    version: 1,
    name: String(req.task.id).toLowerCase(),
    description: `tm dispatch of ${req.task.id}${req.task.title ? `: ${req.task.title}` : ""}`,
    agents: [agent],
  };
}

/** The exact ao-topology argv, as a pure value. The prompt is in the spec FILE, never here. */
export function argvFor(req, specFile) {
  return ["launch", "--spec", specFile, "--consumer", req.worktree, "--json"];
}

/** The child's environment: the ambient one plus the tm identity of the dispatching session. */
export function envFor(req, base = process.env) {
  const env = { ...base };
  for (const [k, v] of [
    ["TM_SESSION_ID", req.session],
    ["TM_ACTOR", req.actor],
    ["TM_ROOT", req.p?.root],
  ]) {
    if (v) env[k] = v;
  }
  return env;
}

/** Where the spec file lives; per-spawn so two dispatches never share one. */
export function specFileFor(req, mkdtempImpl = mkdtempSync) {
  return join(mkdtempImpl(join(tmpdir(), `tm-topology-${req.task.id}-`)), "spec.json");
}

/** `--json` stdout → the run. Anything unparseable is a refusal that quotes what came back. */
function parseLaunch(stdout) {
  try {
    const run = JSON.parse(String(stdout || ""));
    if (run && typeof run.session === "string" && run.session) return { run };
  } catch {
    /* fall through */
  }
  const tail = String(stdout || "").trim().slice(-300);
  return { reason: `ao-topology launch printed no run JSON${tail ? `: ${tail}` : ""}` };
}

/**
 * Launch the worker. req = { task, worktree, prompt, session, actor, p }.
 * Injectables (caps/spawnImpl/writeImpl/mkdtempImpl/env/rosterList) exist for tests;
 * production takes the probed hostcaps and the real child_process.spawnSync.
 */
export function spawn(
  req,
  {
    caps = null,
    spawnImpl = spawnSync,
    writeImpl = writeFileSync,
    mkdtempImpl = mkdtempSync,
    env = process.env,
    rosterList = null,
    timeoutMs = LAUNCH_TIMEOUT_MS,
    maxBuffer = MAX_BUFFER_BYTES,
  } = {},
) {
  const report = caps ?? detectHostCaps();
  const entry = report?.backends?.topology;
  if (!entry?.available || !entry.path) {
    return { ok: false, reason: entry?.reason ?? "topology backend is not available on this host" };
  }
  // The consumer is the contract with the topology layer: it contains every path a
  // spec may resolve, so a relative one would contain the run against the wrong tree.
  if (!isAbsolute(String(req.worktree ?? ""))) {
    return { ok: false, reason: `--consumer must be an absolute path; got worktree: ${req.worktree}` };
  }

  const promptFile = join(req.worktree, PROMPT_FILE);
  writeImpl(promptFile, req.prompt);

  const ref = agentRef(req.worktree, { p: req.p, list: rosterList });
  const specFile = specFileFor(req, mkdtempImpl);
  const spec = specFor(req, ref, { candidates: config(req.p).dispatch?.topologyCandidates ?? null });
  writeImpl(specFile, `${JSON.stringify(spec, null, 2)}\n`);

  const args = argvFor(req, specFile);
  const res = spawnImpl(entry.path, args, {
    shell: false,
    env: envFor(req, env),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: timeoutMs,
    maxBuffer,
  });
  if (res?.error) return { ok: false, reason: `ao-topology failed to start: ${res.error.message}`, detail: { args } };
  if (res?.status !== 0) {
    return { ok: false, reason: `ao-topology launch exited ${res?.status ?? "?"}: ${String(res?.stderr || "").trim()}`, detail: { args } };
  }

  const parsed = parseLaunch(res.stdout);
  if (!parsed.run) return { ok: false, reason: parsed.reason, detail: { args } };
  return {
    ok: true,
    // The tmux session is the handle: `tmux attach -t <session>` is how a human looks in,
    // and ./collect.mjs reads the worker's liveness from exactly that session.
    run: `topology:${parsed.run.session}`,
    detail: {
      args,
      promptFile,
      specFile,
      agent: ref,
      runDir: parsed.run.runDir ?? null,
      warnings: parsed.run.warnings ?? [],
    },
  };
}
