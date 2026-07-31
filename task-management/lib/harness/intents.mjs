/**
 * Domain intents for native-task mirroring.
 *
 * Wire adapters (Claude, Grok, …) produce these; only `apply.mjs` turns them into
 * store mutations. That is the Bridge: abstraction = durable task ops, implementor =
 * harness-specific payload translation.
 *
 * @typedef {'create' | 'update'} IntentOp
 *
 * @typedef {object} CreateIntent
 * @property {'create'} op
 * @property {string} title
 * @property {string} [body]
 * @property {string} [nativeId]
 * @property {string} [activeForm]
 * @property {string} [status] store status already mapped (open | in_progress | done | …)
 * @property {string} [via] audit tag, e.g. "claude" | "grok"
 *
 * @typedef {object} UpdateIntent
 * @property {'update'} op
 * @property {string} nativeId
 * @property {string} [title]
 * @property {string} [body]
 * @property {string} [status]
 * @property {string} [activeForm]
 * @property {string} [owner]
 * @property {string[]} [addBlockedBy] native ids
 * @property {string[]} [addBlocks] native ids
 * @property {string} [via]
 *
 * @typedef {CreateIntent | UpdateIntent} MirrorIntent
 */

export const STORE_STATUS = {
  open: "open",
  in_progress: "in_progress",
  done: "done",
  deleted: "deleted",
  parked: "parked",
};

/** Common native → store status tokens (Claude TaskUpdate + Grok todo statuses). */
export const NATIVE_STATUS = {
  pending: "open",
  open: "open",
  in_progress: "in_progress",
  completed: "done",
  done: "done",
  cancelled: "deleted",
  deleted: "deleted",
  canceled: "deleted",
};

export function mapNativeStatus(raw) {
  if (raw == null || raw === "") return undefined;
  const key = String(raw);
  return NATIVE_STATUS[key] || key;
}
