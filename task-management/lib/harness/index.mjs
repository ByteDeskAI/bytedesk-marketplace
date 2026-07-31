/**
 * Native-task Bridge for multi-harness agents.
 *
 * GoF mapping (source-neutral names in production):
 *
 *   Bridge
 *     Abstraction  → durable store ops (`applyIntents`) — stable domain API
 *     Implementors → wire adapters (`claude`, `grok`) that only translate payloads
 *
 *   Adapter
 *     Each harness module converts foreign tool I/O into MirrorIntent[]
 *
 *   Strategy (function map)
 *     `ADAPTERS` selects the implementor by tool name at runtime
 *
 * Adding a third harness = one adapter module + one registry entry.
 * Claude and Grok share gates (`gateTaskCreate`) and apply paths unchanged.
 */
import * as claude from "./claude.mjs";
import * as grok from "./grok.mjs";
import { applyIntents } from "./apply.mjs";
import { gateTaskCreate } from "../enforce.mjs";

/** @type {Record<string, { toIntents: Function, wouldCreate: Function }>} */
const ADAPTERS = {
  TaskCreate: claude,
  TaskUpdate: claude,
  todo_write: grok,
};

export function toolNameOf(input) {
  return String(input?.tool_name || input?.toolName || "");
}

export function adapterFor(input) {
  return ADAPTERS[toolNameOf(input)] || null;
}

/**
 * Strategy map entry point: wire → intents.
 * @returns {import('./intents.mjs').MirrorIntent[]}
 */
export function toIntents(input) {
  const adapter = adapterFor(input);
  if (!adapter) return [];
  try {
    return adapter.toIntents(input) || [];
  } catch {
    return [];
  }
}

/**
 * Pre-create gate: only when the harness write would introduce new work.
 * Returns { allow, reason?, denyPayload? } where denyPayload is dual-shaped
 * for Claude (permissionDecision) and Grok (decision: deny).
 */
export function preCreateGate(input, p) {
  const adapter = adapterFor(input);
  if (!adapter) return { allow: true };
  let creates = false;
  try {
    creates = !!adapter.wouldCreate(input);
  } catch {
    creates = false;
  }
  if (!creates) return { allow: true };

  const gate = gateTaskCreate(p);
  if (gate.allow) return { allow: true };

  const reason = gate.reason;
  return {
    allow: false,
    reason,
    // Dual deny envelope: Claude reads hookSpecificOutput; Grok reads decision.
    denyPayload: {
      decision: "deny",
      reason,
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
      },
      systemMessage: reason,
    },
  };
}

/**
 * Post-tool mirror: translate then apply.
 * @param {object} input
 * @param {object} p paths
 * @param {{ stamp: Function, findDuplicate?: Function }} helpers
 */
export function mirrorNative(input, p, helpers) {
  const intents = toIntents(input);
  applyIntents(intents, { p, stamp: helpers.stamp, findDuplicate: helpers.findDuplicate });
}

export { applyIntents } from "./apply.mjs";
export { CLAUDE_TOOLS } from "./claude.mjs";
export { GROK_TOOLS } from "./grok.mjs";
