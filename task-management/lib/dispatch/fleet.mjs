/**
 * The fleet backend: shell out to fleet's `spawn-claude-feature`, which makes its
 * own worktree + detached tmux session and delivers the prompt to a claude pane.
 *
 * Why fleet owns the checkout: spawn-claude-feature resolves the repo's canonical
 * root from `--repo`, fetches the base, and creates its worktree at
 * `<repo>/.claude/worktrees/<ticket>-<slug>` itself. The tm-provisioned worktree
 * from dispatch is NOT handed over — fleet's session bookkeeping (meta, log,
 * results) is keyed to its own layout, so the tm worktree stays as the claim's
 * recorded checkout while fleet runs the worker in its own.
 *
 * Rules this module never breaks:
 *   1. argv-only, `shell: false`. The prompt is arbitrary markdown handoff text;
 *      it travels as a FILE passed by `--prompt-file` (the script's own contract
 *      for long multi-line prompts), never interpolated into a command string.
 *      The file is a per-spawn temp file: spawn-claude-feature reads it before it
 *      exits, and we block on that exit.
 *   2. `CLAUDE_SESSION_TICKET=<task.id>` is set on the child. Fleet's recursion
 *      guard auto-detects that variable as the parent ticket and derives spawn
 *      depth from it — without it a worker's own spawns would read as depth-0
 *      roots and the depth cap (default 2) would never engage.
 *   3. `--full-auto` is always passed: a dispatched worker that stops to ask
 *      permission questions is a worker nobody is watching.
 *   4. TM_SESSION_ID / TM_ACTOR / TM_ROOT pass through, so anything the worker
 *      does through tm lands under the dispatching session, same as tmux.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { slug } from "../store.mjs";
import { detectHostCaps } from "../hostcaps.mjs";

export const name = "fleet";

/** Available exactly when hostcaps found spawn-claude-feature (and tmux for it). */
export function available(caps = null) {
  const report = caps ?? detectHostCaps();
  return Boolean(report?.backends?.fleet?.available);
}

/**
 * The exact spawn-claude-feature argv (past the binary), as a pure value.
 * spawn() is three lines around this; keeping argv construction side-effect-free
 * is what lets a test prove the prompt text appears in NO argument.
 */
export function argvFor(req, promptFile) {
  return [
    req.task.id,
    slug(req.task.title ?? req.task.id),
    "--prompt-file",
    promptFile,
    "--repo",
    req.p.root,
    "--full-auto",
  ];
}

/**
 * The child's environment: the ambient one, plus fleet's recursion-guard ticket
 * and the tm identity of the dispatching session.
 */
export function envFor(req, base = process.env) {
  const env = { ...base, CLAUDE_SESSION_TICKET: req.task.id };
  for (const [k, v] of [
    ["TM_SESSION_ID", req.session],
    ["TM_ACTOR", req.actor],
    ["TM_ROOT", req.p?.root],
  ]) {
    if (v) env[k] = v;
  }
  return env;
}

/** Where the prompt file lives; per-spawn so two dispatches never share one. */
export function promptFileFor(req, mkdtempImpl = mkdtempSync) {
  return join(mkdtempImpl(join(tmpdir(), `tm-fleet-${req.task.id}-`)), "prompt.md");
}

/**
 * Launch the worker. req = { task, worktree, prompt, session, actor, p }.
 * Injectables (caps/spawnImpl/writeImpl/mkdtempImpl/env) exist for tests;
 * production takes the probed hostcaps and the real child_process.spawnSync.
 */
export function spawn(req, { caps = null, spawnImpl = spawnSync, writeImpl = writeFileSync, mkdtempImpl = mkdtempSync, env = process.env } = {}) {
  const report = caps ?? detectHostCaps();
  const entry = report?.backends?.fleet;
  if (!entry?.available || !entry.path) {
    return { ok: false, reason: entry?.reason ?? "fleet backend is not available on this host" };
  }

  const promptFile = promptFileFor(req, mkdtempImpl);
  writeImpl(promptFile, req.prompt);

  const args = argvFor(req, promptFile);
  const res = spawnImpl(entry.path, args, { shell: false, env: envFor(req, env), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  if (res.error) return { ok: false, reason: `spawn-claude-feature failed to start: ${res.error.message}`, detail: { args } };
  if (res.status !== 0) {
    return { ok: false, reason: `spawn-claude-feature exited ${res.status}: ${String(res.stderr || "").trim()}`, detail: { args } };
  }
  // The ticket IS the run handle: fleet keys session, tmux session, and state dir to it.
  return { ok: true, run: `fleet:${req.task.id}`, detail: { args, promptFile } };
}
