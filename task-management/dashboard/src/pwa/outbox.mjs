/**
 * The live offline outbox: one queue for the whole page, outside React.
 *
 * It has to be a module singleton rather than hook state, because the thing that
 * discovers a write cannot be sent is `send()` in api.ts — plain async code with
 * no component around it. api.ts hands the write here; the UI subscribes.
 *
 * The ordering, coalescing and refusal rules all live in queue.mjs and are
 * unit-tested there. This file is the instance and the replay loop.
 */
import { applyResult, discard, enqueue, load, pending, replayOrder, retry, save } from "./queue.mjs";

let queue = [];
let ready = false;
const listeners = new Set();

const emit = () => {
  for (const fn of listeners) fn(queue);
};

const set = (next) => {
  queue = next;
  void save(queue);
  emit();
};

export function subscribe(fn) {
  listeners.add(fn);
  if (ready) fn(queue);
  return () => listeners.delete(fn);
}

export const getQueue = () => queue;
export const pendingByTask = () => pending(queue);

/** Restore whatever survived the last reload. Safe to call more than once. */
export async function hydrate() {
  if (ready) return queue;
  queue = await load();
  ready = true;
  emit();
  return queue;
}

/** A write that never reached the server. Keeps the user's intent, in order. */
export function queueWrite(write) {
  set(enqueue(queue, write, Date.now()));
  void requestSync();
  return queue[queue.length - 1];
}

export function discardEntry(key) {
  set(discard(queue, key));
}

/** Put a refused write back in line. The caller decides when to drain. */
export function retryEntry(key) {
  set(retry(queue, key, Date.now()));
}

/**
 * Drain the outbox oldest-first through `attempt`, which must be the same code
 * path a live write takes — a replayed transition meets the same gates, and a
 * 409 for unmet acceptance criteria marks the entry failed with the server's own
 * reason rather than disappearing.
 *
 * @param {(entry: any) => Promise<{ok?: boolean, status?: number, error?: string, offline?: boolean}>} attempt
 * @param {(entry: any, result: any) => void} [onRefusal]
 */
let draining = false;
export async function replay(attempt, onRefusal) {
  if (draining) return queue;
  draining = true;
  try {
    let next = queue;
    for (const entry of replayOrder(next)) {
      const result = await attempt(entry);
      if (result.offline) break; // still unreachable — the rest keeps its place
      next = applyResult(next, entry.key, result);
      if (!result.ok) onRefusal?.(entry, result);
    }
    if (next !== queue) set(next);
    return queue;
  } finally {
    draining = false;
  }
}

/**
 * Background Sync, honestly: it fires when the browser regains connectivity,
 * which says nothing about a 127.0.0.1 server being back up. It is a best-effort
 * nudge; the reconnect listener and the retry timer in usePwa do the real work.
 */
async function requestSync() {
  try {
    const reg = await navigator.serviceWorker?.ready;
    await reg?.sync?.register("tm-replay");
  } catch {
    /* unsupported, or the browser gates it behind a permission — fine */
  }
}
