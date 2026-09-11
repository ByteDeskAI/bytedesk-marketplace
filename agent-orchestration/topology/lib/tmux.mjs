// Thin tmux wrapper. Every call is argv-based; pane targets are always `session:window.pane` ids
// recorded at launch so later commands never guess by index.
import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { isAbsolute } from "node:path";
import { fail, run, shellQuote, terminalText } from "./util.mjs";

const TMUX = process.env.AO_TMUX_COMMAND || "tmux";
// Launcher shells are infrastructure: user login rc files may consume input or replace the shell.
// Keep inherited PATH/credentials, but never depend on interactive profile startup completing.
const LAUNCH_SHELL = ["bash", "--noprofile", "--norc", "-i"];

/**
 * The `-L <name>` / `-S <path>` prefix that selects a tmux server. Pure, and exported, because it is
 * the one thing every entry point into this file has to get right and the two that spawn `tmux`
 * directly — `waitForChannel` and `ControlClient` — used to omit it entirely (TM-130).
 */
export function serverArgs(server) {
  return server ? [isAbsolute(server) ? "-S" : "-L", server] : [];
}

export async function tmux(args, options = {}) {
  const prefix = serverArgs(options.tmuxServer);
  const result = await run(options.env?.AO_TMUX_COMMAND || TMUX, [...prefix, ...args], { env: options.env, allowFailure: true, timeoutMs: options.timeoutMs ?? 15_000 }).catch((error) => ({ code: 1, stdout: "", stderr: error.message }));
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

/**
 * Create the detached session AND take ownership of its geometry.
 *
 * The geometry is not cosmetic — readiness is decided by searching what a pane RENDERS, and that
 * search is per rendered line, so a pattern wider than the pane is split across two lines and can
 * never match. A run whose panes come out narrow reports every agent as never-ready and pays the
 * full timeout for each one, with nothing in the log to say why.
 *
 * `-x/-y` alone does not give us that geometry. tmux honours them only while `window-size` is
 * `manual` or the session has no client, and the default `latest` then re-sizes the window to
 * whatever client last touched it. On a SHARED tmux server that is some unrelated session's
 * terminal — measured here: a 220x60 request came out 93x20 because another session's client was
 * 93x20, which left the stacked panes 12 columns wide and turned "fake-agent ready" into "fake-agent
 * r" / "eady". Our own control-mode client would do the same on its own.
 *
 * So: create, pin `window-size manual` on THIS session only, then resize. After that the window is
 * ours — a client attaching later, control-mode or human, no longer reflows the agents.
 */
export async function newSession(session, { cwd, windowName = "main", width = 220, height = 60 }) {
  await tmux(["new-session", "-d", "-s", session, "-n", windowName, "-c", cwd, "-x", String(width), "-y", String(height), ...LAUNCH_SHELL]);
  // Session-scoped (-t <session>), never -g: this server is shared with everyone else's sessions.
  await tmux(["set-option", "-t", session, "window-size", "manual", ...sessionTitleArgs(session)], { allowFailure: true });
  await tmux(["resize-window", "-t", `${session}:${windowName}`, "-x", String(width), "-y", String(height)], { allowFailure: true });
  return paneId(`${session}:${windowName}`);
}

/**
 * How large the window has to be for `agents` panes to each stay legible.
 *
 * Width is fixed and generous: `main-vertical` gives the main pane `main-pane-width` (80 by
 * default) and stacks the rest in one column of the remainder, so 220 leaves that column ~139
 * columns however many agents there are. Height is what actually scales — those N-1 stacked panes
 * share it, and a pane shorter than a CLI's startup banner scrolls the ready line out of the
 * visible region the server searches. `MIN_PANE_ROWS` each is the floor.
 */
export const MIN_PANE_ROWS = 12;
export function windowSizeFor(agents) {
  const panes = Math.max(1, Number(agents) || 1);
  return { width: 220, height: Math.max(60, panes * MIN_PANE_ROWS) };
}

export async function newWindow(session, windowName, cwd) {
  await tmux(["new-window", "-t", session, "-n", windowName, "-c", cwd, ...LAUNCH_SHELL]);
  return paneId(`${session}:${windowName}`);
}

/**
 * Create one pane per cwd in ONE tmux invocation, returning their ids in order.
 *
 * The interleaved `select-layout` is correctness, not cosmetics. `split-window -t <window>` splits
 * the ACTIVE pane, so consecutive splits keep halving the same pane — 60 rows becomes 30, 15, 7, 3
 * — and the seventh agent fails outright with "no space for new pane". Re-tiling after each split
 * re-equalizes, so the next one always has room. Batching makes that free: every separate tmux call
 * is a fresh client process connecting to the server and queueing behind every other client, which
 * is the cost this whole layer exists to avoid.
 */
export async function splitPanes(target, cwds) {
  if (cwds.length === 0) return [];
  const args = [];
  for (const cwd of cwds) {
    if (args.length) args.push(";");
    args.push("split-window", "-v", "-t", target, "-c", cwd, "-P", "-F", "#{pane_id}", ...LAUNCH_SHELL);
    args.push(";", "select-layout", "-t", target, "tiled");
  }
  const result = await tmux(args);
  const ids = result.stdout.split("\n").map((line) => line.trim()).filter(Boolean);
  // A short list would otherwise become `undefined` pane ids in the caller's map, and every later
  // tmux call would target the session's active pane instead — every agent typed into one pane.
  if (ids.length !== cwds.length) {
    fail("TOPOLOGY_TMUX_FAILED", `tmux created ${ids.length} panes but ${cwds.length} were asked for.`, { ids });
  }
  return ids;
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

/**
 * Type text into a pane and submit it. Literal mode (-l) avoids tmux key-name interpretation.
 *
 * The submit key MUST go in its own invocation. Batching it after the text with tmux's `;`
 * separator — which this did, to save a client round trip — makes tmux write both in one go, and
 * the pane's program then reads them in a single chunk: `"…the message\r"`. Every modern TUI reads
 * one chunk containing a newline as a PASTE of multiline text, so the message landed in the
 * composer and sat there, unsent, while the agent looked idle and the run looked like an agent
 * ignoring its mail. It is the mailbox doorbell that stops ringing, so nothing errors and nothing
 * retries; a human pressing Enter in the pane fixes it, which is how it was found.
 *
 * Measured on tmux 3.4 against a probe that logs one line per stdin read:
 *
 *   batched (`send-keys -l … ; send-keys Enter`)  ->  CHUNK 1: "text\r"
 *   separate invocations, no delay at all         ->  CHUNK 1: "text"   CHUNK 2: "\r"
 *
 * Separate writes are NECESSARY BUT NOT SUFFICIENT, and this is the part a chunk probe cannot show
 * you. A probe that logs its stdin reads has no paste heuristic to trip, so it reports two clean
 * chunks and looks fixed. Measured against a real Codex TUI on the same pane:
 *
 *   separate writes, no delay  ->  still sitting in the composer
 *   separate writes, +300ms    ->  submitted
 *   separate writes, +800ms    ->  submitted
 *
 * So the composer also has to SETTLE before an Enter counts as a keystroke rather than as more
 * pasted input. `AO_SUBMIT_SETTLE_MS` tunes it for a slower machine; the default is deliberately
 * above the measured threshold rather than at it. This costs one delay per message — a price worth
 * paying for a doorbell that rings, and paid only on the submit, not on the text.
 */
export const SUBMIT_SETTLE_MS = Number(process.env.AO_SUBMIT_SETTLE_MS ?? 500);

export async function sendText(pane, text, submitKeys = ["Enter"]) {
  await tmux(["send-keys", "-t", pane, "-l", "--", text]);
  if (submitKeys.length > 0 && SUBMIT_SETTLE_MS > 0) await new Promise((resolve) => setTimeout(resolve, SUBMIT_SETTLE_MS));
  for (const key of submitKeys) await tmux(["send-keys", "-t", pane, key]);
}

/** Title, remain-on-exit, pipe-pane and the role display options are one round trip. */
export async function preparePane(pane, { title, log, display = null }) {
  await tmux([
    "select-pane", "-t", pane, "-T", title,
    ";", "set-option", "-p", "-t", pane, "remain-on-exit", "on",
    ";", "pipe-pane", "-o", "-t", pane, log,
    ...(display ? roleDisplayArgs(pane, display) : []),
  ], { allowFailure: true });
}

// -- Role display (TM-168) --------------------------------------------------------------------------
// The terminal title bar shows who a pane is: icon, readable name, role label. It is built from
// pane-scoped user options and a session-scoped `set-titles-string`, and deliberately NOT from
// `pane_title` — provider CLIs overwrite that, census reads activity from it, and the gateway parses
// the role out of it. Display-only: nothing may read these options back to decide a role or authority.
// Measured on tmux 3.4 (TM-168):
//
//   * `#{@opt}` inserts an option value LITERALLY. `#{pane_id}` and `#[fg=red]` stored in a value
//     came back verbatim; only `#{E:@opt}` re-expands.
//   * tmux does NOT sanitise what `set-titles` sends. An ESC ] 2 ; … BEL stored in `@ao_agent`
//     reached the attached terminal as a second OSC sequence. So every value is scrubbed here.
//   * In a batched invocation an argv element ENDING in `;` is a command separator: `abc;` stored
//     `abc` and split the command in two.

/** Rendered from the ACTIVE pane. A pane without our options (a user's own split) keeps tmux's default title. */
export const ROLE_TITLE_FORMAT = '#{?@ao_role_icon,#{@ao_role_icon} #{@ao_agent} · #{@ao_role_label},#S:#I:#W - "#T"}';

/**
 * A value safe to store in a tmux option: `terminalText`, capped, plus two substitutions. `#` becomes
 * the look-alike `＃` — `#{@opt}` does not re-expand it, but a user's own status or border format may
 * parse `#[...]` styles after expansion, and a look-alike is inert everywhere. A trailing `;` becomes
 * `；` so the value cannot split a batched command.
 */
export function tmuxText(value, max = 80) {
  return terminalText(value, max).replace(/#/g, "＃").replace(/;$/, "；");
}

/** `; set-option -p` for each role display option, ready to append to a batch. */
export function roleDisplayArgs(pane, { agent, role, roleLabel, roleIcon }) {
  const values = { "@ao_agent": agent, "@ao_role": role, "@ao_role_label": roleLabel, "@ao_role_icon": roleIcon };
  return Object.entries(values).flatMap(([name, value]) => [";", "set-option", "-p", "-t", pane, name, tmuxText(value)]);
}

/** Session-scoped (never -g): only sessions this layer creates or owns get a title bar. */
export function sessionTitleArgs(session) {
  return [";", "set-option", "-t", session, "set-titles", "on", ";", "set-option", "-t", session, "set-titles-string", ROLE_TITLE_FORMAT];
}

/** Pane display options, plus the session title options when `session` is given (a pre-existing session). */
export async function setRoleDisplay(pane, display, { session = null } = {}) {
  const [, ...args] = [...roleDisplayArgs(pane, display), ...(session ? sessionTitleArgs(session) : [])];
  await tmux(args, { allowFailure: true });
}

export async function sendKeys(pane, keys) {
  await tmux(["send-keys", "-t", pane, ...keys]);
}

/**
 * TM-155. A unix socket path is limited to ~108 bytes by the kernel (`sun_path`), and tmux builds
 * its socket as `$TMUX_TMPDIR/tmux-<uid>/<name>`. A session-scratch directory blows through that
 * easily — measured during the EP-018 demo with a per-session scratchpad path:
 *
 *     error connecting to /tmp/claude-1000/-home-ryan-…-scratchpad/demo-tmux/tmux-1000/default
 *     (File name too long)
 *
 * tmux names the path but not the cause, and "File name too long" reads like a filename problem
 * rather than a socket-length one. Answering before the call is cheap and the message can say what
 * to do about it.
 *
 * Returns null when there is nothing to say.
 */
export function socketPathProblem(env = process.env, uid = process.getuid?.() ?? 0) {
  const dir = env.TMUX_TMPDIR;
  if (!dir) return null;
  const path = `${dir}/tmux-${uid}/default`;
  const bytes = Buffer.byteLength(path, "utf8");
  if (bytes <= SOCKET_PATH_MAX) return null;
  return {
    code: "TMUX_SOCKET_PATH_TOO_LONG",
    message: `TMUX_TMPDIR makes a socket path of ${bytes} bytes and the kernel limit is ${SOCKET_PATH_MAX}: ${path}. tmux reports this as "File name too long", which reads like a filename problem and is not.`,
    fix: { note: "Point TMUX_TMPDIR at a short directory — /tmp/ao-<something> — rather than a per-session scratch path." },
  };
}

/** `sun_path` is 108 bytes on Linux and 104 on macOS; the smaller one is the safe answer. */
export const SOCKET_PATH_MAX = 104;

export async function capture(pane, lines = 60, { escapes = false } = {}) {
  // `-e` keeps the SGR sequences. TM-151: that is the ONLY way to tell Claude's dim suggestion text
  // from a human's typed draft — both are plain letters after the prompt glyph, and only one of
  // them means the composer is occupied. Off by default: every existing caller wants the plain
  // text, and escape sequences in a screen-scrape are a trap for a pattern that does not expect them.
  const args = ["capture-pane", "-p", ...(escapes ? ["-e"] : []), "-t", pane, "-S", `-${lines}`];
  const result = await tmux(args, { allowFailure: true });
  return result.code === 0 ? result.stdout : "";
}

/**
 * Block until someone signals `channel`, or give up. A real cross-process barrier inside the tmux
 * server: it does not depend on what a pane looks like, which matters because a narrow pane renders
 * text one character per line and defeats any form of screen scraping.
 */
export async function waitForChannel(channel, timeoutMs, { tmuxServer = null } = {}) {
  // tmux handles SIGTERM by exiting 0. A subprocess timeout can therefore look successful;
  // observing the deadline separately is essential: timeout is never a shell acknowledgement.
  //
  // TM-130: this spawned a BARE `tmux`, with none of the `-L`/`-S` prefix every call through
  // `tmux()` gets. On a run started with `--server <socket>` it therefore waited on the default
  // server — agreeing with `clearAndWaitForShell`, which signalled through an equally bare command
  // typed into the pane, so the pair happened to match and nothing looked wrong. The costs are that
  // a run on a private socket touches (and may start) an unrelated default server, and that any
  // caller signalling through `signalChannel({ tmuxServer })` would deadlock against it.
  if (!(timeoutMs > 0)) return false;
  return new Promise(resolve => {
    let settled = false;
    const child = spawn(TMUX, [...serverArgs(tmuxServer), "wait-for", channel], { stdio: "ignore", shell: false });
    const finish = value => { if (!settled) { settled = true; clearTimeout(timer); resolve(value); } };
    const timer = setTimeout(() => { finish(false); child.kill('SIGTERM'); }, timeoutMs);
    child.once('error', () => finish(false));
    child.once('exit', (code, signal) => finish(code === 0 && signal === null));
  });
}

export async function signalChannel(channel) {
  await tmux(["wait-for", "-S", channel], { allowFailure: true });
}

/**
 * The pane's whole scrollback, or `null` if tmux could not be asked. Append-only, so a prefix taken
 * earlier stays a prefix.
 *
 * The null matters more than it looks. This used to return `""` when the capture failed — including
 * when the tmux call TIMED OUT, which happens on a loaded machine — and an empty string is exactly
 * what a pane that has drawn nothing yet returns. So a failed capture was indistinguishable from a
 * blank pane: readiness kept polling a screen it had never actually read, matched neither the ready
 * pattern nor any failure pattern, and reported "ready pattern not seen within 30000ms" — a slow
 * agent, for what was really a failed query. That is the intermittent contract-test failure in
 * TM-120: every agent timing out at once, including the fixture whose whole job is to print a usage
 * limit and be caught by a failure pattern.
 */
export async function captureAll(pane) {
  const result = await tmux(["capture-pane", "-p", "-t", pane, "-S", "-"], { allowFailure: true });
  return result.code === 0 ? result.stdout : null;
}

export async function paneAlive(pane) {
  // Deliberately delegated: asking tmux directly here made an unknown pane id look alive, because
  // tmux answers an unknown target with exit 0 and an empty line rather than an error.
  return (await paneState(pane)).alive;
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
  await tmux(["respawn-pane", "-k", "-t", pane, ...LAUNCH_SHELL]);
}

/** Every live session name on this tmux server. Empty when there is no server at all. */
export async function listSessions() {
  const result = await tmux(["list-sessions", "-F", "#{session_name}"], { allowFailure: true });
  return result.code === 0 ? result.stdout.split("\n").map((line) => line.trim()).filter(Boolean) : [];
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
  constructor(session, { tmuxServer = null } = {}) {
    super();
    this.session = session;
    // TM-130: without this the client attached to the DEFAULT server. On a run started with
    // `--server <socket>` it found no such session, `start()` resolved false, and every agent fell
    // back to polling — correctly, quietly, and for entirely the wrong reason, with nothing
    // anywhere saying the subscription path had been disabled for the whole run.
    this.tmuxServer = tmuxServer;
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
        this.child = spawn(TMUX, [...serverArgs(this.tmuxServer), "-C", "attach", "-t", `=${this.session}`, "-f", "read-only,ignore-size"], {
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

/**
 * Register a hook on a session. Returns false if tmux refused it.
 *
 * The target must NOT carry the `=` exact-match prefix used everywhere else here: `set-hook`
 * resolves its target as a window, and `-t "=name"` fails with "no such window". Combined with
 * `show-hooks` not listing pane-died at all, a hook registered that way is invisible in both
 * directions — it never fires and nothing says so. Hence the returned status.
 */
export async function setHook(session, hook, command) {
  const result = await tmux(["set-hook", "-t", session, hook, command], { allowFailure: true });
  return result.code === 0;
}

/**
 * Stream everything a pane prints to a command, from now on. Attach it at pane creation: pipe-pane
 * only sees what is written after it starts, so attaching it later loses the beginning — which is
 * exactly the part that says why an agent failed to come up.
 */
export async function pipePane(pane, command) {
  await tmux(["pipe-pane", "-o", "-t", pane, command], { allowFailure: true });
}

/**
 * Whether a pane is alive, and — if it is not — what it went out with. One query, deliberately.
 *
 * Liveness and exit status used to be two calls: `paneAlive` decided the verdict, then `paneDeath`
 * fetched the number. Two calls means two chances for the answer to change underneath and two
 * chances for a loaded machine to time one of them out, and the failure that produces is a death
 * reported with `exit_status: null` — "pane exited" with nothing to say WHICH exit, which is the
 * whole diagnosis. A CLI that rejected its flags and one that was killed look identical then.
 *
 * `#{pane_dead_status}` requires `remain-on-exit on` to have been set BEFORE the pane died.
 */
export async function paneState(pane) {
  const result = await tmux(["display-message", "-p", "-t", pane, "#{pane_dead}\t#{pane_dead_status}\t#{pane_dead_signal}"], { allowFailure: true });
  // The pane is not there at all — killed, or its session is gone. Dead is the honest answer; the
  // status is genuinely unknown rather than zero.
  if (result.code !== 0) return { gone: true, alive: false, dead: true, status: null, signal: null };
  // Split the raw first line, not a trimmed string: an alive pane's status and signal are EMPTY
  // fields, and trimming first eats the tabs that hold their places.
  const [dead = "", status = "", signal = ""] = result.stdout.split("\n")[0].split("\t").map((field) => field.trim());
  // An unknown pane id is NOT an error to tmux: `display-message -t %99999` exits 0 and prints an
  // empty line. Read literally that is `pane_dead != "1"`, so a pane that no longer exists reported
  // itself ALIVE — measured on tmux 3.4, and the reason this is checked rather than assumed.
  if (dead === "") return { gone: true, alive: false, dead: true, status: null, signal: null };
  return { gone: false, alive: dead !== "1", dead: dead === "1", status: status === "" ? null : Number(status), signal: signal || null };
}

/** @deprecated Use `paneState`, which answers this and liveness in the same query. */
export async function paneDeath(pane) {
  const { gone, dead, status, signal } = await paneState(pane);
  return { dead, status, signal, gone };
}

/**
 * Prove the shell is accepting input, leave the pane empty, and plant an anchor — one round trip.
 *
 * Clearing matters for readiness: the server-side content search has no notion of "output produced
 * after the launcher was sent", so the only way to make a match trustworthy is for the pane to hold
 * nothing but the agent. What survives is the prompt the shell redraws, which is why the caller
 * also gets the height of that prompt to discount.
 *
 * The printed marker is the load-bearing part, and it replaces using the cleared screen itself as
 * the anchor. That screen is whitespace whenever the prompt has not finished redrawing — and a
 * whitespace anchor matches inside the blank tail of a LATER capture just as happily as at the
 * point it was taken, so `screenSince` would slice past the agent's output and return "". The agent
 * then never looked ready and paid its whole timeout, intermittently, depending on nothing but how
 * fast the shell redrew. A unique non-blank token cannot land in the wrong place.
 *
 * It also fixes `promptLines`. Counting non-blank lines of the whole capture counted SCROLLBACK too
 * (`captureAll` is `-S -`), which is only harmless while a pane's history happens to be empty.
 * Counting after the marker counts the prompt and nothing else, which is what the name says.
 */
export async function clearAndWaitForShell(pane, channel, timeoutMs = 15_000, { tmuxServer = null } = {}) {
  const marker = `ao-baseline-${channel}`;
  // The signal is typed into the PANE, so it carries the server prefix the same way the waiter
  // does. The two must name the same server or the barrier never closes.
  const signal = [shellQuote(TMUX), ...serverArgs(tmuxServer).map(shellQuote), "wait-for", "-S", shellQuote(channel)].join(" ");
  await sendText(pane, `clear; printf '%s\\n' '${marker}'; ${signal}`);
  const signalled = await waitForChannel(channel, timeoutMs, { tmuxServer });
  if (!signalled) return { ok: false, baseline: "", promptLines: 0 };
  const screen = await captureAll(pane);
  // A capture we could not take is not a screen with nothing on it: fall back to "no prompt lines"
  // rather than pretending the pane was blank.
  if (screen === null) return { ok: true, baseline: marker, promptLines: 0 };
  // The echoed command holds the marker too, but `clear` wiped it from the visible screen and it
  // survives only above in the history — so the LAST occurrence is the printed one, which is the
  // boundary we want.
  const at = screen.lastIndexOf(marker);
  const after = at === -1 ? "" : screen.slice(at + marker.length);
  return { ok: true, baseline: marker, promptLines: after.split("\n").filter((line) => line.trim().length > 0).length };
}

/** Enumerate exact pane incarnations on the selected server, independent of session names. */
export async function listServerPanes({ tmuxServer, env = process.env } = {}) {
  // `pane_title` is here for the liveness census (TM-131): codex, kimi and grok animate a braille
  // spinner in the pane title, so one extra column on the listing the supervisor already takes
  // answers "is this agent working" for every pane on the server without a single extra tmux call.
  // Appended LAST so every existing positional destructure keeps its index.
  const fields = ["socket_path", "pid", "session_id", "session_created", "pane_id", "pane_pid", "session_name", "pane_current_command", "pane_current_path", "pane_dead", "pane_title"];
  const result = await tmux(["-u", "list-panes", "-a", "-F", fields.map((key) => `#{${key}}`).join("\t")], { tmuxServer, env, allowFailure: true });
  if (result.code !== 0) {
    if (/no server running|error connecting.*No such file|failed to connect.*No such file/.test(result.stderr)) return [];
    fail("TOPOLOGY_TMUX_OBSERVATION_FAILED", "Cannot enumerate tmux panes; liveness is unknown.");
  }
  return result.stdout.split("\n").filter(Boolean).map((line) => {
    const [serverKey, serverPid, sessionId, sessionCreated, paneId, panePid, sessionName, command, cwd, dead, title] = line.split("\t");
    return { serverKey, serverPid: Number(serverPid), sessionId, sessionCreated: Number(sessionCreated), paneId, panePid: Number(panePid), sessionName, command, cwd, alive: dead === "0", title: title ?? "" };
  });
}
