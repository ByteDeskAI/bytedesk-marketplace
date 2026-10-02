// Suite-end leak check (TM-298), loaded by the preflight. A run that leaves a tmux server, a
// supervisor or a provider CLI alive fails, and the failure names the process. Two ways to leak:
//   - a descendant that kept the run's environment: it carries AO_TEST_RUN, found through /proc;
//   - one that lost it — the managed services re-launch `supervise` with a scrubbed environment, so
//     it lands on the operator's default server (how TM-298's lead escaped). That one is found as a
//     NEW session on an operator socket whose panes started under the temp directory.
// Report only: it kills nothing, because the second kind lives on the operator's server.
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";

import { operatorSockets } from "./isolated-tmux.mjs";

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
  process.on("exit", () => {
    // A teardown's SIGTERM may still be in flight when the last test file exits.
    let alive = markedProcesses(marker);
    for (let i = 0; i < 30 && alive.length; i += 1) { sleepSync(100); alive = markedProcesses(marker); }
    const escaped = escapedSessions(before, operatorSessions());
    if (!alive.length && !escaped.length) return;
    process.stderr.write(`\nTM-298 suite-end check: the run left ${alive.length} process(es) and ${escaped.length} operator tmux session(s) behind:\n`);
    for (const { pid, command } of alive) process.stderr.write(`  pid ${pid}: ${command}\n`);
    for (const { server, session, cwd } of escaped) process.stderr.write(`  session ${session} on ${server} (cwd ${cwd})\n`);
    process.exitCode = 1;
  });
}
