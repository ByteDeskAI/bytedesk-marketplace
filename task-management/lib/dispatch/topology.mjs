/**
 * The topology backend: launch a one-agent orchestration in the sibling
 * agent-orchestration plugin's tmux layer, INSIDE the worktree tm already made.
 *
 * This is the backend ADR-0001 (agent-orchestration/docs/adr/0001-authoritative-
 * orchestration-layer.md) makes the default. What it buys over the raw `tmux`
 * backend is everything the topology layer already has and a bare `claude -p`
 * pane does not: a file mailbox and journal, a bootstrap briefing, and a
 * provider failover chain.
 *
 * TM-467: the worker is always an INLINE agent. It used to borrow an identity
 * from the repo's agent library (`.bytedesk/agent-orchestration/agents/`), and a
 * library agent carries its own cli, args, env, mcp servers and cwd — all
 * git-tracked, so a worker whose PR merged chose the command every later worker
 * ran. What the pane runs now comes from agent-orchestration's provider adapters
 * and the candidate chain in the user's own config (trustedDispatch), never from
 * the repository.
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
import { toolFailureReason } from "./backend.mjs";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, isAbsolute, join } from "node:path";
import { detectHostCaps } from "../hostcaps.mjs";
import { config } from "../store.mjs";
import { GUARD_HOOK, PROMPT_FILE, passEnvNames, trustedDispatch, workerBranch, workerEnv, workerIdentityEnv } from "./tmux.mjs";

/**
 * TM-449: what this dispatch's passEnv config will NOT reach the worker, as warnings. ao-topology
 * passes only the names in agent-orchestration's own global `workers.passEnv`; it has no channel
 * for tm's `dispatch.passEnv`, and the spec's agent env is written into the launcher script, so a
 * value must never travel there. A tm-only name is reported here rather than silently dropped.
 */
export function topologyPassEnvWarnings(req) {
  const plan = passEnvNames(req);
  const tmOnly = plan.names.filter((n) => !plan.viaAo.includes(n));
  return [
    ...plan.warnings,
    ...(tmOnly.length ? [`passEnv ${tmOnly.join(", ")} not passed by the topology backend: ao-topology passes only agent-orchestration's global workers.passEnv; name it there, or dispatch with --backend tmux`] : []),
  ];
}

export const name = "topology";

/** The launch waits for panes to report ready; this bounds the whole thing. */
export const LAUNCH_TIMEOUT_MS = 180_000;
/** `--json` prints one run object; a launcher that floods stdout must not grow our heap. */
export const MAX_BUFFER_BYTES = 4 * 1024 * 1024;

/** Where the durable copy of the prompt lives, relative to the worktree root. */
export { PROMPT_FILE };

/** Available exactly when hostcaps found ao-topology AND tmux to run it in. */
export function available(caps = null) {
  const report = caps ?? detectHostCaps();
  return Boolean(report?.backends?.topology?.available);
}

/**
 * The orchestration spec, as a pure value. Keeping it side-effect-free is what
 * lets a test prove the shape — one agent, no cwd of its own, the prompt as
 * DATA — without a launcher.
 *
 * The single agent's role is `orchestrator` because the spec schema requires
 * exactly one, and a solo worker conducts itself. TM-467: always inline — no
 * `agent` reference, so nothing from the repo's version-controlled agent library
 * (cli, args, env, mcp, cwd, template) is merged into what the pane runs.
 */
export function specFor(req, { candidates = null } = {}) {
  const base = { id: "worker", role: "orchestrator", candidates: candidates || "claude,codex", instructions: req.prompt };
  // TM-177: the pane exports ONLY the spec agent's env — ao-topology writes it into the launcher
  // script — so the worker marker travels here, not just in ao-topology's own env.
  //
  // The dispatch identity rides here for the same reason, and its absence was the same bug the
  // marker had: envFor() puts it on the ao-topology LAUNCHER, and the pane inherits none of the
  // launcher's environment. What that cost, before this:
  //   TM_SESSION_ID  first in SESSION_ENV, so it outranks the pane's own harness id. Without it the
  //                  worker did not match the claim the dispatch took out FOR it and stole it
  //                  instead — `claim` under the dispatcher, then `claim_stolen` under a raw
  //                  harness id, is what the event log of a topology dispatch actually shows.
  //   TM_ACTOR       the most reliable actor signal, so without it every worker's events read `main`.
  //   TM_ROOT        the store the task is in; without it `tm` walks up from cwd to whatever store
  //                  sits above the worker, and the guard cannot confirm which task it holds.
  // The tmux backend has always passed all three into the pane; this is the parity that was missing.
  const agent = {
    ...base,
    env: {
      ...Object.fromEntries(workerIdentityEnv(req)),
      ...Object.fromEntries(workerEnv(req)),
    },
  };
  // The producer applies worker_guard separately for each provider candidate.
  return {
    version: 1,
    name: String(req.task.id).toLowerCase(),
    description: `tm dispatch of ${req.task.id}${req.task.title ? `: ${req.task.title}` : ""}`,
    task_id: req.task.id,
    write_authority: { task_id: req.task.id, branch: workerBranch(req), worktree: req.worktree, owner: req.session },
    worker_guard: { task_id: req.task.id, branch: workerBranch(req), hook: GUARD_HOOK },
    agents: [agent],
  };
}

