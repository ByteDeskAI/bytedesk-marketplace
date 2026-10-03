// Suite-end leak check (TM-298), loaded by the preflight. A run that leaves a tmux server, a
// supervisor or a provider CLI alive fails, and the failure names the process. Two ways to leak:
//   - a descendant that kept the run's environment: it carries AO_TEST_RUN, found through /proc;
//   - one that lost it — the managed services re-launch `supervise` with a scrubbed environment, so
//     it lands on the operator's default server (how TM-298's lead escaped). That one is found as a
//     NEW session on an operator socket whose panes started under the temp directory.
// Report only: it kills nothing, because the second kind lives on the operator's server.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { operatorSockets } from "./isolated-tmux.mjs";

// TM-310: a credential holder outlives its pane by this long so a respawn can re-attach. Every test process that loads this
// check (the preflight does, and so do the contract files, which CI runs without the preflight) must not wait the 20 s default
// for its own holders to exit, or the check below reports them as leaks.
process.env.AO_CREDS_GRACE_MS ||= "500";

// A test process must never reach the operator's real local NATS home (~/.bytedesk/agent-orchestration/nats): the
// per-agent credential tests provision users there, rewrite its state.json and reload the operator's live server, which
// is what happened during EP-026 (hundreds of test users in agent-users.json, old clients refused). Every process that loads
// this helper gets a private home; children inherit it unless a test passes a scrubbed env, which nats-local.mjs's own
// test-run guard then refuses (AO_TEST_RUN without AO_NATS_HOME throws instead of falling back to the real home).
if (!process.env.AO_NATS_HOME) {
  const natsHome = mkdtempSync(join(tmpdir(), "aot-nats-"));
  process.env.AO_NATS_HOME = natsHome;
  process.on("exit", () => { try { rmSync(natsHome, { recursive: true, force: true }); } catch {} });
}

/** Live processes other than `self` whose environment holds `marker` (`NAME=value`). Linux /proc only. */
export function markedProcesses(marker, { self = process.pid, proc = "/proc" } = {}) {
  let pids = [];
  try { pids = readdirSync(proc).filter((name) => /^[0-9]+$/.test(name) && Number(name) !== self); } catch { return []; }
  const found = [];
  for (const pid of pids) {
    try {
      if (!readFileSync(`${proc}/${pid}/environ`, "latin1").split("\0").includes(marker)) continue;
      const command = readFileSync(`${proc}/${pid}/cmdline`, "latin1").split("\0").filter(Boolean).join(" ");
      if (command) found.push({ pid: Number(pid), command }); // an empty cmdline is a zombie
    } catch { /* exited, or another user's */ }
  }
  return found;
}

/**
 * TM-330: process-compose service managers whose binary lives under `<tmp>/ao-*` — the private HOME
 * of a test fixture. The managed services scrub the environment, so these carry no AO_TEST_RUN and
 * the marker scan cannot see them; the path is the only tie to a test. Pass the pids seen at run
 * start as `ignore`: older ones belong to other sessions and are only counted, never reported.
 */
export function serviceManagersUnder(tmp = tmpdir(), { proc = "/proc", ignore = new Set() } = {}) {
  let pids = [];
  try { pids = readdirSync(proc).filter((name) => /^[0-9]+$/.test(name)); } catch { return []; }
  const found = [];
  for (const pid of pids) {
    if (ignore.has(Number(pid))) continue;
    try {
      const argv = readFileSync(`${proc}/${pid}/cmdline`, "latin1").split("\0").filter(Boolean);
      if (/(^|\/)process-compose(-v[0-9.]+)?(\.exe)?$/.test(argv[0] ?? "") && argv[0].startsWith(`${tmp}/ao-`)) found.push({ pid: Number(pid), command: argv.join(" ") });
    } catch { /* exited, or another user's */ }
  }
  return found;
}

/**
 * `socket\tsession\tstart paths` for every session on an operator socket. Read-only: list-sessions
 * and list-panes never start a server, and nothing here writes to one.
 */
export function operatorSessions(env = process.env) {
  const rows = new Map();
  for (const socket of new Set(operatorSockets(env))) {
    let out = "";
    try {
      out = execFileSync("tmux", ["-S", socket, "list-panes", "-a", "-F", "#{session_name}\t#{pane_start_path}"],
        { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], env: { ...env, TMUX: "" } });
    } catch { continue; } // no server on that socket
    for (const line of out.split("\n").filter(Boolean)) {
      const [session, path] = line.split("\t");
      const key = `${socket}\t${session}`;
      rows.set(key, [...(rows.get(key) ?? []), path]);
    }
  }
  return rows;
}

/** Sessions in `after` and not in `before` whose panes started under `tmp` — test-made, not operator-made. */
export function escapedSessions(before, after, tmp = tmpdir()) {
  // ponytail: "started under the temp dir" is the test-made signal; an operator session opened in /tmp
  // during a run would be reported too. Tighten to the run's own mkdtemp prefixes if that ever happens.
  return [...after].filter(([key, paths]) => !before.has(key) && paths.some((path) => path === tmp || path.startsWith(`${tmp}/`)))
    .map(([key, paths]) => ({ server: key.split("\t")[0], session: key.split("\t")[1], cwd: paths[0] }));
}

const sleepSync = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

if (!process.env.AO_TEST_RUN) {
  process.env.AO_TEST_RUN = `${process.pid}-${Date.now()}`;
  const marker = `AO_TEST_RUN=${process.env.AO_TEST_RUN}`;
  const before = operatorSessions();
  const serviceManagersAtStart = new Set(serviceManagersUnder().map(({ pid }) => pid));
  process.on("exit", () => {
    // A teardown's SIGTERM may still be in flight when the last test file exits.
    let alive = markedProcesses(marker);
    for (let i = 0; i < 30 && (alive.length || serviceManagersUnder(tmpdir(), { ignore: serviceManagersAtStart }).length); i += 1) { sleepSync(100); alive = markedProcesses(marker); }
    const escaped = escapedSessions(before, operatorSessions());
    // TM-330: a service manager started during this run, from a /tmp/ao-* home, that is still alive.
    const managers = serviceManagersUnder(tmpdir(), { ignore: serviceManagersAtStart }).filter((m) => !alive.some((a) => a.pid === m.pid));
    alive = [...alive, ...managers];
    if (!alive.length && !escaped.length) return;
    process.stderr.write(`\nTM-298 suite-end check: the run left ${alive.length} process(es) and ${escaped.length} operator tmux session(s) behind:\n`);
    for (const { pid, command } of alive) process.stderr.write(`  pid ${pid}: ${command}\n`);
    for (const { server, session, cwd } of escaped) process.stderr.write(`  session ${session} on ${server} (cwd ${cwd})\n`);
    process.exitCode = 1;
  });
}
