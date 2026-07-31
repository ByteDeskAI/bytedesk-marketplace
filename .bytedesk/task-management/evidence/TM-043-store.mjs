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
import { KINDS, boardId, gitBoardId, ensureDirs, paths } from "./paths.mjs";
import { actor, actorLabel, sessionId } from "./actor.mjs";
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


/**
 * An entity file, as opposed to one of our own staging files.
 *
 * `writeAtomic` stages at `.tm-tmp-<pid>-<name>` — which ENDS IN `.md`, because it is built from
 * the target's basename. Every reader here globs `.endsWith(".md")`, so a reader could see another
 * process's staging file in `readdirSync`, then `renameSync` moved it, then `readFileSync` opened a
 * path that no longer existed:
 *
 *   tm task: ENOENT: no such file or directory, open '…/tasks/.tm-tmp-3705640-TM-003-….md'
 *
 * That is the create that never wrote a file, and the whole of TM-015's residue: eight concurrent
 * creates producing seven files, seven ids and seven index rows. It needed a second process writing
 * at the exact moment a first was listing, which is why it only ever appeared with several suites
 * running at once and never on its own.
 *
 * The comment above `writeAtomic` claimed the leading dot meant it "never matches". The dot was
 * never consulted — the filter asked about the extension. Now it is consulted.
 */
const isEntityFile = (name) => name.endsWith(".md") && !name.startsWith(".");

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

/**
 * How long to wait for the lock before refusing.
 *
 * Defaults to the stale window. Configurable because the right answer depends on the filesystem —
 * a network mount can make a write that takes microseconds locally take a very long time — and
 * because a test should not have to wait half a minute to prove a refusal happens.
 */
const lockTimeout = () => Number(process.env.TM_LOCK_TIMEOUT_MS) || LOCK_STALE_MS;
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
  const deadline = Date.now() + lockTimeout();
  const trace = (ev, extra) => {
    if (!process.env.TM_LOCK_TRACE) return;
    try {
      appendFileSync(process.env.TM_LOCK_TRACE, `${JSON.stringify({ t: Date.now(), pid: process.pid, ev, ...extra })}\n`);
    } catch {
      /* tracing must never break the thing it traces */
    }
  };
  let fd;
  for (;;) {
    try {
      fd = openSync(lock, "wx");
      break;
    } catch (err) {
      if (err.code !== "EEXIST") throw err;

      /**
       * A lock whose holder is gone is ours to clear — but "gone" is a verdict about a file, and
       * by the time we act on it the file at that path may be somebody else's.
       *
       * This used to be `if (staleLock(lock)) unlinkSync(lock)`, which deletes whatever is there
       * *now*. Traced under load: a holder releases, several waiters all read the empty path and
       * all conclude "stale", then each in turn unlinks the fresh lock the previous winner had
       * just created and takes its own. Four processes held the lock inside two milliseconds, and
       * eight concurrent creates minted TM-003 three times.
       *
       * Two guards, and between them the window closes:
       *   - a lock that VANISHED is not ours to clear, it is simply gone. Fall through to the
       *     `open(…, "wx")` race, which is atomic and picks exactly one winner.
       *   - a lock with a dead holder is cleared under a second lock, so only one process breaks,
       *     and it re-reads the verdict while holding that exclusion.
       */
      if (existsSync(lock) && staleLock(lock)) breakStaleLock(lock, trace);

      /**
       * Waiting too long is a failure, not a licence to break a live lock.
       *
       * This used to read `if (staleLock(lock) || Date.now() > deadline)`, so a waiter that had
       * queued for the deadline deleted the lock and walked in — overriding the answer `staleLock`
       * had just given, which was that the holder is alive and working. Both processes then held
       * it, and a read-modify-write of index.json lost one side.
       *
       * The window needs a queue to open, which is why it only ever showed up under load: waiter W
       * starts at T; a DIFFERENT process takes the lock legitimately at T+25s; at T+30s W's own
       * deadline passes while that holder's lock is five seconds old and its pid alive. W broke it
       * anyway. Reproduced by running six copies of the concurrency suite at once — two failed on
       * "index.json carries every concurrently created task" while the files themselves were all
       * present, which is exactly the shape of a lost index write.
       *
       * Thirty seconds for a lock held for milliseconds means something is genuinely wrong, and a
       * refusal the caller can see and retry beats a store that quietly disagrees with itself.
       *
       * Every path arrives here, including the one that just tried to break a stale lock. An
       * earlier draft of that branch `continue`d straight back to the top: it never consulted the
       * deadline and never slept, so a waiter blocked behind someone else's break spun a core flat
       * and, after thirty seconds of it, aged out that breaker and walked in anyway. A retry loop
       * with a way out that skips the way out is not a retry loop.
       */
      if (Date.now() > deadline) {
        throw new Error(
          `could not take the store lock within ${lockTimeout() / 1000}s — another process is holding it.\n` +
            `Retry, or if you are certain nothing is writing, remove ${lock}`,
        );
      }
      sleep(LOCK_RETRY_MS);
    }
  }
  try {
    writeSync(fd, JSON.stringify({ pid: process.pid, ts: now() }));
    closeSync(fd);
    fd = undefined;
    heldDepth = 1;
    trace("acquire");
    return fn();
  } finally {
    heldDepth = 0;
    trace("release");
    if (fd !== undefined) closeSync(fd);
    try {
      unlinkSync(lock);
    } catch {
      /* already gone */
    }
  }
}

