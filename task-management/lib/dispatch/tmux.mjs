/**
 * The tmux backend: a detached session per task, running the harness CLI.
 *
 * Why tmux: it is the lightest launcher that survives the terminal that started it —
 * the worker keeps running when the dispatching session ends, and `tmux attach` is
 * how you look in on it. The session is named `tm-<taskid>` so the board's claim and
 * the terminal's session list name the same thing.
 *
 * Two rules this module never breaks:
 *   1. argv-only, `shell: false`, always. The prompt is a task's handoff text —
 *      arbitrary markdown that can contain backticks, `$()` and quotes. Routed
 *      through a shell string that is a code-injection hole; as one positional argv
 *      element it is inert data.
 *   2. The prompt ALSO lands in the worktree at `.tm-dispatch-prompt.md`, because an
 *      argv element vanishes with the process and the file is what a human (or a
 *      resumed session) reads to see exactly what the worker was told. It sits in
 *      the worktree root, untracked — the worktree is per-task scratch, and the
 *      `.bytedesk/` tree's gitignore contract does not reach inside it; delete it
 *      with the worktree.
 *
 * TM-177: the worker runs with every permission prompt skipped, so it is marked
 * (TM_DISPATCH_WORKER / _TASK / _BRANCH) and launched with the guard hook in
 * `--settings` — see ../worker-guard.mjs. The hook rides on the command line so it
 * holds whether or not this plugin is enabled in the project the worker works in.
 */
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "../store.mjs";
import { branchName } from "../worktree.mjs";

export const name = "tmux";

/** Where the durable copy of the prompt lives, relative to the worktree root. */
export const PROMPT_FILE = ".tm-dispatch-prompt.md";

/** What the pane runs. Config `dispatch.tmuxCommand` overrides the whole argv. */
export const DEFAULT_COMMAND = ["claude", "-p", "--dangerously-skip-permissions"];

/** This plugin's hook wrapper, resolved from this module's own location — never a home path. */
export const GUARD_HOOK = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "hooks", "tm-hook.sh");

export function sessionName(taskId) {
  return `tm-${taskId}`;
}

/**
 * Claude settings JSON hanging the worker guard on every Bash call, for `claude --settings`
 * (`claude --help`: "--settings <file-or-json>  Path to a settings JSON file or a JSON string").
 * The path is single-quoted because Claude Code runs a hook command through a shell.
 */
export function guardSettings(hook = GUARD_HOOK) {
  const quoted = `'${hook.replaceAll("'", "'\\''")}'`;
  return JSON.stringify({ hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: `${quoted} pre-bash`, timeout: 10 }] }] } });
}

/**
 * The branch provision() gave this task: the same function over the same config. Pinned into the
 * worker's env at spawn, so a worker that checks out main cannot make main its "own" branch.
 */
export function workerBranch(req, cfg = config(req.p)) {
  return req.branch ?? branchName(req.task.id, req.task.title, cfg);
}

/** The variables that mark a process as a dispatch worker — what the guard hook keys on. Unset values are dropped. */
export function workerEnv(req) {
  return Object.entries({ TM_DISPATCH_WORKER: "1", TM_DISPATCH_TASK: req.task?.id, TM_DISPATCH_BRANCH: req.branch }).filter(([, v]) => v);
}

/**
 * Available when hostcaps say tmux is. Without caps (hostcaps not landed yet), probe
 * the binary directly — a wrong "no" here silently drops dispatch to manual, which
 * still works, so the probe is a convenience, never a gate that can brick dispatch.
 */
export function available(caps = null) {
  if (caps?.backends?.tmux) return Boolean(caps.backends.tmux.available);
  try {
    return spawnSync("tmux", ["-V"], { shell: false, stdio: "ignore" }).status === 0;
  } catch {
    return false;
  }
}

/**
 * The exact tmux invocation, as a pure value. spawn() is three lines around this;
 * keeping argv construction side-effect-free is what lets a test prove there is no
 * shell string without running tmux.
 */
export function argvFor(req, tmuxCommand = null) {
  const { task, worktree, prompt, session, actor, p } = req;
  const command = Array.isArray(tmuxCommand) && tmuxCommand.length ? tmuxCommand : DEFAULT_COMMAND;
  const args = ["new-session", "-d", "-s", sessionName(task.id), "-c", worktree];
  // Who the worker works for, in the environment — the same variables lib/actor.mjs
  // reads, so the worker's claims and events land under the dispatching session —
  // and the worker marker, which a configured tmuxCommand gets too.
  for (const [k, v] of [["TM_SESSION_ID", session], ["TM_ACTOR", actor], ["TM_ROOT", p?.root], ...workerEnv(req)]) {
    if (v) args.push("-e", `${k}=${v}`);
  }
  // Only claude understands --settings; any other harness would refuse to start.
  const guard = basename(String(command[0])) === "claude" ? ["--settings", guardSettings()] : [];
  // The prompt is one positional argv element. `claude -p <prompt>` takes it
  // positionally; the prompt file (written by spawn) is the durable copy, not the
  // delivery channel — delivering by path would send the harness the path as text.
  return [...args, ...command, ...guard, prompt];
}

export function spawn(req, { spawnImpl = spawnSync, writeImpl = writeFileSync } = {}) {
  const file = join(req.worktree, PROMPT_FILE);
  writeImpl(file, req.prompt);
  const cfg = config(req.p);
  const args = argvFor({ ...req, branch: workerBranch(req, cfg) }, cfg.dispatch?.tmuxCommand);
  const res = spawnImpl("tmux", args, { shell: false, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  if (res.error) return { ok: false, reason: `tmux failed to start: ${res.error.message}`, detail: { args } };
  if (res.status !== 0) {
    return { ok: false, reason: `tmux new-session exited ${res.status}: ${String(res.stderr || "").trim()}`, detail: { args } };
  }
  return { ok: true, run: `tmux:${sessionName(req.task.id)}`, detail: { args, promptFile: file } };
}
