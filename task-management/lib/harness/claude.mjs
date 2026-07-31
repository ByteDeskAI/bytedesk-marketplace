/**
 * Adapter: Claude Code TaskCreate / TaskUpdate wire → domain MirrorIntent[].
 *
 * Payload shape (observed + test fixtures):
 *   tool_name: "TaskCreate" | "TaskUpdate"
 *   tool_input: { subject, description, activeForm, taskId, status, owner, addBlockedBy, addBlocks }
 *   tool_response: { id, taskId, subject }
 */
import { mapNativeStatus } from "./intents.mjs";

export const CLAUDE_TOOLS = new Set(["TaskCreate", "TaskUpdate"]);

export function toolName(input) {
  return String(input?.tool_name || input?.toolName || "");
}

/**
 * @param {object} input hook payload
 * @returns {import('./intents.mjs').MirrorIntent[]}
 */
export function toIntents(input) {
  const name = toolName(input);
  if (!CLAUDE_TOOLS.has(name)) return [];

  const ti = input.tool_input || input.toolInput || {};
  const resp = input.tool_response || input.toolResult || input.tool_result || {};
  const nativeId = String(ti.taskId || resp.id || resp.taskId || "").trim();

  if (name === "TaskCreate") {
    const title = ti.subject || resp.subject;
    if (!title) return [];
    return [
      {
        op: "create",
        title: String(title),
        body: ti.description ? String(ti.description) : "",
        nativeId: nativeId || undefined,
        activeForm: ti.activeForm || undefined,
        via: "claude",
      },
    ];
  }

  // TaskUpdate — needs a native id to find the store row.
  if (!nativeId) return [];
  /** @type {import('./intents.mjs').UpdateIntent} */
  const intent = { op: "update", nativeId, via: "claude" };
  if (ti.status != null) intent.status = mapNativeStatus(ti.status);
  if (ti.subject) intent.title = String(ti.subject);
  if (ti.activeForm) intent.activeForm = String(ti.activeForm);
  if (ti.owner) intent.owner = String(ti.owner);
  if (ti.description) intent.body = String(ti.description);
  if (ti.addBlockedBy?.length) intent.addBlockedBy = ti.addBlockedBy.map(String);
  if (ti.addBlocks?.length) intent.addBlocks = ti.addBlocks.map(String);
  return [intent];
}

/** Whether this payload would create new work (used by pre-create gate). */
export function wouldCreate(input) {
  return toolName(input) === "TaskCreate";
}
