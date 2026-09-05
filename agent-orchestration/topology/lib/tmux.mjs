// Thin tmux wrapper. Every call is argv-based; pane targets are always `session:window.pane` ids
// recorded at launch so later commands never guess by index.
import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { fail, run } from "./util.mjs";

const TMUX = process.env.AO_TMUX_COMMAND || "tmux";

export async function tmux(args, options = {}) {
  const result = await run(TMUX, args, { allowFailure: true, timeoutMs: options.timeoutMs ?? 15_000 }).catch((error) => ({ code: 1, stdout: "", stderr: error.message }));
  if (result.code !== 0 && !options.allowFailure) {
    fail("TOPOLOGY_TMUX_FAILED", `tmux ${args.join(" ")} failed: ${result.stderr.trim() || result.stdout.trim() || `exit ${result.code}`}`, { args });
  }
  return result;
}

export async function tmuxVersion() {
  const result = await tmux(["-V"], { allowFailure: true });
  return result.code === 0 ? result.stdout.trim() : null;
}

export async function hasSession(session) {
  const result = await tmux(["has-session", "-t", `=${session}`], { allowFailure: true });
  return result.code === 0;
}

export async function newSession(session, { cwd, windowName = "main" }) {
  await tmux(["new-session", "-d", "-s", session, "-n", windowName, "-c", cwd, "-x", "220", "-y", "60"]);
  return paneId(`${session}:${windowName}`);
}

export async function newWindow(session, windowName, cwd) {
  await tmux(["new-window", "-t", session, "-n", windowName, "-c", cwd]);
  return paneId(`${session}:${windowName}`);
}

export async function splitPane(target, { cwd, horizontal = false }) {
  const result = await tmux(["split-window", horizontal ? "-h" : "-v", "-t", target, "-c", cwd, "-P", "-F", "#{pane_id}"]);
  return result.stdout.trim();
}

export async function selectLayout(target, layout) {
  await tmux(["select-layout", "-t", target, layout]);
}

export async function paneId(target) {
  const result = await tmux(["display-message", "-p", "-t", target, "#{pane_id}"]);
  return result.stdout.trim();
}

export async function setPaneTitle(pane, title) {
  await tmux(["select-pane", "-t", pane, "-T", title], { allowFailure: true });
}

/** Type text into a pane. Literal mode (-l) avoids tmux key-name interpretation of the message. */
export async function sendText(pane, text, submitKeys = ["Enter"]) {
  await tmux(["send-keys", "-t", pane, "-l", "--", text]);
  for (const key of submitKeys) {
    await tmux(["send-keys", "-t", pane, key]);
  }
}

export async function sendKeys(pane, keys) {
  await tmux(["send-keys", "-t", pane, ...keys]);
}

export async function capture(pane, lines = 60) {
  const result = await tmux(["capture-pane", "-p", "-t", pane, "-S", `-${lines}`], { allowFailure: true });
  return result.code === 0 ? result.stdout : "";
}

/**
 * Block until someone signals `channel`, or give up. A real cross-process barrier inside the tmux
 * server: it does not depend on what a pane looks like, which matters because a narrow pane renders
 * text one character per line and defeats any form of screen scraping.
 */
export async function waitForChannel(channel, timeoutMs) {
  const result = await tmux(["wait-for", channel], { allowFailure: true, timeoutMs });
  return result.code === 0;
}

export async function signalChannel(channel) {
  await tmux(["wait-for", "-S", channel], { allowFailure: true });
}

/** The pane's whole scrollback. Append-only, so a prefix taken earlier stays a prefix. */
export async function captureAll(pane) {
  const result = await tmux(["capture-pane", "-p", "-t", pane, "-S", "-"], { allowFailure: true });
  return result.code === 0 ? result.stdout : "";
}

export async function paneAlive(pane) {
  const result = await tmux(["display-message", "-p", "-t", pane, "#{pane_dead}"], { allowFailure: true });
  if (result.code !== 0) return false;
  return result.stdout.trim() !== "1";
}

