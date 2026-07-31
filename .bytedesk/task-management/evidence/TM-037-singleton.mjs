/**
 * One dashboard per project. The store path is the key: it proves ownership of
 * the pid file, so a recycled pid from an unrelated process is never mistaken
 * for a live board, and it seeds the search for the project's port.
 *
 * The port itself is *assigned once* and kept: probed free above 45000 on first
 * launch, written to dashboard.assigned-port, and reused on every later launch
 * so a project always opens at the same URL.
 *
 * ponytail: pid file + kill(pid, 0) is the whole lock, and the assignment lives
 * in its own file rather than config.json — config.json is the user's to edit
 * and `tm config` rewrites it wholesale. Upgrade path if this ever races badly:
 * an O_EXCL create on dashboard.pid instead of a plain write.
 */
import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";

/** Above the registered range and below the usual ephemeral floor (32768 is Linux's, 45000 clears the common ones). */
export const MIN_PORT = 45001;
export const PORT_SPAN = 15000;

const pidFile = (p) => join(p.base, "dashboard.pid");
const portFile = (p) => join(p.base, "dashboard.port");
/**
 * The standing port assignment.
 *
 * NOT named `dashboard.*` on purpose. The pid and the live port are transient — every tool that
 * tidies a store sweeps `dashboard.*`, and the store's own .gitignore names that glob — but the
 * assignment is the only record of a port that *drifted* off the deterministic one because
 * something else held it. Sweeping it with the pid file is what moved a running board's URL:
 * portFor() re-derives the natural port, so the drift, and only the drift, is lost.
 */
const assignFile = (p) => join(p.base, "port.assigned");
/** Pre-0.5 assignments. Read once, then rewritten under the durable name. */
const legacyAssignFile = (p) => join(p.base, "dashboard.assigned-port");

/** FNV-1a, 32-bit. Stable across runs and machines — Math.random and hash() are not. */
function hash(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

/** Where this project starts probing. Different projects start far apart. */
export function portFor(storePath) {
  return MIN_PORT + (hash(String(storePath)) % PORT_SPAN);
}

/** The port this project was given, or null if it has never been assigned one. */
export function assignedPort(p) {
  return readPort(assignFile(p), MIN_PORT) ?? readPort(legacyAssignFile(p), MIN_PORT);
}

export function assignPort(p, port) {
  writeFileSync(assignFile(p), `${port}\n`);
  return port;
}

/** Free means it binds. Anything less is a guess. */
function bindable(port) {
  return new Promise((resolve) => {
    const s = createServer();
    s.once("error", () => resolve(false));
    s.listen(port, "127.0.0.1", () => s.close(() => resolve(true)));
  });
}

/** The first port that actually binds, wrapping inside the range. */
export async function findFreePort(start, tries = 200) {
  const from = Number.isInteger(start) && start >= MIN_PORT ? start : MIN_PORT;
  for (let i = 0; i < tries; i += 1) {
    const port = MIN_PORT + ((from - MIN_PORT + i) % PORT_SPAN);
    if (await bindable(port)) return port;
  }
  throw new Error(`no free port above ${MIN_PORT} after ${tries} tries`);
}

/**
 * The port to listen on: the env override, else the standing assignment, else a
 * fresh one. `keep` holds the assignment through a restart, where the port is
 * briefly still held by the incumbent we just evicted.
 */
export async function ensurePort(p, { override, keep = false } = {}) {
  const forced = Number.parseInt(override ?? "", 10);
  if (Number.isInteger(forced) && forced > 0) return { port: forced, source: "env", previous: null };

  const assigned = assignedPort(p);
  if (assigned && (keep || (await bindable(assigned)))) {
    // Migrate a pre-0.5 assignment on first use: read from either name, write only the durable
    // one, so the next `dashboard.*` sweep cannot take it.
    if (!existsSync(assignFile(p))) assignPort(p, assigned);
    return { port: assigned, source: "assigned", previous: null };
  }
  const port = await findFreePort(assigned ? assigned + 1 : portFor(p.base));
  assignPort(p, port);
  return { port, source: assigned ? "reassigned" : "new", previous: assigned };
}

function readPort(file, floor = 1) {
  try {
    const n = Number.parseInt(readFileSync(file, "utf8").trim(), 10);
    return Number.isInteger(n) && n >= floor ? n : null;
  } catch {
    return null;
  }
}

const recordedPort = (p) => readPort(portFile(p));

/** The recorded instance, or null when there is no readable one. */
export function readInstance(p) {
  try {
    const raw = JSON.parse(readFileSync(pidFile(p), "utf8"));
    // Pre-singleton files held a bare pid. They can only have come from this store.
    const inst = typeof raw === "number" ? { pid: raw, store: p.base } : raw;
    if (!Number.isInteger(inst?.pid) || inst.pid <= 0) return null;
    return { ...inst, store: inst.store ?? p.base, port: inst.port ?? recordedPort(p) };
  } catch {
    return null;
  }
}

export function writeInstance(p, { pid, port }) {
  const record = { pid, port, store: p.base, started: new Date().toISOString() };
  writeFileSync(pidFile(p), `${JSON.stringify(record)}\n`);
  writeFileSync(portFile(p), `${port}\n`); // documented discovery file — keep it a bare number
  return record;
}

const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === "EPERM"; // running, just not ours to signal
  }
};

/** The instance actually serving this store right now, or null. */
export function liveInstance(p) {
  const inst = readInstance(p);
  if (!inst || inst.store !== p.base) return null; // foreign owner ⇒ a recycled pid, not our board
  return alive(inst.pid) ? inst : null;
}

/** Stop whatever is serving this store and release the lock. Safe when nothing is. */
export function takeover(p) {
  const inst = liveInstance(p);
  if (inst && inst.pid !== process.pid) {
    try {
      process.kill(inst.pid, "SIGTERM");
    } catch {
      /* already gone */
    }
  }
  if (readInstance(p)?.store === p.base) release(p);
  return inst;
}

/** Remove the pid file if it is still ours (or unowned). */
export function release(p) {
  try {
    if (existsSync(pidFile(p))) unlinkSync(pidFile(p));
  } catch {
    /* ignore */
  }
}