/**
 * Clear a lock whose holder is dead, exactly once.
 *
 * The breaker is itself an `open(…, "wx")`, so only one process can be breaking a given lock, and
 * nobody can take the lock while it is being broken — taking it means winning `wx` on a path that
 * still holds the dead file, which cannot happen until the breaker removes it. That is what makes
 * the re-check safe: while we hold the breaker, no *live* lock can appear for us to delete.
 */
function breakStaleLock(lock, trace = () => {}) {
  const breaker = `${lock}.break`;
  let bfd;
  try {
    bfd = openSync(breaker, "wx");
  } catch {
    // Someone else is breaking it. Unless they died mid-break — then the breaker itself ages out.
    try {
      if (Date.now() - statSync(breaker).mtimeMs > LOCK_STALE_MS) unlinkSync(breaker);
    } catch {
      /* it went away on its own */
    }
    return;
  }
  try {
    if (existsSync(lock) && staleLock(lock)) {
      trace("break");
      try {
        unlinkSync(lock);
      } catch {
        /* already gone */
      }
    }
  } finally {
    closeSync(bfd);
    try {
      unlinkSync(breaker);
    } catch {
      /* ignore */
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

/**
 * Which epic the project is working on — shared, so it lives in the committed config, not in
 * per-machine `state.json`. It reads as session state and is not: a clone that lost it creates
 * every subsequent task under no epic, or under the wrong one, and nobody notices until the
 * board is already wrong. Claims, overrides and the last Stop block ARE per-machine and stay put.
 *
 * Kept behind state()/writeState() so the ~30 call sites don't care which file it lands in.
 */
const SHARED_STATE = ["activeEpic"];

export function state(p = paths()) {
  const local = readJson(p.state, { claims: {}, override: null, lastStopBlock: null });
  const cfg = readJson(p.config, {});
  // A pre-0.5 store still carries activeEpic in state.json; read through to it until a write moves it.
  return { activeEpic: cfg.activeEpic ?? local.activeEpic ?? null, ...local };
}

/** Locked read-modify-write. Use this everywhere except inside an existing withLock. */
export function writeState(patch, p = paths()) {
  return withLock(p, () => writeStateUnlocked(patch, p));
}

function writeStateUnlocked(patch, p = paths()) {
  const next = { ...state(p), ...patch };
  const shared = {};
  for (const k of SHARED_STATE) {
    shared[k] = next[k] ?? null;
    delete next[k];
  }
  if (SHARED_STATE.some((k) => k in patch)) writeConfig(shared, p);
  writeAtomic(p.state, `${JSON.stringify(next, null, 2)}\n`);
  return { ...shared, ...next };
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
        session: sessionId(),
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
  // Clearing the active epic is what stops the next `tm task new` filing into a closed one.
  // `tm epic done` already does this by hand; the auto-close did not, so finishing the last
  // task left state.activeEpic pointing at a done epic and every subsequent task landed in it
  // — the exact condition dashboard-api's transition refuses by name.
  if (state(p).activeEpic === epicId) writeState({ activeEpic: null }, p);
  logEvent("epic_auto_closed", { id: epicId, tasks: kids.length }, p);
  return true;
}

/**
 * The way back. A task leaving `done` has to take its epic with it, or the board reports a
 * finished epic that has live work in it — and `autoCloseEpic` will never re-close it, because
 * it refuses an epic that is already `done`.
 *
 * Config-gated on the same switch as the auto-close: a team that does not want epics closing
 * themselves does not want them reopening themselves either.
 */
export function reopenEpic(epicId, p = paths()) {
  if (!epicId || config(p).autoCloseEpics === false) return false;
  const epic = read(epicId, p);
  if (!epic || epic.status !== "done") return false;
  update(epicId, { status: "open", closed: undefined }, p);
  logEvent("epic_reopened", { id: epicId }, p);
  return true;
}

/**
 * Correct what `new` got wrong: the title, the body.
 *
 * Every other field on a task had a verb — assign, label, priority, type, estimate, rank,
 * subtask, dep, link — and the two you type first had none. A typo in a title was permanent
 * from the CLI and from MCP; the dashboard could fix it (`PATCH /api/task/:id`), so the
 * correction existed and was reachable only from the browser.
 *
 * The file is deliberately NOT renamed. `write` reuses `doc.file` when it has one, so
 * `TM-001-typoed-titel.md` keeps its name and gains the corrected title inside. The slug is
 * decoration and the id is the identity: a rename is a delete-plus-add in git, it breaks blame
 * continuity on the entity's whole history, and the old path may already be recorded in a
 * commit message, an evidence ref, or a `tm show --json` a script is holding.
 */
export function editTask(id, { title, body } = {}, p = paths()) {
  const doc = read(id, p);
  if (!doc) throw new Error(`not found: ${id}`);

  const patch = {};
  if (title !== undefined) {
    const value = String(title).trim();
    // An empty title makes the task unfindable on every surface that lists it by name.
    if (!value) throw new Error("a title cannot be empty");
    if (value !== doc.title) patch.title = value;
  }
  /**
   * Compared trimmed, because the body round-trip is not identity: `serializeDoc` writes a
   * newline after the closing frontmatter fence and `parseDoc` hands it back, so a body written
   * as `"notes"` reads as `"\nnotes"`. A raw `!==` therefore reports a change every single time,
   * which would make "did anything actually change" unanswerable for the one field most likely
   * to be re-submitted unchanged by a form.
   */
  if (body !== undefined && String(body).trim() !== (doc.body ?? "").trim()) patch.body = String(body);

  const changed = Object.keys(patch);
  // Silence rather than a write. Re-typing the title you already have is not an edit, and an
  // `updated` bump would make it look like the task moved when nothing about it did.
  if (!changed.length) return { id, changed };

  update(id, patch, p);
  logEvent("edit", { id, fields: changed.join(","), ...(patch.title ? { was: doc.title } : {}) }, p);
  return { id, changed, was: doc.title };
}

/**
 * Refile a task under a different epic, or under none.
 *
 * Nothing could do this — not the CLI, not MCP, and not the dashboard, whose PATCH takes title
 * and body only. That is worse than it sounds, because `tm task new` files into whatever epic is
 * active and the create gate *requires* an active epic: filing into the wrong one is one
 * keystroke away and there was no way back short of editing frontmatter by hand.
 *
 * A move is not just a field write, because both epics' lifecycles depend on their children:
 *
 *   - into a `done` epic, an unfinished task reopens it. A finished epic containing live work is
 *     the same lie `tm reopen` already refuses to leave behind, and `autoCloseEpic` will never
 *     re-close it on its own.
 *   - out of an epic, the source may have just become complete, so it gets the same auto-close
 *     check finishing a task would give it. An epic emptied entirely does not close: zero tasks
 *     is not an achievement, and `autoCloseEpic` already declines that case.
 */
export function moveTask(id, epicId, p = paths()) {
  const doc = read(id, p);
  if (!doc) throw new Error(`not found: ${id}`);
  if (kindOf(id) !== "task") throw new Error(`${id} is not a task`);

  const dest = epicId === "none" || epicId === null || epicId === "" ? null : epicId;
  if (dest) {
    if (kindOf(dest) !== "epic") throw new Error(`${dest} is not an epic id`);
    if (!read(dest, p)) throw new Error(`not found: ${dest}`);
  }
  const from = doc.epic || null;
  if (from === dest) return { id, from, to: dest, changed: false };

  update(id, { epic: dest || undefined }, p);
  logEvent("moved", { id, from, to: dest }, p);

  const result = { id, from, to: dest, changed: true };
  if (dest && !RESOLVED.has(doc.status) && reopenEpic(dest, p)) result.reopened = dest;
  if (from && autoCloseEpic(from, p)) result.closed = from;
  return result;
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
  const hit = readdirSync(dir).find((f) => isEntityFile(f) && (f.startsWith(`${id}-`) || f === `${id}.md`));
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
        .filter(isEntityFile)
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

/**
 * This store's board, and where that answer came from.
 *
 * Git wins. TM-036 stored the id in config.json, which made the value that gates cross-board
 * writes editable by anyone who could open the file it was defending — and a guard you can talk
 * out of is not a guard. When the repo has an origin remote, that is the identity, every time,
 * and the stored copy is only a record.
 *
 * `source` is the honest part. `git` is derived and authoritative; `directory` is a *guess* — a
 * project with no remote has no better name, and two clones of it in differently-named directories
 * will disagree. Callers that care (doctor, `tm status`) say which they are looking at rather than
 * presenting both as the same kind of fact.
 */
export function boardIdentity(p = paths()) {
  const stored = readJson(p.config, {}).boardId || null;
  const fromGit = p.root ? gitBoardId(p.root) : null;
  if (fromGit) return { id: fromGit, source: "git", stored, drifted: Boolean(stored) && stored !== fromGit };
  if (stored) return { id: stored, source: "config", stored, drifted: false };
  const guess = p.root ? boardId(p.root) : null;
  return { id: guess, source: guess ? "directory" : "none", stored: null, drifted: false };
}

export function storeBoard(p = paths()) {
  return boardIdentity(p).id;
}

export function write(doc, p = paths()) {
  const { body = "", file, ...data } = doc;
  /**
   * An entity is filed on the board it was created on, or nowhere.
   *
   * Nothing used to check this, and the write path is exactly where the two repos met: `tm`
   * resolves a store from CLAUDE_PROJECT_DIR while a command runs in whatever checkout the shell
   * is in, so a write aimed at one project could land in another's store and look completely
   * normal afterwards. Entities created before this shipped carry no `board` and are grandfathered
   * — refusing them would break every existing store to catch a bug that has already happened.
   */
  /**
   * Both names count as this board.
   *
   * A repo gains a remote, is renamed, or moves owner, and the derived identity changes under a
   * store full of entities stamped with the old one. Refusing those would make a rename brick the
   * board — every existing task unwritable, which is a far worse failure than the one this guard
   * exists to prevent. `tm doctor` reports the drift (`board-renamed`); the history stays writable.
   */
  const identity = boardIdentity(p);
  const here = identity.id;
  const ours = new Set([identity.id, identity.stored].filter(Boolean));
  if (data.board && here && !ours.has(data.board)) {
    throw new Error(
      `${data.id} belongs to ${data.board}, but this store is ${here} — refusing to file it here.\n` +
        `If the two are genuinely related, link them: tm link <id> relates-to ${data.board}#${data.id}`,
    );
  }
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
    // The board is stamped at creation and never rewritten: it is where this entity was born, and
    // it is what lets a later write notice it is being filed into somebody else's store.
    return write({ id, kind, status: "open", created: now(), board: storeBoard(p), ...fields, body }, p);
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

    /**
     * A task coming back OUT of done: drop `closed`, and reopen the epic that closed behind it.
     *
     * The guard belongs here rather than in a `reopen` verb because update() is the funnel for
     * the CLI, the dashboard's transition, mcp's tm_task_update and doctor's own fixes — and
     * every one of them could reopen a task. Before this, `tm start` on a done task left
     * `closed` set, so `tm export csv` reported a Resolved date on in-progress work in the one
     * column a Jira import cannot repair.
     *
     * Deliberately exactly two effects. This is a write no caller asked for, so it stays
     * minimal: no touching `updated`, no status inference, no cascade past the parent epic.
     * `kindOf` keeps it to tasks, so reopenEpic's own update() cannot re-enter this branch.
     */
    const reopening = kindOf(id) === "task" && RESOLVED.has(doc.status) && patch.status && !RESOLVED.has(patch.status);
    const effective = reopening ? { ...patch, closed: undefined } : patch;

    const next = write({ ...doc, ...effective }, p);
    logEvent("update", { id, patch: Object.keys(effective).join(","), status: next.status }, p);
    if (reopening && doc.epic) reopenEpic(doc.epic, p);
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
    .filter(isEntityFile)
    .map((f) => {
      /**
       * A file can still vanish between the listing and the read — a concurrent `tm done` renaming
       * over it, a `git checkout` under the store. Skipping a file that is no longer there is
       * strictly better than failing the whole read: the caller asked what is on the board, and a
       * file that stopped existing is not on it.
       */
      try {
        const { data, body } = parseDoc(readFileSync(join(dir, f), "utf8"));
        return { ...data, body, file: join(dir, f) };
      } catch (err) {
        if (err.code === "ENOENT") return null;
        throw err;
      }
    })
    .filter(Boolean)
    .filter((d) => wantDeleted || d.status !== "deleted")
    .filter((d) => Object.entries(match).every(([k, v]) => (v === undefined ? true : d[k] === v)))
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));
}

/** Rebuild index.json from the markdown files. Cheap enough to run on every write. */
export function reindex(p = paths()) {
  const index = { generated: now(), epics: [], tasks: [], adrs: [], capabilities: [] };
  for (const [kind, key] of [["epic", "epics"], ["task", "tasks"], ["adr", "adrs"], ["capability", "capabilities"]]) {
    index[key] = list(kind, {}, p).map(({ body, file, ...rest }) => rest);
  }
  try {
    writeAtomic(p.index, `${JSON.stringify(index, null, 2)}\n`);
  } catch {
    /* index is a cache; failure is survivable */
  }
  return index;
}


/**
 * The store's own git contract.
 *
 * `.bytedesk/task-management/` is meant to be committed — one markdown file per entity is what
 * makes the board readable in a diff and mergeable in a PR. But four kinds of file in there are not
 * the project's business, and without a rule they sit in `git status` forever, get committed by an
 * absent-minded `git add -A`, and then conflict on every pull:
 *
 *   index.json      a derived cache. The README already says "delete it any time".
 *   state.json      session claims and one-shot overrides — whose laptop, not what work.
 *   dashboard.*     a port and a pid for a server running on one machine right now.
 *   port.assigned   this machine's standing port for the board. Per-machine, but NOT swept with
 *                   dashboard.* — losing it moves the URL of a board that drifted off its
 *                   deterministic port.
 *   .tm-tmp-*       the temp file `writeAtomic` renames over the real one.
 *   state.lock*     the cross-process lock, and the second lock that breaks a stale one.
 *
 * `events.jsonl` gets `merge=union` and that is the piece worth having. It is append-only, so two
 * branches that both did work produce two sets of added lines at the end of one file — a textbook
 * conflict that is never a real one. Union takes both sides. Without it, the audit log is the file
 * most likely to conflict and the least interesting to resolve by hand.
 */
const GITIGNORE = `# Written by \`tm init\`. The markdown, events.jsonl, config.json and evidence/ are the
# shared record and belong in git. These four are not.

# A derived cache — \`tm reindex\` rebuilds it from the files.
index.json

# Session claims, the active epic, one-shot overrides. Whose machine, not what work.
state.json

# A port and a pid for a dashboard running here, now.
dashboard.*

# The standing port assignment. Per-machine like the above, but kept out of the dashboard.*
# glob so tidying the pid file cannot move the board's URL.
port.assigned

# writeAtomic's staging files. Present only mid-write, or after a crash.
.tm-tmp-*

# The cross-process lock, and the lock that breaks a stale one. Present only while a write is in
# flight — or after a process was killed holding it, which is exactly when someone runs \`git add -A\`
# and commits a lock belonging to a pid that never existed on anybody else's machine.
state.lock
state.lock.break
`;

const GITATTRIBUTES = `# Written by \`tm init\`.
#
# events.jsonl is append-only, so two branches that both did work produce two sets of added lines at
# the end of one file. That is a conflict git cannot resolve and a human should never have to: the
# answer is always "keep both, in time order". Union does that.
events.jsonl merge=union
`;

const CONTRACT = { gitignore: GITIGNORE, gitattributes: GITATTRIBUTES };

/** The rules a contract file carries: the template's lines, minus comments and blanks. */
const rulesOf = (body) =>
  body
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));

