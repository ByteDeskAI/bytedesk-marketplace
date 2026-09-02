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
 */
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { config } from "../store.mjs";

export const name = "tmux";

/** Where the durable copy of the prompt lives, relative to the worktree root. */
export const PROMPT_FILE = ".tm-dispatch-prompt.md";

/** What the pane runs. Config `dispatch.tmuxCommand` overrides the whole argv. */
export const DEFAULT_COMMAND = ["claude", "-p", "--dangerously-skip-permissions"];

export function sessionName(taskId) {
  return `tm-${taskId}`;
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
export function argvFor({ task, worktree, prompt, session, actor, p }, tmuxCommand = null) {
  const command = Array.isArray(tmuxCommand) && tmuxCommand.length ? tmuxCommand : DEFAULT_COMMAND;
  const args = ["new-session", "-d", "-s", sessionName(task.id), "-c", worktree];
  // Who the worker works for, in the environment — the same variables lib/actor.mjs
  // reads, so the worker's claims and events land under the dispatching session.
  for (const [k, v] of [
    ["TM_SESSION_ID", session],
    ["TM_ACTOR", actor],
    ["TM_ROOT", p?.root],
  ]) {
    if (v) args.push("-e", `${k}=${v}`);
  }
  // The prompt is one positional argv element. `claude -p <prompt>` takes it
  // positionally; the prompt file (written by spawn) is the durable copy, not the
  // delivery channel — delivering by path would send the harness the path as text.
  return [...args, ...command, prompt];
}

export function spawn(req, { spawnImpl = spawnSync, writeImpl = writeFileSync } = {}) {
  const file = join(req.worktree, PROMPT_FILE);
  writeImpl(file, req.prompt);
  const args = argvFor(req, config(req.p).dispatch?.tmuxCommand);
  const res = spawnImpl("tmux", args, { shell: false, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  if (res.error) return { ok: false, reason: `tmux failed to start: ${res.error.message}`, detail: { args } };
  if (res.status !== 0) {
    return { ok: false, reason: `tmux new-session exited ${res.status}: ${String(res.stderr || "").trim()}`, detail: { args } };
  }
  return { ok: true, run: `tmux:${sessionName(req.task.id)}`, detail: { args, promptFile: file } };
}
