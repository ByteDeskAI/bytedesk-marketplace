/**
 * Adapter: Codex CLI `update_plan` wire → domain MirrorIntent[].
 *
 * Codex native task surface (codex-protocol UpdatePlanArgs):
 *   {
 *     explanation?: string,
 *     plan: [{ step: string, status: "pending" | "in_progress" | "completed" }]
 *   }
 *
 * Plan steps have no stable ids — we key rows by a content hash:
 *   nativeId = codex-plan:<sha1(step)[0:12]>
 * so re-sending the same step text updates the same store task.
 *
 * Tool name matched by hooks: `update_plan` (Codex docs: local function tools).
 */
import { createHash } from "node:crypto";
import { mapNativeStatus } from "./intents.mjs";

export const CODEX_TOOLS = new Set(["update_plan"]);

export function toolName(input) {
  return String(input?.tool_name || input?.toolName || "");
}

function nativeIdForStep(step) {
  const text = String(step || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
  if (!text) return undefined;
  const h = createHash("sha1").update(text).digest("hex").slice(0, 12);
  return `codex-plan:${h}`;
}

function planItems(input) {
  const ti = input.tool_input || input.toolInput || {};
  if (Array.isArray(ti.plan)) return ti.plan;
  if (Array.isArray(ti.steps)) return ti.steps;
  if (Array.isArray(ti.items)) return ti.items;
  return [];
}

/**
 * @param {object} input hook payload
 * @returns {import('./intents.mjs').MirrorIntent[]}
 */
export function toIntents(input) {
  if (!CODEX_TOOLS.has(toolName(input))) return [];

  const items = planItems(input);
  if (!items.length) return [];

  /** @type {import('./intents.mjs').MirrorIntent[]} */
  const out = [];
  for (const item of items) {
    const step = String(item?.step || item?.content || item?.title || "").trim();
    if (!step) continue;
    const nativeId = nativeIdForStep(step);
    const status = mapNativeStatus(item?.status) || "open";

    /** @type {import('./intents.mjs').UpdateIntent} */
    const u = {
      op: "update",
      nativeId,
      title: step,
      status,
      via: "codex",
    };
    out.push(u);
  }
  return out;
}

/**
 * Gate when the plan still has open work (pending / in_progress).
 * A plan of only completed steps is progress bookkeeping, not new work.
 */
export function wouldCreate(input) {
  if (!CODEX_TOOLS.has(toolName(input))) return false;
  const items = planItems(input);
  if (!items.length) return false;
  return items.some((item) => {
    const s = String(item?.status || "pending").toLowerCase();
    return s === "pending" || s === "open" || s === "in_progress";
  });
}