/**
 * Template rules the store's file does not have.
 *
 * Seeding only ever wrote a *missing* file, so a store created before a rule was added never
 * learned it — and the symptom is the silent kind: `port.assigned` shipped in 0.5.0, every older
 * store kept committing a per-machine file, and `tm doctor` said the contract was fine because a
 * file existed. Comparing content rather than existence is the whole fix.
 *
 * ponytail: exact match on trimmed lines. A rule written differently but equivalently
 * (`/index.json`, `dashboard.port`) reads as missing and gets appended — harmless duplication,
 * and the alternative is parsing gitignore semantics. Upgrade if that starts annoying anyone.
 */
export function missingContractRules(p = paths(), key) {
  const body = CONTRACT[key];
  if (!body) return [];
  if (!existsSync(p[key])) return rulesOf(body);
  const have = new Set(
    readFileSync(p[key], "utf8")
      .split("\n")
      .map((l) => l.trim()),
  );
  return rulesOf(body).filter((r) => !have.has(r));
}

/**
 * Seed the contract, without ever overwriting a hand-edited one.
 *
 * `tm init` is run on stores that already exist — it is how you adopt an older board — so a
 * missing file is written whole and a present one is *topped up*: rules the template has and the
 * file lacks are appended, and everything already there, including someone's own additions,
 * stays. Rewriting from the template would be simpler and would silently delete their work.
 */
