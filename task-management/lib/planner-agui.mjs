/**
 * ACP → AG-UI. The translation layer, and nothing but.
 *
 * The dashboard is an AG-UI client. The bridge is the ACP client. This module is the part between
 * them that decides what an ACP `session/update` becomes on the wire to a browser — and it is pure,
 * so the whole contract is testable without a process, a socket, or an agent.
 *
 * Three rules shape every mapping below, and each exists because the obvious alternative is wrong:
 *
 *   1. **Not everything is text.** An agent that streams prose gets that prose routed into a NAMED
 *      slot — clarification, evidence, rationale, result — or dropped. Rendering it as a transcript
 *      is the general chat surface the product refuses, and it is one `default:` branch away at all
 *      times.
 *   2. **Private reasoning is not forwarded.** `agent_thought_chunk` becomes a coarse activity
 *      label with no content. Not redacted downstream, not truncated: never sent.
 *   3. **An unknown update is preserved, never coerced.** ACP is a moving target. A variant this
 *      code has not seen becomes a diagnostic RAW event and does not become text, a tool result, or
 *      a mutation — because guessing which one it is is how an unrecognised message ends up
 *      proposing a board write.
 *
 * `tm.*` CUSTOM names are bridge-owned application events. They are not additions to either
 * protocol, and nothing outside this repository should expect them.
 */

/** The AG-UI event names this bridge emits. Anything not here is a bug, not an extension. */
export const AGUI = Object.freeze({
  RUN_STARTED: "RUN_STARTED",
  RUN_FINISHED: "RUN_FINISHED",
  RUN_ERROR: "RUN_ERROR",
  STATE_SNAPSHOT: "STATE_SNAPSHOT",
  STATE_DELTA: "STATE_DELTA",
  TEXT_MESSAGE_START: "TEXT_MESSAGE_START",
  TEXT_MESSAGE_CONTENT: "TEXT_MESSAGE_CONTENT",
  TEXT_MESSAGE_END: "TEXT_MESSAGE_END",
  ACTIVITY_DELTA: "ACTIVITY_DELTA",
  STEP_STARTED: "STEP_STARTED",
  STEP_FINISHED: "STEP_FINISHED",
  TOOL_CALL_START: "TOOL_CALL_START",
  TOOL_CALL_ARGS: "TOOL_CALL_ARGS",
  TOOL_CALL_END: "TOOL_CALL_END",
  TOOL_CALL_RESULT: "TOOL_CALL_RESULT",
  CUSTOM: "CUSTOM",
  RAW: "RAW",
});

/**
 * The bounded slots agent prose may land in.
 *
 * An agent does not choose its own slot — the bridge classifies from the surrounding lifecycle,
 * because a model that could name its own slot could name `result` for anything it wanted the
 * operator to believe.
 */
export const SLOTS = Object.freeze(["clarification", "evidence", "rationale", "result"]);

const event = (type, extra = {}) => ({ type, ...extra });

/**
 * Which slot text belongs in, given where the run is.
 *
 * Derived from lifecycle, never from the text. Before any tool has run, prose is the agent
 * clarifying; after a read, it is summarising evidence; alongside a proposal it is rationale; after
 * the prompt resolves it is the terminal result.
 */
export function slotFor({ toolsSeen = 0, proposed = false, finished = false } = {}) {
  if (finished) return "result";
  if (proposed) return "rationale";
  return toolsSeen > 0 ? "evidence" : "clarification";
}

/**
 * A read-only tool call, or one that would mutate the board?
 *
 * The classification is by allowlist: a name this bridge does not recognise as a read is treated as
 * a mutation, so an unfamiliar tool needs an approval rather than slipping through as a read. Fail
 * closed is the only safe direction when the question is "may this write".
 */
const READ_ONLY = new Set([
  "read", "read_file", "readfile", "grep", "search", "glob", "list", "list_dir", "ls",
  "tm_board", "tm_show", "tm_find", "tm_why", "tm_graph", "tm_history",
]);

export function toolClass(name) {
  return READ_ONLY.has(String(name || "").toLowerCase()) ? "read" : "mutation";
}

/**
 * Translate one ACP `session/update` into zero or more AG-UI events.
 *
 * `state` is the bridge's own view of the run and is READ here, not mutated — the caller owns it,
 * so this stays a function of its inputs and a test can drive any point of a run directly.
 */
