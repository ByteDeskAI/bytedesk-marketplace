/**
 * Adapter: Kimi Code `TodoList` wire → domain MirrorIntent[].
 *
 * Kimi's native task surface, read off this machine's own install (TM-071):
 *   tool_name:  "TodoList"
 *   tool_input: { todos: [{ title: string, status: "pending" | "in_progress" | "done" }] }
 *
 * Two properties of that surface shape this adapter:
 *
 *   - Todos carry no ids, and every TodoList call replaces the whole list — so rows
 *     are keyed by a content hash of the title, exactly like the Codex plan adapter:
 *       nativeId = kimi-todo:<sha1(title)[0:12]>
 *     Re-sending the same title updates the same store task.
 *
 *   - Calling TodoList with no `todos` reads the current list back. A query is not
 *     work: it yields no intents and never trips the pre-create gate.
 *
 * Hooks: Kimi Code supports PreToolUse/PostToolUse via `[[hooks]]` entries in
 * ~/.kimi-code/config.toml (event + matcher regex + command). The stdin payload is
 * Claude-shaped snake_case — hook_event_name, session_id, cwd, tool_name,
 * tool_input — see tests/fixtures/kimi-todolist-payload.json and
 * hooks/kimi-hooks.example.toml. Kimi sets no session env var (measured: `env`
 * inside a live session carries nothing KIMI_*; the binary's only
 * KIMI_SESSION_ID is a skill-template placeholder), so the session id reaches the
 * store off the payload's `session_id`, the same path Codex takes.
 */
import { createHash } from "node:crypto";
import { mapNativeStatus } from "./intents.mjs";

export const KIMI_TOOLS = new Set(["TodoList"]);

export function toolName(input) {
  return String(input?.tool_name || input?.toolName || "");
}

function nativeIdFor(title) {
  const text = String(title || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
  if (!text) return undefined;
  const h = createHash("sha1").update(text).digest("hex").slice(0, 12);
  return `kimi-todo:${h}`;
}

function todoItems(input) {
  const ti = input.tool_input || input.toolInput || {};
  if (Array.isArray(ti.todos)) return ti.todos;
  if (Array.isArray(ti.items)) return ti.items;
  return [];
}

/**
 * @param {object} input hook payload
 * @returns {import('./intents.mjs').MirrorIntent[]}
 */
export function toIntents(input) {
  if (!KIMI_TOOLS.has(toolName(input))) return [];

  const items = todoItems(input);
  if (!items.length) return []; // query-mode call: reads the list, changes nothing

  /** @type {import('./intents.mjs').MirrorIntent[]} */
  const out = [];
  for (const item of items) {
    const title = String(item?.title || item?.content || "").trim();
    if (!title) continue;
    const nativeId = nativeIdFor(title);
    const status = mapNativeStatus(item?.status) || "open";

    /** @type {import('./intents.mjs').UpdateIntent} */
    const u = {
      op: "update",
      nativeId,
      title,
      status,
      via: "kimi",
    };
    out.push(u);
  }
  return out;
}

/**
 * Gate when the list still holds open work (pending / in_progress). A list of
 * only done todos is progress bookkeeping, not new work — and a query-mode
 * call (no todos) is not a write at all.
 */
export function wouldCreate(input) {
  if (!KIMI_TOOLS.has(toolName(input))) return false;
  const items = todoItems(input);
  if (!items.length) return false;
  return items.some((item) => {
    const s = String(item?.status || "pending").toLowerCase();
    return s === "pending" || s === "open" || s === "in_progress";
  });
}
