/**
 * Is this record ME? — the one predicate every surface a worker reads must share.
 *
 * TM-236 (gateway TM-455): a dispatched worker read the `worker-bound` event ao-topology had
 * written on its own task — `tm-TM-455`, pane `%879`, pid `1607748` — and concluded another
 * session was already working it. The pid was its own. It exited without working. Nothing it
 * could read said "this record is you": the env marked it a worker (TM_DISPATCH_WORKER) but
 * carried no session, pane or pid, and `tm show` printed the record as any other comment.
 *
 * Three facts identify the caller, all inherited by every process under the worker's harness:
 *   TM_DISPATCH_RUN  the run id the backend reported (`tmux:tm-TM-455`, `topology:<session>`),
 *                    pinned at spawn by workerEnv() — the same string dispatch() records and
 *                    ao-topology copies into the bound worker.
 *   TMUX_PANE        set by tmux for the pane's process tree; the bound record's binding.paneId.
 *   own pids         this process and its ancestors (/proc walk): the pane process — claude —
 *                    is an ancestor of the `tm` that reads the record, so a record naming its
 *                    pid names the reader.
 *
 * TM_SESSION_ID is deliberately NOT a self signal: the dispatcher injects its own session id into
 * the worker, so the lead that started the worker shares it and would read the worker as itself.
 */
import { readFileSync } from "node:fs";

/** This process and every ancestor, from /proc (Linux); elsewhere just pid and ppid. */
export function ownPids(pid = process.pid) {
  const pids = new Set([process.pid, process.ppid].filter((n) => n > 1));
  let cur = pid;
  // ponytail: the walk reaches the tmux server too; records only ever name a pane or worker pid,
  // never a server, so an ancestor match is always the reader's own pane. init (pid 1) is every
  // process's ancestor and no worker's identity, so it is never in the set.
  for (let hops = 0; hops < 64 && cur > 1; hops += 1) {
    let stat;
    try {
      stat = readFileSync(`/proc/${cur}/stat`, "utf8");
    } catch {
      break;
    }
    const ppid = Number(stat.slice(stat.lastIndexOf(")") + 2).split(" ")[1]);
    if (!Number.isInteger(ppid) || ppid <= 1) break;
    pids.add(cur);
    pids.add(ppid);
    cur = ppid;
  }
  return pids;
}

/** Who is asking, from the environment the worker's harness passed down. */
export function selfIdentity(env = process.env, pids = ownPids()) {
  return { run: env.TM_DISPATCH_RUN || null, pane: env.TMUX_PANE || null, pids };
}

/**
 * Does `entry` name the caller? Accepts every shape a worker meets: the task's `dispatched`
 * record ({ run }), a registry row ({ runId, pid }), ao-topology's bound worker ({ run,
 * binding: { paneId, panePid } } or { pid }), or a topology worker's native members.
 */
export function isSelf(entry, self = selfIdentity()) {
  if (!entry || typeof entry !== "object") return false;
  const run = entry.run ?? entry.runId;
  if (self.run && run && run === self.run) return true;
  const panes = [entry.paneId, entry.pane, entry.binding?.paneId, ...(entry.native_identity?.members ?? []).flatMap((m) => [m.pane, m.binding?.paneId])];
  if (self.pane && panes.includes(self.pane)) return true;
  const pids = [entry.pid, entry.panePid, entry.binding?.panePid];
  return pids.some((pid) => Number.isInteger(pid) && self.pids.has(pid));
}

/** A comment that is one of ao-topology's JSON events, or null. */
function eventIn(text) {
  try {
    const ev = JSON.parse(String(text ?? ""));
    return ev && typeof ev === "object" && typeof ev.event === "string" ? ev : null;
  } catch {
    return null;
  }
}

/** What the marker says next to a record; the same words on every surface. */
export const SELF_MARK = "← self: this names your own run/pane/pid — you are the bound worker, not a second one";

/**
 * The task as `tm show` should print it: `dispatched.self` and `comments[].self` are true on
 * the entries that name the caller. Pure — returns a copy, never touches the store.
 */
export function markSelf(doc, self = selfIdentity()) {
  if (!doc || typeof doc !== "object") return doc;
  const out = { ...doc };
  if (doc.dispatched && isSelf(doc.dispatched, self)) out.dispatched = { ...doc.dispatched, self: true };
  if (Array.isArray(doc.comments)) {
    out.comments = doc.comments.map((c) => {
      const ev = eventIn(c?.text);
      return ev && (isSelf(ev.worker, self) || isSelf(ev, self)) ? { ...c, self: true } : c;
    });
  }
  return out;
}
