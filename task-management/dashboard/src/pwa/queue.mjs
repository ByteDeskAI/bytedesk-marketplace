/**
 * Writes made while the board can't reach its server.
 *
 * The queue is an ordered log of intents, replayed oldest-first through the same
 * `/api/...` endpoints a live write uses — so a replayed transition meets the
 * same gates and can be refused exactly the same way. A refusal is not a dropped
 * write: the entry goes `failed` with the server's reason and stays on the card
 * until the user deals with it.
 *
 * The arithmetic here is pure and unit-tested. `load`/`save` at the bottom are
 * the IndexedDB plumbing over it — one store, one key, no schema to migrate.
 */

/**
 * Actions where the last word wins: queueing "start" then "done" offline should
 * replay one transition, not two. Everything else — comments, acceptance
 * criteria, links — is a distinct fact and accumulates.
 */
const COALESCING = new Set(["transition", "assign", "priority", "estimate", "edit", "subtask", "rank"]);

const actionOf = (url) => url.split("?")[0].split("/")[4] || "edit";

/** @param {string} url @returns {string | null} */
export function taskIdOf(url) {
  const m = /^\/api\/task\/([^/?]+)/.exec(url || "");
  if (!m) return null;
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return m[1];
  }
}

let counter = 0;
const newKey = () => `w${Date.now().toString(36)}-${(counter += 1).toString(36)}`;

/**
 * @param {any[]} queue
 * @param {{method: string, url: string, body: any}} write
 * @param {number} now
 */
export function enqueue(queue, write, now = Date.now()) {
  const entry = {
    key: newKey(),
    method: write.method || "POST",
    url: write.url,
    body: write.body ?? {},
    taskId: taskIdOf(write.url),
    action: actionOf(write.url),
    ts: now,
    status: "queued",
  };

  // Supersede an earlier queued write of the same shape, keeping its place in
  // the order — the user's intent moved, their position in the queue did not.
  if (COALESCING.has(entry.action) && entry.taskId) {
    const i = queue.findIndex(
      (e) => e.status === "queued" && e.taskId === entry.taskId && e.action === entry.action,
    );
    if (i >= 0) {
      const next = [...queue];
      next[i] = { ...entry, key: queue[i].key };
      return next;
    }
  }
  return [...queue, entry];
}

/** What to send, oldest first. Failed entries wait for the user, not the network. */
export function replayOrder(queue) {
  return queue.filter((e) => e.status === "queued").sort((a, b) => a.ts - b.ts);
}

/**
 * Fold a replay attempt back into the queue.
 * - accepted → the entry is done with, drop it
 * - refused (4xx/5xx) → keep it, marked failed, carrying the server's reason
 * - never sent → leave it queued for the next reconnect
 */
export function applyResult(queue, key, result) {
  const i = queue.findIndex((e) => e.key === key);
  if (i < 0) return queue;
  if (result.offline) return queue;
  if (result.status && result.status < 300) return queue.filter((e) => e.key !== key);
  const next = [...queue];
  next[i] = { ...next[i], status: "failed", code: result.status ?? 0, error: result.error || "the write was refused" };
  return next;
}

/** Drop an entry the user has acknowledged. */
export function discard(queue, key) {
  return queue.filter((e) => e.key !== key);
}

/** Put a failed entry back in line for another try. */
export function retry(queue, key, now = Date.now()) {
  return queue.map((e) =>
    e.key === key ? { ...e, status: "queued", ts: now, code: undefined, error: undefined } : e,
  );
}

/**
 * Per-task badge state for the cards. A refusal outranks a pending write: it is
 * the thing the user has to act on.
 * @returns {Map<string, {status: string, count: number, error?: string}>}
 */
export function pending(queue) {
  const byTask = new Map();
  for (const e of queue) {
    if (!e.taskId) continue;
    const cur = byTask.get(e.taskId) || { status: "queued", count: 0 };
    cur.count += 1;
    if (e.status === "failed") {
      cur.status = "failed";
      cur.error = e.error;
      cur.key = e.key;
    }
    byTask.set(e.taskId, cur);
  }
  return byTask;
}

// ── persistence ──────────────────────────────────────────────────────────────
// ponytail: one record under one key. The queue is tens of entries at worst, so
// object-store-per-entry buys nothing but a migration to get wrong later.
const DB = "tm-board";
const STORE = "outbox";
const KEY = "queue";

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

const tx = (db, mode, run) =>
  new Promise((resolve, reject) => {
    const req = run(db.transaction(STORE, mode).objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

/** @returns {Promise<any[]>} */
export async function load() {
  try {
    const db = await open();
    return (await tx(db, "readonly", (s) => s.get(KEY))) || [];
  } catch {
    return []; // private mode, no IndexedDB — the board still works, writes just don't survive a reload
  }
}

export async function save(queue) {
  try {
    const db = await open();
    await tx(db, "readwrite", (s) => s.put(queue, KEY));
  } catch {
    /* nothing we can do, and nothing worth breaking the page over */
  }
}