export function translate(update, state = {}) {
  const kind = update?.sessionUpdate;
  switch (kind) {
    // The v1 echo of what we just sent. Diagnostics only: rendering it would put the operator's own
    // goal back on screen as though the agent had said it.
    case "user_message_chunk":
      return state.diagnostics ? [event(AGUI.RAW, { raw: update })] : [];

    case "agent_message_chunk": {
      const text = textOf(update.content);
      if (!text) return [];
      const slot = slotFor(state);
      return [
        event(AGUI.TEXT_MESSAGE_START, { messageId: state.messageId ?? null, slot }),
        event(AGUI.TEXT_MESSAGE_CONTENT, { messageId: state.messageId ?? null, slot, delta: text }),
      ];
    }

    // Rule 2. A label, never the content.
    case "agent_thought_chunk":
      return [event(AGUI.ACTIVITY_DELTA, { activity: "thinking" })];

    case "plan": {
      // Every entry is agent-supplied and none of it is trusted to be an object. `entries: [null]`
      // threw here, and this runs on a stdout listener, so the throw took the host process with it.
      const steps = (Array.isArray(update.entries) ? update.entries : []).filter((s) => s && typeof s === "object");
      return [
        event(AGUI.STATE_DELTA, {
          path: "/planner/steps",
          value: steps.map((s) => ({ id: String(s.id ?? ""), title: String(s.content ?? s.title ?? ""), status: String(s.status ?? "pending") })),
        }),
      ];
    }

    case "tool_call": {
      const id = String(update.toolCallId ?? "");
      const name = String(update.title ?? update.kind ?? "tool");
      return [
        event(AGUI.TOOL_CALL_START, { toolCallId: id, toolName: name, toolClass: toolClass(name) }),
        ...(update.rawInput ? [event(AGUI.TOOL_CALL_ARGS, { toolCallId: id, args: update.rawInput })] : []),
      ];
    }

    case "tool_call_update": {
      const id = String(update.toolCallId ?? "");
      const status = String(update.status ?? "");
      if (status === "completed" || status === "failed") {
        return [
          event(AGUI.TOOL_CALL_END, { toolCallId: id }),
          event(AGUI.TOOL_CALL_RESULT, {
            toolCallId: id,
            failed: status === "failed",
            // Verbatim. A store refusal reaching the operator paraphrased is the failure the whole
            // approval design exists to prevent.
            result: textOf(update.content) || null,
          }),
        ];
      }
      return [event(AGUI.ACTIVITY_DELTA, { toolCallId: id, activity: status || "in_progress" })];
    }

    // Capability and session changes: mapped where known, and the variant set is treated as open.
    case "available_commands_update":
    case "current_mode_update":
    case "config_option_update":
    case "session_info_update":
    case "usage_update":
      return [
        event(AGUI.STATE_DELTA, { path: "/planner/agent", value: { [kind]: summarize(update) } }),
        ...(state.diagnostics ? [event(AGUI.RAW, { raw: update })] : []),
      ];

    // Rule 3.
    default:
      return [
        event(AGUI.RAW, { raw: update }),
        event(AGUI.CUSTOM, { name: "tm.bridge.unknown_update", value: { sessionUpdate: kind ?? null } }),
      ];
  }
}

/** ACP content blocks are a list of typed parts; only text is ever forwarded. */
function textOf(content) {
  if (content == null) return "";
  if (typeof content === "string") return content;
  const parts = Array.isArray(content) ? content : [content];
  return parts
    .filter((p) => p && (p.type === "text" || typeof p.text === "string"))
    .map((p) => String(p.text ?? ""))
    .join("");
}

/** A shallow, bounded summary — never the whole payload, which may carry anything. */
function summarize(update) {
  const out = {};
  for (const [k, v] of Object.entries(update)) {
    if (k === "sessionUpdate" || k === "sessionId") continue;
    if (v == null) continue;
    if (typeof v === "string") out[k] = v.slice(0, 200);
    else if (typeof v === "number" || typeof v === "boolean") out[k] = v;
    else if (Array.isArray(v)) out[k] = v.length;
    else out[k] = Object.keys(v).slice(0, 20);
  }
  return out;
}

/**
 * An ACP permission request becomes a confirmation over the exact proposal, never a bare
 * approve button.
 *
 * The offered `optionId` is carried through untouched and answered with, rather than being
 * reconstructed from the label shown on screen: the label is presentation, the id is the protocol,
 * and inventing one is how a UI ends up answering a question the agent did not ask.
 *
 * A request that cannot be matched to the active proposal returns `null` — the caller must then
 * refuse it. Showing a generic confirmation for an unmatched request would ask the operator to
 * approve something neither side can name.
 */
export function permissionRequest(request, { proposalDigest = null } = {}) {
  const options = Array.isArray(request?.options) ? request.options : [];
  if (!options.length) return null;
  const allowOnce = options.find((o) => o.kind === "allow_once");
  return {
    toolCallId: String(request?.toolCall?.toolCallId ?? ""),
    proposalDigest,
    options: options.map((o) => ({ optionId: String(o.optionId ?? ""), kind: String(o.kind ?? ""), name: String(o.name ?? o.kind ?? "") })),
    // Allow-once is the default the product asks for. `allow_always` is offered by the agent, not
    // by us, and must never be selected as a silent upgrade of a once decision.
    preferred: allowOnce ? String(allowOnce.optionId) : null,
    events: [
      event(AGUI.CUSTOM, { name: "tm.permission.requested", value: { toolCallId: String(request?.toolCall?.toolCallId ?? ""), digest: proposalDigest } }),
      event(AGUI.STATE_DELTA, { path: "/planner/permission", value: { pending: true, digest: proposalDigest } }),
    ],
  };
}

/** The run lifecycle, so a caller does not hand-roll these three. */
export const lifecycle = {
  started: (runId, threadId) => event(AGUI.RUN_STARTED, { runId, threadId }),
  finished: (runId, reason = "end_turn") => event(AGUI.RUN_FINISHED, { runId, reason }),
  /** Safe fields only: an ACP error may carry data the browser has no business seeing. */
  error: (runId, err) => event(AGUI.RUN_ERROR, { runId, code: err?.code ?? null, message: String(err?.message ?? err ?? "the planner failed") }),
};