export function seedGitContract(p = paths(), only = null) {
  const written = [];
  for (const [key, body] of Object.entries(CONTRACT)) {
    if (only && only !== key) continue;
    if (!existsSync(p[key])) {
      writeAtomic(p[key], body);
      written.push(basename(p[key]));
      continue;
    }
    const missing = missingContractRules(p, key);
    if (!missing.length) continue;
    const current = readFileSync(p[key], "utf8");
    writeAtomic(
      p[key],
      `${current.endsWith("\n") ? current : `${current}\n`}\n# Added by \`tm doctor --fix\` — rules this store predates.\n${missing.join("\n")}\n`,
    );
    written.push(basename(p[key]));
  }
  return written;
}

/** Paths inside the store that git should not be carrying. Shared with doctor. */
export const NOT_FOR_GIT = ["index.json", "state.json"];

// ── derived views ────────────────────────────────────────────────────────────

export const OPEN = new Set(["open", "in_progress", "blocked"]);
/** A blocker stops blocking once it is finished — or gone. */
export const RESOLVED = new Set(["done", "deleted"]);

/**
 * Most urgent first. `issue.mjs` owns the priority *field* — validation, the event, the CLI
 * verb — but the queue order is read here, by `nextTasks`, so the vocabulary lives here and
 * `issue.mjs` imports it. The other direction would make store.mjs depend on issue.mjs, and
 * store.mjs is what issue.mjs is built on.
 */
