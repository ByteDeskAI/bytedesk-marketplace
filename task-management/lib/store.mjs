/**
 * Markdown-first store. One file per entity, frontmatter + body.
 * index.json is a derived cache — deleting it must never lose data (`tm reindex`).
 *
 * ponytail: frontmatter values are serialized as JSON, which is a valid YAML
 * subset, so we get round-trippable typing with no YAML dependency. Nested
 * objects work but stay on one line; if that ever gets ugly, swap in a real
 * YAML lib behind parseDoc/serializeDoc.
 */
import { appendFileSync, closeSync, statSync, existsSync, openSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync, writeSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { KINDS, ensureDirs, paths } from "./paths.mjs";
import { actor, actorLabel } from "./actor.mjs";
import { notifyEvent } from "./notify-hook.mjs";

const DEFAULT_CONFIG = {
  enforce: true,
  requireEpic: true,
  requireAcceptance: true,
  wipLimit: 3,
  staleMinutes: 90,
  gitLink: true,
  captureDecisions: "smart",
  autoCloseEpics: true,
  eventMaxBytes: 5_000_000,
  claimTtlMinutes: 240,
};

export const now = () => new Date().toISOString();

// ── frontmatter ──────────────────────────────────────────────────────────────

export function parseDoc(text) {
  if (!text.startsWith("---\n")) return { data: {}, body: text };
  const end = text.indexOf("\n---", 4);
  if (end === -1) return { data: {}, body: text };
  const data = {};
  for (const line of text.slice(4, end).split("\n")) {
    const m = /^([A-Za-z0-9_]+):\s*(.*)$/.exec(line);
    if (!m) continue;
    const [, key, raw] = m;
    try {
      data[key] = raw === "" ? "" : JSON.parse(raw);
    } catch {
      data[key] = raw;
    }
  }
  return { data, body: text.slice(end + 4).replace(/^\n/, "") };
}

export function serializeDoc(data, body = "") {
  const lines = Object.entries(data)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}: ${JSON.stringify(v)}`);
  return `---\n${lines.join("\n")}\n---\n\n${body.replace(/^\n+/, "")}`;
}

export function slug(s, max = 48) {
  return String(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, max) || "untitled";
}

// ── low-level io ─────────────────────────────────────────────────────────────

/**
 * The temp name carries the pid, and is deliberately built so it does NOT begin with the
 * entity id.
 *
 * The pid is because a fixed `${file}.tmp` is only atomic for one writer: two processes
 * writing the same doc both create it, both rename, and the loser's rename hits a path the
 * winner already moved.
 *
 * The prefix is because `fileFor` resolves an id by directory prefix. `TM-001-title.md.99.tmp`
 * starts with `TM-001-`, so a temp file left behind by a process that died between the write
 * and the rename was a candidate answer for "where does TM-001 live". A crash during *create*
 * left a phantom: `tm show TM-001` rendered it, `tm board` never listed it (list() filters
 * `.md`), `tm doctor` said "no problems found", `nextId` counted it so the id was burned, and
 * you could add criteria to it, comment on it and `tm start` it — leaving a task in_progress
 * that even the Stop gate could not see.
 *
 * `.tm-tmp-<pid>-<name>` cannot collide: the leading dot and prefix mean it never matches
 * `${id}-`, and `fileFor` now requires `.md` as well. Two independent guards, because this
 * one failed silently and a single guard here is one typo from failing silently again.
 */
function writeAtomic(file, text) {
  const dir = dirname(file);
  const tmp = join(dir, `.tm-tmp-${process.pid}-${basename(file)}`);
  writeFileSync(tmp, text);
  renameSync(tmp, file);
}

function readJson(file, fallback) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

// ── cross-process locking ────────────────────────────────────────────────────

/** A lock older than this is assumed to belong to a process that died mid-write. */
export const LOCK_STALE_MS = 30_000;
const LOCK_RETRY_MS = 15;

/**
 * Serialize a read-modify-write across processes. One store is now shared by every
 * worktree, so "two sessions claim at the same instant" is a real event, not a
 * theoretical one — and an unlocked read-modify-write silently drops one of them.
 *
 * ponytail: `open(…, "wx")` is the atomic primitive; no lockfile dependency needed.
 * Single lock for the whole store — per-entity locks only if contention ever shows up.
 */
let heldDepth = 0;

export function withLock(p = paths(), fn) {
  // Reentrant within a process: release() wraps writeState(), which also locks.
  // Only the outermost call touches the file, or a caller deadlocks against itself.
  if (heldDepth > 0) {
    heldDepth += 1;
    try {
      return fn();
    } finally {
      heldDepth -= 1;
    }
  }
  const lock = join(p.base, "state.lock");
  const deadline = Date.now() + LOCK_STALE_MS;
  let fd;
  for (;;) {
    try {
      fd = openSync(lock, "wx");
      break;
    } catch (err) {
      if (err.code !== "EEXIST") throw err;
      if (staleLock(lock) || Date.now() > deadline) {
        try {
          unlinkSync(lock);
        } catch {
          /* someone else just broke it — retry */
        }
        continue;
      }
      sleep(LOCK_RETRY_MS);
    }
  }
  try {
    writeSync(fd, JSON.stringify({ pid: process.pid, ts: now() }));
    closeSync(fd);
    fd = undefined;
    heldDepth = 1;
    return fn();
  } finally {
    heldDepth = 0;
    if (fd !== undefined) closeSync(fd);
    try {
      unlinkSync(lock);
    } catch {
      /* already gone */
    }
  }
}

/** Exported for the unit that pins the empty-lock window; not part of the store API. */
export function staleLock(lock) {
  let raw;
  try {
    raw = readFileSync(lock, "utf8");
  } catch {
    return true; // it vanished; whoever held it is done
  }
  try {
    const { ts, pid } = JSON.parse(raw);
    if (Date.now() - Date.parse(ts) > LOCK_STALE_MS) return true;
    if (pid && pid !== process.pid) {
      try {
        process.kill(pid, 0);
      } catch (err) {
        return err.code === "ESRCH"; // holder is gone
      }
    }
    return false;
  } catch {
    /**
     * Unparseable is NOT automatically dead, and assuming it was is what made this lock
     * breakable under the exact contention it exists for.
     *
     * `openSync(lock, "wx")` creates the file EMPTY and the pid is written a moment
     * later. A second process arriving inside that window read "", failed to parse it,
     * concluded the lock was dead, unlinked it and walked straight in — so both
     * processes held the lock at once. That is how eight concurrent creates still minted
     * duplicate ids after create() was wrapped: the wrapping was fine, the lock was not.
     *
     * Fall back to the file's own mtime: a freshly created empty lock is young, so it is
     * respected, and a genuinely corrupt one still ages out.
     */
    try {
      return Date.now() - statSync(lock).mtimeMs > LOCK_STALE_MS;
    } catch {
      return true;
    }
  }
}

/** Block without a busy-spin. Atomics.wait is the only synchronous sleep in node. */
function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

export function config(p = paths()) {
  return { ...DEFAULT_CONFIG, ...readJson(p.config, {}) };
}

export function writeConfig(patch, p = paths()) {
  const next = { ...config(p), ...patch };
  writeAtomic(p.config, `${JSON.stringify(next, null, 2)}\n`);
  return next;
}

/**
 * Drop a task's session claim. Any exit from `in_progress` releases — v0.1 only did
 * this on `done`, so parked and blocked tasks kept a lock nobody could see or clear.
 */
export function release(id, p = paths()) {
  const released = withLock(p, () => {
    const claims = { ...state(p).claims };
    if (!(id in claims)) return false;
    delete claims[id];
    writeStateUnlocked({ claims }, p);
    return true;
  });
  if (released) logEvent("release", { id }, p);
  return released;
}

export function state(p = paths()) {
  return readJson(p.state, { activeEpic: null, claims: {}, override: null, lastStopBlock: null });
}

/** Locked read-modify-write. Use this everywhere except inside an existing withLock. */
export function writeState(patch, p = paths()) {
  return withLock(p, () => writeStateUnlocked(patch, p));
}

function writeStateUnlocked(patch, p = paths()) {
  const next = { ...state(p), ...patch };
  writeAtomic(p.state, `${JSON.stringify(next, null, 2)}\n`);
  return next;
}

/** Append-only audit log. Never throws — a broken log must not break a hook. */
export function logEvent(event, fields = {}, p = paths()) {
  try {
    ensureDirs(p);
    appendFileSync(
      p.events,
      `${JSON.stringify({
        ts: now(),
        event,
        session: process.env.CLAUDE_SESSION_ID || null,
        actor: actorLabel(actor()),
        ...fields,
      })}\n`,
    );
  } catch {
    /* ignore */
  }
  // Fire-and-forget push. Never awaited, never allowed to throw: a notifier must
  // not be able to fail a hook or a CLI command.
  try {
    notifyEvent({ event, actor: actorLabel(actor()), ...fields }, p);
  } catch {
    /* ignore */
  }
}

/**
 * Roll the log once it passes eventMaxBytes. One generation back is kept —
 * `events.1.jsonl` — because the log is the audit trail, not a scratch file.
 * ponytail: single generation; add events.2 if anyone ever needs deeper history.
 */
export function rotateEvents(p = paths()) {
  const max = config(p).eventMaxBytes ?? DEFAULT_CONFIG.eventMaxBytes;
  if (!max || !existsSync(p.events)) return false;
  try {
    if (statSync(p.events).size < max) return false;
    renameSync(p.events, `${p.events.replace(/\.jsonl$/, "")}.1.jsonl`);
    // Start the new log immediately: the dashboard tails this path, and a file that
    // vanishes mid-session is a broken feed.
    writeFileSync(p.events, "");
    return true;
  } catch {
    return false;
  }
}

/** Every event, oldest first, across the rotation boundary. Bad lines are skipped. */
export function readEvents(p = paths()) {
  const files = [`${p.events.replace(/\.jsonl$/, "")}.1.jsonl`, p.events];
  const rows = [];
  for (const file of files) {
    if (!existsSync(file)) continue;
    for (const line of readFileSync(file, "utf8").split("\n")) {
      if (!line.trim()) continue;
      try {
        rows.push(JSON.parse(line));
      } catch {
        /* a torn or hand-edited line must not cost us the rest of the history */
      }
    }
  }
  return rows.sort((a, b) => String(a.ts).localeCompare(String(b.ts)));
}

/**
 * Close an epic whose children are all finished. Returns whether it closed.
 * A childless epic is a new epic, not a finished one — never close those.
 */
export function autoCloseEpic(epicId, p = paths()) {
  if (!epicId || config(p).autoCloseEpics === false) return false;
  const epic = read(epicId, p);
  if (!epic || epic.status === "done") return false;
  const kids = list("task", { epic: epicId }, p);
  if (kids.length === 0 || kids.some((t) => t.status !== "done")) return false;
  update(epicId, { status: "done", closed: now() }, p);
  logEvent("epic_auto_closed", { id: epicId, tasks: kids.length }, p);
  return true;
}

// ── entities ─────────────────────────────────────────────────────────────────

function dirFor(kind, p) {
  const spec = KINDS[kind];
  if (!spec) throw new Error(`unknown kind: ${kind}`);
  return p[spec.dir];
}

/**
 * Which entity an id belongs to, or null. Takes anything: plenty of events
 * (init, notification, rotation) carry no id at all, and callers shouldn't
 * have to guard before asking.
 */
export function kindOf(id) {
  if (typeof id !== "string") return null;
  for (const [kind, spec] of Object.entries(KINDS)) {
    if (id.startsWith(`${spec.prefix}-`)) return kind;
  }
  return null;
}

export function fileFor(id, p = paths()) {
  const kind = kindOf(id);
  if (!kind) return null;
  const dir = dirFor(kind, p);
  if (!existsSync(dir)) return null;
  // `.md` only. Without it, any leftover file whose name begins with the id — a temp from a
  // write that died before its rename — is a candidate answer for where this entity lives,
  // and `read()`/`update()` would then operate on a file that `list()` cannot see.
  const hit = readdirSync(dir).find((f) => f.endsWith(".md") && (f.startsWith(`${id}-`) || f === `${id}.md`));
  return hit ? join(dir, hit) : null;
}

export function nextId(kind, p = paths()) {
  const { prefix, pad } = KINDS[kind];
  const dir = dirFor(kind, p);
  // `.md` only, for the same reason fileFor filters: a temp file from an interrupted write
  // named after the id it was destined for used to reserve that number, so the id was burned
  // — the next real task skipped it and nothing ever occupied it.
  const nums = existsSync(dir)
    ? readdirSync(dir)
        .filter((f) => f.endsWith(".md"))
        .map((f) => new RegExp(`^${prefix}-(\\d+)`).exec(f))
        .filter(Boolean)
        .map((m) => Number(m[1]))
    : [];
  return `${prefix}-${String(Math.max(0, ...nums) + 1).padStart(pad, "0")}`;
}

export function read(id, p = paths()) {
  const file = fileFor(id, p);
  if (!file) return null;
  const { data, body } = parseDoc(readFileSync(file, "utf8"));
  return { ...data, id: data.id || id, body, file };
}

export function write(doc, p = paths()) {
  const { body = "", file, ...data } = doc;
  const target = file || join(dirFor(kindOf(data.id), p), `${data.id}-${slug(data.title)}.md`);
  ensureDirs(p);
  const stamped = { ...data, updated: now() };
  writeAtomic(target, serializeDoc(stamped, body));
  patchIndex(stamped, p);
  return { ...doc, file: target };
}

/**
 * Update one row in index.json. v0.1 rescanned every file on every write, which is
 * O(store) for an O(1) change — invisible at 50 tasks, not at 5,000.
 */
function patchIndex(entity, p = paths()) {
  const key = KINDS[kindOf(entity.id)]?.dir;
  if (!key) return;
  try {
    const index = readJson(p.index, null) || reindex(p);
    const rows = (index[key] || []).filter((row) => row.id !== entity.id);
    if (entity.status !== "deleted") rows.push(entity);
    index[key] = rows.sort((a, b) => String(a.id).localeCompare(String(b.id)));
    index.generated = now();
    writeAtomic(p.index, `${JSON.stringify(index, null, 2)}\n`);
  } catch {
    /* the index is a cache — a failed patch is recoverable with `tm reindex` */
  }
}

/**
 * `nextId` and `write` have to be one atomic unit.
 *
 * `nextId` picks max(existing)+1 by reading the directory. Two processes that read it
 * before either has written both pick the same number, and both write — so the store
 * ends up with two files claiming one id. That is not a cosmetic clash: `fileFor` finds
 * an id with `readdirSync(dir).find(f => f.startsWith(`${id}-`))`, so one of the two
 * files becomes permanently unaddressable. `tm show`, `tm start` and `tm done` can never
 * reach it again, and nothing reports it. Measured before this lock: 8 concurrent
 * `tm task new` produced 8 files with 7 distinct ids and 6 rows in index.json.
 */
export function create(kind, fields, body = "", p = paths()) {
  ensureDirs(p);
  const doc = withLock(p, () => {
    const id = fields.id || nextId(kind, p);
    return write({ id, kind, status: "open", created: now(), ...fields, body }, p);
  });
  logEvent("create", { id: doc.id, kind, title: doc.title }, p);
  return doc;
}

/**
 * Read-modify-write under the lock, so a concurrent writer cannot land between the read
 * and the write and lose its own change. `patchIndex` inside `write` is a whole-file
 * read-modify-write of index.json too, which is where the missing index rows came from.
 *
 * NOTE for callers: this only protects the read THIS function does. A caller that reads
 * the doc itself, computes a new value from it and then calls update is still racing —
 * use `mutate` for that.
 */
export function update(id, patch, p = paths()) {
  return withLock(p, () => {
    const doc = read(id, p);
    if (!doc) throw new Error(`not found: ${id}`);
    const next = write({ ...doc, ...patch }, p);
    logEvent("update", { id, patch: Object.keys(patch).join(","), status: next.status }, p);
    return next;
  });
}

/**
 * Append-style edits, safely: `mutate(id, doc => ({ comments: [...doc.comments, c] }))`.
 *
 * Wrapping `update` alone does not help the common shape in this codebase, which is
 * "read the doc, append to one of its arrays, write it back". Both processes read the
 * same array, both append one item, and the second write overwrites the first — the
 * update is atomic and the change is still gone. Measured before this: 8 concurrent
 * `tm comment` on one task stored 5 of 8, and 7 of the 8 processes exited 0.
 *
 * The callback runs INSIDE the lock and receives the current doc, so it must be pure
 * and quick — no shelling out, no network.
 */
export function mutate(id, fn, p = paths()) {
  return withLock(p, () => {
    const doc = read(id, p);
    if (!doc) throw new Error(`not found: ${id}`);
    return update(id, fn(doc), p);
  });
}

/**
 * Deleted entities stay on disk (the event log points at them) but must not appear
 * in listings, counts, or the duplicate guard. Ask for them explicitly to see them.
 */
export function list(kind, filter = {}, p = paths()) {
  const dir = dirFor(kind, p);
  if (!existsSync(dir)) return [];
  const { includeDeleted, ...match } = filter;
  const wantDeleted = includeDeleted || match.status === "deleted";
  return readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .map((f) => {
      const { data, body } = parseDoc(readFileSync(join(dir, f), "utf8"));
      return { ...data, body, file: join(dir, f) };
    })
    .filter((d) => wantDeleted || d.status !== "deleted")
    .filter((d) => Object.entries(match).every(([k, v]) => (v === undefined ? true : d[k] === v)))
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));
}

/** Rebuild index.json from the markdown files. Cheap enough to run on every write. */
export function reindex(p = paths()) {
  const index = { generated: now(), epics: [], tasks: [], adrs: [] };
  for (const [kind, key] of [["epic", "epics"], ["task", "tasks"], ["adr", "adrs"]]) {
    index[key] = list(kind, {}, p).map(({ body, file, ...rest }) => rest);
  }
  try {
    writeAtomic(p.index, `${JSON.stringify(index, null, 2)}\n`);
  } catch {
    /* index is a cache; failure is survivable */
  }
  return index;
}

// ── derived views ────────────────────────────────────────────────────────────

export const OPEN = new Set(["open", "in_progress", "blocked"]);
/** A blocker stops blocking once it is finished — or gone. */
export const RESOLVED = new Set(["done", "deleted"]);

export function openTasks(p = paths()) {
  return list("task", {}, p).filter((t) => OPEN.has(t.status));
}

/** A `blocked` status with a written reason is a human decision, not a dependency. */
function blockedByDependency(task) {
  return task.status === "blocked" && !task.blockedReason;
}

function dependenciesMet(task, byId) {
  return (task.blockedBy || []).every((d) => {
    const blocker = byId.get(d);
    return !blocker || RESOLVED.has(blocker.status);
  });
}

/**
 * Startable work: open (or dependency-blocked) tasks whose blockers are all resolved.
 * Dependency-blocked tasks are included so `next` is correct even if nothing has run
 * an unblock pass yet — the graph is evaluated, not merely stored.
 */
export function nextTasks(p = paths()) {
  const all = list("task", { includeDeleted: true }, p);
  const byId = new Map(all.map((t) => [t.id, t]));
  return all.filter(
    (t) =>
      (t.status === "open" || blockedByDependency(t)) &&
      !RESOLVED.has(t.status) &&
      dependenciesMet(t, byId),
  );
}

/** Reopen everything that was only waiting on `id`. Returns the ids it freed. */
export function unblockDependents(id, p = paths()) {
  const all = list("task", { includeDeleted: true }, p);
  const byId = new Map(all.map((t) => [t.id, t]));
  const freed = [];
  for (const task of all) {
    if (!(task.blockedBy || []).includes(id)) continue;
    if (!blockedByDependency(task) || !dependenciesMet(task, byId)) continue;
    update(task.id, { status: "open" }, p);
    logEvent("unblocked", { id: task.id, by: id }, p);
    freed.push(task.id);
  }
  return freed;
}

export function staleTasks(p = paths()) {
  const cutoff = Date.now() - config(p).staleMinutes * 60_000;
  return list("task", { status: "in_progress" }, p).filter((t) => Date.parse(t.updated || 0) < cutoff);
}

export function acceptanceOpen(task) {
  return (task.acceptance || []).filter((a) => !a.done);
}