export async function listPanes(session) {
  // tmux rewrites control characters in format output as "_", so use a visible separator.
  const SEP = "|";
  const result = await tmux(["list-panes", "-s", "-t", `=${session}`, "-F", ["#{pane_id}", "#{window_name}", "#{pane_title}", "#{pane_current_command}", "#{pane_dead}"].join(SEP)], { allowFailure: true });
  if (result.code !== 0) return [];
  return result.stdout
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const [id, window, title, command, dead] = line.split(SEP);
      return { id, window, title, command, alive: dead !== "1" };
    });
}

/** Kill whatever runs in the pane and give it a fresh shell in the same place. */
export async function respawnPane(pane) {
  await tmux(["respawn-pane", "-k", "-t", pane]);
}

export async function killSession(session) {
  await tmux(["kill-session", "-t", `=${session}`], { allowFailure: true });
}

export async function selectPane(pane) {
  await tmux(["select-pane", "-t", pane], { allowFailure: true });
}

export function attachCommand(session) {
  return `${TMUX} attach -t ${session}`;
}


// ---------------------------------------------------------------------------------------------
// Event-driven surface. Everything above is a one-shot command; everything below is how this layer
// learns that something changed without asking repeatedly.
//
// Measured against the tmux 3.4 server on 2026-09-05, because every one of these has a sharp edge:
//
//   * `#{C/r:re}` searches pane content and returns the LINE NUMBER of the first match, 0 for none.
//     The search is per line, so `^` and `$` anchor to a line — but `\n` is not a thing you can
//     match, `$` is unreliable because tmux pads lines, `{` and `}` break the format parser outright
//     (`#{C/r:a{2}}` returns the literal `0}`), and `[[:space:]]` cannot be used at all because `:`
//     is the format's own separator. `\s`, `\b` and `\w` DO work — glibc extends POSIX ERE.
//     That is why a tmux-side pattern is declared separately from the adapter's JS regex rather
//     than translated from it: they are different languages with a misleading overlap.
//   * `refresh-client -B` arguments must be quoted: `#` starts a comment and a leading `%` breaks
//     the parser. We always pass the whole subscription as one argv element.
//   * `remain-on-exit` is a PANE option. Setting it with `set-option -t <session>` silently does
//     nothing, the pane vanishes on exit, and `#{pane_dead_status}` is never readable.
//   * `show-hooks` does not list `pane-died` or `pane-exited` even when they are registered and
//     firing. Never use it to conclude a hook is missing.

/** `%subscription-changed <name> <session> <window> <index> <pane> : <value>` */
const SUBSCRIPTION_LINE = /^%subscription-changed\s+(\S+)\s+\S+\s+\S+\s+\S+\s+(%\d+)\s+:\s?(.*)$/;

/**
 * One control-mode client per session. It replaces the readiness poll loop: instead of every agent
 * asking the server what its pane looks like twice a second, the server pushes a line when a
 * subscribed format's value actually changes, at most once a second, for as many panes as we like.
 * Ten agents therefore cost what three do — one client, one subscription each, and nothing at all
 * while the panes are quiet.
 *
 * Emits "subscription" with { name, pane, value } and "close".
 */
export class ControlClient extends EventEmitter {
  constructor(session) {
    super();
    this.session = session;
    this.child = null;
    this.buffer = "";
    this.closed = false;
    this.last = new Map();
  }

  /** Start the client. Resolves false if control mode is unavailable, so callers can fall back. */
  async start(timeoutMs = 5000) {
    return new Promise((resolveStart) => {
      let settled = false;
      const done = (ok) => {
        if (settled) return;
        settled = true;
        resolveStart(ok);
      };
      try {
        this.child = spawn(TMUX, ["-C", "attach", "-t", `=${this.session}`, "-f", "read-only,ignore-size"], {
          stdio: ["pipe", "pipe", "pipe"],
        });
      } catch {
        return done(false);
      }
      this.child.on("error", () => done(false));
      this.child.on("close", () => {
        this.closed = true;
        this.emit("close");
        done(false);
      });
      this.child.stdout.setEncoding("utf8");
      this.child.stdout.on("data", (chunk) => {
        this.buffer += chunk;
        let index;
        while ((index = this.buffer.indexOf("\n")) >= 0) {
          const line = this.buffer.slice(0, index).replace(/\r$/, "");
          this.buffer = this.buffer.slice(index + 1);
          this.#line(line);
        }
      });
      // The first notification proves the client is attached and parsing.
      this.once("ready", () => done(true));
      setTimeout(() => done(!this.closed), timeoutMs);
    });
  }