export const PRIORITIES = ["highest", "high", "medium", "low", "lowest"];

/** Sparse, so placing one card between two others rewrites only the card that moved. */
export const RANK_STEP = 1000;

/**
 * The order of the queue.
 *
 * Both `priority` and `rank` were writable and neither was ever read: `nextTasks` filtered and
 * returned whatever order `list` happened to give, which is id order — creation order. So a
 * task set to `highest` and dragged to the top of the backlog still came second behind an
 * untouched `low` one, and since `tm next` is what the README, the SessionStart block and the
 * `tm_next` tool all point at, priority could not influence what any agent picked up.
 *
 * An explicit rank comes first, because a rank is only ever set by someone deliberately placing
 * that task relative to another — that is a stronger statement than a label, and it is Jira's
 * rule too. Everything unranked follows, ordered by priority. Ranked-before-unranked rather
 * than interleaving the two: a fallback rank derived from list position would give every task a
 * distinct pseudo-rank, and priority as a tiebreaker on values that are never tied is priority
 * that still does nothing.
 *
 * Id breaks the remaining ties, so the order is total and stable — the same board must not
 * render two ways.
 */
export function queueOrder(tasks) {
  const pri = (t) => {
    const i = PRIORITIES.indexOf(t.priority);
    return i === -1 ? PRIORITIES.indexOf("medium") : i;
  };
  return [...tasks].sort(
    (a, b) =>
      (a.rank === undefined) - (b.rank === undefined) ||
      (a.rank !== undefined ? a.rank - b.rank : 0) ||
      pri(a) - pri(b) ||
      String(a.id).localeCompare(String(b.id)),
  );
}

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
  // Ordered here rather than at the call sites. There are five of them — `tm next`, the
  // SessionStart block, `tm_next`, the resource picker, `tm parallel` — and an order every
  // caller has to remember to apply is an order some caller will not have.
  return queueOrder(
    all.filter(
      (t) =>
        (t.status === "open" || blockedByDependency(t)) &&
        !RESOLVED.has(t.status) &&
        dependenciesMet(t, byId),
    ),
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

/**
 * Tick or untick one acceptance criterion.
 *
 * Ticking existed on three surfaces and unticking on none, so a criterion was a **one-way door**:
 * the dashboard's checkbox even set `isDisabled` once checked, locking the box it had just ticked.
 * A stray click permanently changed what `tm done` would accept, and the only way back was editing
 * the frontmatter JSON by hand.
 *
 * Untick deliberately does NOT reopen a task that is already done. That is a decision — the work may
 * genuinely be finished and the criterion simply mis-ticked — and `tm doctor` already reports
 * `done-unmet` for exactly this state and refuses to auto-repair it for the same reason. Silently
 * reopening someone's finished task to satisfy an invariant would be the tool overruling them.
 *
 * `mutate` for the read-modify-write, because ticking rewrites the whole array and two ticks racing
 * would drop one — which is precisely the gate `tm done` reads.
 */
export function setCriterion(id, index, done = true, p = paths()) {
  const t = read(id, p);
  if (!t) throw new Error(`not found: ${id}`);
  const i = Number(index) - 1;
  if (!(t.acceptance || [])[i]) throw new Error(`${id} has no acceptance criterion ${index}`);

  let acceptance = [];
  mutate(id, (doc) => {
    acceptance = [...(doc.acceptance || [])];
    const { at: _was, ...rest } = acceptance[i] || {};
    // `at` is dropped rather than kept on an unticked criterion: a met-at timestamp on something
    // not met reads as history and would survive into `tm export`.
    acceptance[i] = done ? { ...rest, done: true, at: now() } : { ...rest, done: false };
    return { acceptance };
  }, p);
  logEvent(done ? "ac_met" : "ac_unmet", { id, index: Number(index), text: acceptance[i]?.text }, p);
  return { acceptance, met: acceptance.filter((a) => a.done).length };
}

/**
 * Remove a criterion outright, for one added by mistake.
 *
 * Nothing could. `tm ac` only appends, so a typo'd criterion gated `tm done` forever unless someone
 * opened the markdown — and the gate is the whole point of the field, so an unmeetable entry in it
 * is not cosmetic.
 *
 * Returns the surviving list, because **removal renumbers everything after it**: criterion 4 becomes
 * criterion 3, and any commit message, comment or note that referred to "AC 4" now points at a
 * different sentence. The callers print the new list for that reason.
 */
export function removeCriterion(id, index, p = paths()) {
  const t = read(id, p);
  if (!t) throw new Error(`not found: ${id}`);
  const i = Number(index) - 1;
  const target = (t.acceptance || [])[i];
  if (!target) throw new Error(`${id} has no acceptance criterion ${index}`);

  let acceptance = [];
  mutate(id, (doc) => {
    acceptance = (doc.acceptance || []).filter((_, n) => n !== i);
    return { acceptance };
  }, p);
  logEvent("ac_removed", { id, index: Number(index), text: target.text }, p);
  return { removed: target.text, acceptance };
}