/** The cli ids of an agent's fallback chain, from `candidates` (array or comma string) or `cli`. */
function cliChain(entry) {
  const raw = entry?.candidates ?? entry?.cli;
  const list = Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split(",") : [];
  return list.map((c) => String(c?.cli ?? c).split(":")[0].trim()).filter(Boolean);
}

/** The exact ao-topology argv, as a pure value. The prompt is in the spec FILE, never here. */
export function argvFor(req, specFile) {
  return ["launch", "--spec", specFile, "--consumer", req.worktree, "--json"];
}

/** The child's environment: the ambient one plus the tm identity of the dispatching session. */
export function envFor(req, base = process.env) {
  const env = { ...base };
  for (const [k, v] of workerIdentityEnv(req)) env[k] = v;
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
 * Injectables (caps/spawnImpl/writeImpl/mkdtempImpl/env) exist for tests;
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

  const worker = { ...req, branch: workerBranch(req) };
  // TM-467: the candidate chain picks the CLI and model, so it comes from the user's config only.
  const cfg = config(req.p);
  const chain = trustedDispatch("topologyCandidates", cfg);
  const commandWarnings = [
    ...(chain.warning ? [chain.warning] : []),
    ...(cfg.dispatch?.topologyAgent !== undefined ? ["dispatch.topologyAgent ignored: a topology worker is always an inline agent, never one from the repository's agent library"] : []),
  ];
  const specFile = specFileFor(req, mkdtempImpl);
  const spec = specFor(worker, { candidates: chain.value ?? null });
  const unsupported = cliChain(spec.agents[0]).filter((cli) => !["claude", "codex"].includes(cli));
  if (unsupported.length) return { ok: false, code: "TM_UNSUPPORTED_FALLBACK", failureScope: "task", reason: `unattended topology fallback is not approved for ${unsupported.join(", ")}; use the supported Claude → Codex chain` };
  const promptFile = join(req.worktree, PROMPT_FILE);
  writeImpl(promptFile, req.prompt);
  writeImpl(specFile, `${JSON.stringify(spec, null, 2)}\n`);

  const args = argvFor(req, specFile);
  const res = spawnImpl(entry.path, args, {
    shell: false,
    // The marker is added here rather than in envFor, which idle.mjs shares for a `manage assign`
    // process that is not a worker. On its own it rarely reaches the pane; the spec env above does.
    env: { ...envFor(req, env), ...Object.fromEntries(workerEnv(worker)) },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: timeoutMs,
    maxBuffer,
  });
  if (res?.error) return { ok: false, reason: `ao-topology failed to start: ${res.error.message}`, detail: { args, retry_safe: res.error.code === "ENOENT" }, ...(res.error.code !== "ENOENT" ? { failureScope: "task" } : {}) };
  if (res?.status !== 0) {
    let failure = {};
    try { failure = JSON.parse(String(res.stdout || "")); } catch { /* preserve the original tool diagnostic */ }
    const detail = { args, ...(failure.details || {}) };
    return { ok: false, code: failure.code, reason: toolFailureReason("ao-topology launch", res), detail, ...(detail.retry_safe === false ? { failureScope: "task" } : {}) };
  }

  const parsed = parseLaunch(res.stdout);
  if (!parsed.run) return { ok: false, reason: parsed.reason, detail: { args } };
  const passEnvWarnings = topologyPassEnvWarnings(req);
  return {
    ok: true,
    // The tmux session is the handle: `tmux attach -t <session>` is how a human looks in,
    // and ./collect.mjs reads the worker's liveness from exactly that session.
    run: `topology:${parsed.run.session}`,
    nativeRunId: parsed.run.run_id ?? parsed.run.runId ?? parsed.run.id ?? (parsed.run.runDir ? basename(parsed.run.runDir) : parsed.run.session),
    workflowRunId: parsed.run.workflow_id ?? parsed.run.workflowId ?? parsed.run.run_id ?? parsed.run.runId ?? parsed.run.id ?? (parsed.run.runDir ? basename(parsed.run.runDir) : parsed.run.session),
    detail: {
      args,
      promptFile,
      specFile,
      runDir: parsed.run.runDir ?? null,
      warnings: parsed.run.warnings ?? [],
      ...(passEnvWarnings.length ? { passEnvWarnings } : {}),
      ...(commandWarnings.length ? { commandWarnings } : {}),
    },
  };
}
