/**
 * TM-470: is the caller a dispatched worker? The ONE predicate every worker refusal uses.
 *
 * The env marker TM_DISPATCH_WORKER is pinned into a worker's pane at spawn, but the worker owns its
 * own environment: `env -u TM_DISPATCH_WORKER tm …` used to walk straight past every refusal. So the
 * marker may only ADD a worker, never remove one. What decides is recorded dispatch ancestry:
 *
 *   At dispatch, the pane pid of the worker's tmux session (its "anchor") is written to a registry
 *   OUTSIDE the worker's worktree, with the anchor's kernel start time. A caller is a worker when any
 *   pid in its /proc ancestry is a live anchor with that same start time (a recycled pid does not
 *   match). Every Bash call a worker makes, every `tm` it runs and every hook its harness fires runs
 *   below that pane, whatever it does to its env.
 *
 * The registry directory is derived from the passwd home (os.userInfo), not $HOME or XDG_STATE_HOME,
 * because those are env too. TM_WORKER_REGISTRY names an ADDITIONAL directory (tests, a relocated
 * dispatcher); it is consulted alongside the canonical one, never instead of it — env adds, never hides.
 *
 * For agent-orchestration (no import crosses the plugins): copy WORKER_RULE and `workerRecordFor`.
 * They are pure — the rule needs only the caller's ancestor pids and the recorded anchors.
 *
 * ponytail: a same-UID process can still delete the registry file or kill and re-parent itself. That
 * needs a deliberate attack on a file outside its worktree; the upgrade is a registry owned by another
 * uid. Anchors are recorded for the backends that report the pane pids they started (tmux, topology);
 * the others fall back to the env marker alone.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { userInfo } from "node:os";
import { join, resolve } from "node:path";

/** The rule, in words AO can copy verbatim next to its own copy of workerRecordFor. */
export const WORKER_RULE =
  "A caller is a dispatched worker when TM_DISPATCH_WORKER is set, OR when any pid in its process ancestry " +
  "(itself, then each parent up to init) equals a recorded worker anchor pid whose current start time equals " +
  "the recorded start time. Unsetting the env marker never makes a caller a non-worker.";

/** The canonical registry — passwd home, never $HOME. */
export function canonicalRegistry() {
  return join(userInfo().homedir, ".local", "state", "bytedesk", "task-management", "workers");
}

/** Where records are READ from: canonical first, plus TM_WORKER_REGISTRY when set. */
export function registryDirs(env = process.env) {
  const dirs = [canonicalRegistry()];
  if (env.TM_WORKER_REGISTRY) dirs.push(resolve(env.TM_WORKER_REGISTRY));
  return [...new Set(dirs)];
}

/** Where a dispatch WRITES its record: TM_WORKER_REGISTRY when set (tests), else the canonical one. */
export function writeRegistry(env = process.env) {
  return env.TM_WORKER_REGISTRY ? resolve(env.TM_WORKER_REGISTRY) : canonicalRegistry();
}

/** A process's kernel start time (clock ticks since boot), or null when it cannot be read. */
export function startTime(pid) {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    return stat.slice(stat.lastIndexOf(")") + 2).split(" ")[19] ?? null;
  } catch {
    return null;
  }
}

function parentPid(pid) {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    return Number(stat.slice(stat.lastIndexOf(")") + 2).split(" ")[1]) || null;
  } catch {
    try {
      return Number(execFileSync("ps", ["-o", "ppid=", "-p", String(pid)], { encoding: "utf8" }).trim()) || null;
    } catch {
      return null;
    }
  }
}

/** This pid, then each parent up to init — the same walk as agent-orchestration's ancestorPids (TM-416). */
export function ancestorPids(pid = process.pid) {
  const pids = [];
  for (let i = 0; i < 64 && pid > 1; i++) {
    pids.push(pid);
    const parent = parentPid(pid);
    if (!parent) break;
    pid = parent;
  }
  return pids;
}

/**
 * The pure rule (copy this into AO): the record whose anchor is one of `pids` and still the same
 * process, or null. `start(pid)` reads a live pid's start time.
 */
export function workerRecordFor(pids, records, start = startTime) {
  for (const pid of pids) {
    const rec = records.find((r) => r.pid === pid);
    if (rec && rec.start != null && String(start(pid)) === String(rec.start)) return rec;
  }
  return null;
}

/** Every record in the registry; a record whose anchor is gone or recycled is pruned. */
export function readRecords(dirs = registryDirs(), start = startTime) {
  const out = [];
  for (const dir of dirs) {
    let names = [];
    try {
      names = readdirSync(dir).filter((n) => n.endsWith(".json"));
    } catch {
      continue;
    }
    for (const name of names) {
      const file = join(dir, name);
      try {
        const rec = JSON.parse(readFileSync(file, "utf8"));
        if (String(start(rec.pid)) !== String(rec.start)) {
          rmSync(file, { force: true });
          continue;
        }
        out.push(rec);
      } catch {
        /* a torn or foreign file is not a record */
      }
    }
  }
  return out;
}

/**
 * `{ worker, via, record }` — via is "ancestry" when a recorded anchor is an ancestor (the record
 * then names the task, branch and governance), "env" when only the marker says so, null otherwise.
 * Ancestry is checked first so a worker that kept its marker still gets its record.
 */
export function isWorkerCaller({ env = process.env, pids = null, dirs = registryDirs(env), start = startTime } = {}) {
  const record = workerRecordFor(pids ?? ancestorPids(), readRecords(dirs, start), start);
  if (record) return { worker: true, via: "ancestry", record };
  if (env.TM_DISPATCH_WORKER) return { worker: true, via: "env", record: null };
  return { worker: false, via: null, record: null };
}

/** The task a worker caller may act on: its record's, else its env pin. */
export const workerTask = (who, env = process.env) => who.record?.task ?? env.TM_DISPATCH_TASK ?? null;

/** Pids out of backend output (a `-P -F '#{pane_pid}'` line, an AO binding), dropping anything else. */
export const pidsOf = (values) => [...new Set(values.map(Number).filter((n) => Number.isInteger(n) && n > 1))];

/** Record each anchor pid as a worker for `fields` (task, branch, integrationBranch, governed, root, run). */
export function recordWorker(pids, fields, { dir = writeRegistry(), start = startTime } = {}) {
  const written = [];
  for (const pid of pids) {
    const s = start(pid);
    if (s == null) continue;
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const file = join(dir, `${pid}.json`);
    writeFileSync(file, `${JSON.stringify({ ...fields, pid, start: s, at: new Date().toISOString() })}\n`, { mode: 0o600 });
    written.push(file);
  }
  return written;
}