  #line(line) {
    if (line.startsWith("%session-changed") || line.startsWith("%begin")) this.emit("ready");
    const match = SUBSCRIPTION_LINE.exec(line);
    if (!match) return;
    const [, name, pane, value] = match;
    // tmux pushes an initial value on subscribe and then only on change; de-duplicate anyway so a
    // handler can be written as "this happened" rather than "this might have happened again".
    const key = `${name}\u0000${pane}`;
    if (this.last.get(key) === value) return;
    this.last.set(key, value);
    this.emit("subscription", { name, pane, value });
  }

  /**
   * Subscribe `name` to `format` evaluated for `pane`. The whole subscription is one argv element
   * because the format contains `#` — unquoted, tmux would read the rest of the line as a comment.
   */
  subscribe(name, pane, format) {
    if (!this.child || this.closed) return false;
    return this.child.stdin.write(`refresh-client -B "${name}:${pane}:${format}"\n`);
  }

  unsubscribe(name) {
    if (!this.child || this.closed) return false;
    return this.child.stdin.write(`refresh-client -B "${name}"\n`);
  }

  close() {
    this.closed = true;
    try {
      this.child?.stdin?.end();
      this.child?.kill();
    } catch {
      /* already gone */
    }
  }
}

/** Pane options are per pane. `-t <session>` compiles and does nothing — see the note above. */
export async function setPaneOption(pane, name, value) {
  await tmux(["set-option", "-p", "-t", pane, name, value], { allowFailure: true });
}

export async function setHook(session, hook, command) {
  await tmux(["set-hook", "-t", `=${session}`, hook, command], { allowFailure: true });
}

/**
 * Stream everything a pane prints to a command, from now on. Attach it at pane creation: pipe-pane
 * only sees what is written after it starts, so attaching it later loses the beginning — which is
 * exactly the part that says why an agent failed to come up.
 */
export async function pipePane(pane, command) {
  await tmux(["pipe-pane", "-o", "-t", pane, command], { allowFailure: true });
}

/** The real exit status of a dead pane. Requires `remain-on-exit on` set BEFORE it died. */
export async function paneDeath(pane) {
  const result = await tmux(["display-message", "-p", "-t", pane, "#{pane_dead}\t#{pane_dead_status}\t#{pane_dead_signal}"], { allowFailure: true });
  if (result.code !== 0) return { dead: true, status: null, signal: null, gone: true };
  const [dead, status, signal] = result.stdout.trim().split("\t");
  return { dead: dead === "1", status: status ? Number(status) : null, signal: signal || null, gone: false };
}

/**
 * Prove the shell is accepting input AND leave the pane empty, in one round trip.
 *
 * Clearing matters for readiness: the server-side content search has no notion of "output produced
 * after the launcher was sent", so the only way to make a match trustworthy is for the pane to hold
 * nothing but the agent. What survives is the prompt the shell redraws, which is why the caller
 * also gets the height of that prompt to discount.
 */
export async function clearAndWaitForShell(pane, channel, timeoutMs = 15_000) {
  await sendText(pane, `clear; ${TMUX} wait-for -S ${channel}`);
  const signalled = await waitForChannel(channel, timeoutMs);
  if (!signalled) return { ok: false, baseline: "", promptLines: 0 };
  const baseline = await captureAll(pane);
  const promptLines = baseline.split("\n").filter((line) => line.trim().length > 0).length;
  return { ok: true, baseline, promptLines };
}
