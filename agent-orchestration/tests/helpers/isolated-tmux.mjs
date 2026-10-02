// One isolated tmux server per test (TM-281). Every real-tmux test goes through here so the three
// rules of .claude/rules/tmux-test-isolation.md are applied in one place rather than re-typed in
// each file: (1) TMUX is blank, (2) TMUX_TMPDIR is a fresh per-test directory, (3) the only
// kill-server is `-S <socket>`, and only after the socket is proven to be this test's own.
//
// INCIDENT-2026-09-09: a teardown that LOOKED isolated (TMUX_TMPDIR set) inherited $TMUX, reached
// the operator's server and destroyed 37 live agent sessions. So this file refuses, by resolved
// path, any socket that is the operator's — not merely any socket that looks wrong.
import { execFile as execFileCallback } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);
const uid = () => process.getuid?.() ?? 0;

/** The socket a bare `tmux` would use for this environment: $TMUX's server first, then the default. */
export function implicitSocket(env = process.env) {
  const fromTmux = /^(.*),[0-9]+,[^,]*$/.exec(env.TMUX ?? "")?.[1];
  return fromTmux || join(env.TMUX_TMPDIR || "/tmp", `tmux-${uid()}`, "default");
}

/** A path with every existing ancestor resolved, so a symlinked /tmp or a `..` cannot hide a match. */
function resolved(path) {
  try { return realpathSync(path); } catch { /* not created yet */ }
  const parent = dirname(path);
  return parent === path ? path : join(resolved(parent), basename(path));
}

/**
 * Sockets that belong to the operator, never to a test: the system default server, and the server
 * the suite was started from ($TMUX, recorded by the preflight before it blanked it).
 */
export function operatorSockets(env = process.env) {
  const sockets = [join("/tmp", `tmux-${uid()}`, "default")];
  if (env.AO_TEST_OPERATOR_TMUX_SOCKET) sockets.push(env.AO_TEST_OPERATOR_TMUX_SOCKET);
  const live = /^(.*),[0-9]+,[^,]*$/.exec(env.TMUX ?? "")?.[1];
  if (live) sockets.push(live);
  return sockets.map(resolved);
}

/** Throws when `socket` resolves to an operator socket. Returns the socket otherwise. */
export function refuseOperatorSocket(socket, env = process.env) {
  if (!socket) throw new Error("refusing an empty tmux socket: a bare tmux would resolve the operator's server");
  if (operatorSockets(env).includes(resolved(socket))) {
    throw new Error(`refusing to use the operator's tmux socket ${socket} from a test (TM-281, INCIDENT-2026-09-09)`);
  }
  return socket;
}

/**
 * Kill a server a test created, by socket only, after proving it is the test's own: TMUX blank,
 * the socket under the test's TMUX_TMPDIR, and not an operator socket. The one call in tests/ that
 * may say `kill-server`.
 */
export async function killOwnedServer(env, socket) {
  if (!socket) return;
  if (env.TMUX !== "" || !env.TMUX_TMPDIR || !resolved(socket).startsWith(`${resolved(env.TMUX_TMPDIR)}/`)) {
    throw new Error(`refusing to kill a tmux server outside this test's TMUX_TMPDIR: ${socket}`);
  }
  refuseOperatorSocket(socket, env);
  await execFile("tmux", ["-S", socket, "kill-server"], { env: { ...process.env, ...env } }).catch(() => {});
}

/**
 * An isolated tmux environment for one test. `socket` is the default socket INSIDE the private
 * TMUX_TMPDIR, so explicit `-S socket` calls, library calls under `within()`, and subprocesses given
 * `env` all land on the same server — and the teardown reaches all of it. The directory is short
 * (/tmp/aot-XXXXXX) because a unix socket path is capped at 108 bytes.
 */
export function isolatedTmux(t, { extraEnv = {} } = {}) {
  const dir = mkdtempSync("/tmp/aot-");
  const socketDir = join(dir, `tmux-${uid()}`);
  mkdirSync(socketDir, { mode: 0o700 }); // tmux will not create it for -S, and checks its mode
  const socket = refuseOperatorSocket(join(socketDir, "default"));
  const env = { ...process.env, TMUX: "", TMUX_PANE: "", TMUX_TMPDIR: dir, ...extraEnv };
  refuseOperatorSocket(implicitSocket(env), env);
  const tmux = async (args, options = {}) => execFile("tmux", ["-S", socket, ...args], { env, ...options });
  // Imported lazily: the preflight loads this file, and tmux.mjs must not be pinned before a test
  // sets AO_TMUX_COMMAND.
  const within = async (operation) => (await import("../../topology/lib/tmux.mjs")).withServer(socket, operation);
  const teardown = async () => { await killOwnedServer(env, socket); rmSync(dir, { recursive: true, force: true }); };
  t?.after?.(teardown);
  return { dir, socket, env, tmux, within, teardown };
}
