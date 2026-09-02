/**
 * Adapter: Pi (`pi`, @earendil-works/pi-coding-agent) wire → domain MirrorIntent[].
 *
 * Pi is the measured empty case of the bridge contract. pi 0.82.0 ships exactly seven
 * built-in tools — read, bash, edit, write, grep, find, ls (dist/core/tools/, and the
 * tool-registry note in its CHANGELOG 0.34.0) — and none is a task surface. The todo
 * list and plan-mode that CHANGELOG describes are EXAMPLE extensions
 * (examples/extensions/todo.ts, plan-mode/) a user copies in, not tools the binary
 * registers. A histogram of every toolCall in this machine's own ~/.pi/agent/sessions
 * says the same: bash/read/edit/mcp/write/grep plus MCP-provided tools, zero task-tool
 * calls (TM-081).
 *
 * So PI_TOOLS is empty and toIntents/wouldCreate are inert — deliberately. An invented
 * tool name would read as support and silently never match, the CODEX_SESSION_ID lesson
 * from sessions.mjs. Pi's task surface is the MCP tm_* tools (pi-mcp-adapter reads a
 * Claude-shaped mcp.json), which write the store directly and need no mirror; the
 * lifecycle gates ride the extension in hooks/pi-hooks.example.ts.
 *
 * The seam, if a future pi ships or an extension registers a real task tool: add the
 * tool name to PI_TOOLS, map its payload below (codex.mjs is the template for id-less
 * lists — nativeId from a content hash, statuses through intents.mjs mapNativeStatus),
 * register the names in index.mjs ADAPTERS, and match them in the extension's
 * tool_call handler.
 */

/** Measured empty on pi 0.82.0 — see the module header. */
export const PI_TOOLS = new Set([]);

export function toolName(input) {
  return String(input?.tool_name || input?.toolName || "");
}

/**
 * @param {object} input hook payload
 * @returns {import('./intents.mjs').MirrorIntent[]}
 */
export function toIntents(input) {
  if (!PI_TOOLS.has(toolName(input))) return [];
  return []; // no Pi payload maps to work today — the module header is the measurement
}

/** Nothing to gate: a Pi tool call never introduces mirrored work. */
export function wouldCreate(input) {
  if (!PI_TOOLS.has(toolName(input))) return false;
  return false;
}
