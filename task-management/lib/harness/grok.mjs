/**
 * Adapter: Grok `todo_write` wire → domain MirrorIntent[].
 *
 * Grok's built-in task surface is a session todo list, not Claude's TaskCreate
 * state machine. We treat each todo item as a durable task keyed by
 * `nativeId = grok-todo:<id>` so updates re-find the same store row.
 *
 * Expected toolInput (Grok / session tools):
 *   { todos: [{ id, content|title, status }], merge?: boolean }
 *
 * Status tokens: pending | in_progress | completed | cancelled (plus aliases).
 */
import { mapNativeStatus } from "./intents.mjs";

export const GROK_TOOLS = new Set(["todo_write"]);

export function toolName(input) {
  return String(input?.tool_name || input?.toolName || "");
}

function nativeIdFor(item) {
  const id = item?.id != null ? String(item.id).trim() : "";
  if (!id) return undefined;
  return id.startsWith("grok-todo:") ? id : `grok-todo:${id}`;
}

function itemTitle(item) {
  return String(item?.content || item?.title || item?.subject || "").trim();
}

/**
 * @param {object} input hook payload
 * @returns {import('./intents.mjs').MirrorIntent[]}
 */
export function toIntents(input) {
  if (!GROK_TOOLS.has(toolName(input))) return [];

  const ti = input.tool_input || input.toolInput || {};
  const todos = Array.isArray(ti.todos) ? ti.todos : Array.isArray(ti.items) ? ti.items : [];
  if (!todos.length) return [];

  /** @type {import('./intents.mjs').MirrorIntent[]} */
  const out = [];
  for (const item of todos) {
    const title = itemTitle(item);
    const nativeId = nativeIdFor(item);
    const status = mapNativeStatus(item?.status);

    // Without a stable id we can only create (and may duplicate on re-writes).
    if (!nativeId) {
      if (!title) continue;
      out.push({
        op: "create",
        title,
        status: status || "open",
        via: "grok",
      });
      continue;
    }

    // Prefer update when the mirror may already exist; apply.mjs falls back to create
    // if no row has this nativeId yet (same as Claude TaskUpdate-before-create edge).
    if (title || status) {
      /** @type {import('./intents.mjs').UpdateIntent} */
      const u = { op: "update", nativeId, via: "grok" };
      if (title) u.title = title;
      if (status) u.status = status;
      out.push(u);
    }
  }
  return out;
}

/**
 * Gate when the write introduces new items (or full replace). Pure updates to
 * existing todos still pass — apply will create if missing, but pre-deny only
 * blocks brand-new work without an epic.
 *
 * Heuristic: any todo without a grok-todo native id that we can prove already
 * existed is treated as create-ish; if merge===false, treat the whole write as create.
 */
export function wouldCreate(input) {
  if (!GROK_TOOLS.has(toolName(input))) return false;
  const ti = input.tool_input || input.toolInput || {};
  if (ti.merge === false) return true;
  const todos = Array.isArray(ti.todos) ? ti.todos : Array.isArray(ti.items) ? ti.items : [];
  // Empty list is not create. Unknown shape: don't gate (fail-open).
  if (!todos.length) return false;
  // Any pending/open item is potential new work.
  return todos.some((t) => {
    const s = String(t?.status || "pending");
    return s === "pending" || s === "open" || !t?.id;
  });
}
