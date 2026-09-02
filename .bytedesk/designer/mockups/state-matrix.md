# Goal planner state matrix — ACP → bridge → AG-UI → visible UI

Status: design contract proposal, not an implemented wire adapter. Protocol names were checked on 2026-09-02 against the [AG-UI event reference](https://docs.ag-ui.com/sdk/js/core/events), the [ACP v2 overview](https://github.com/agentclientprotocol/agent-client-protocol/blob/main/docs/protocol/v2/overview.mdx), and the current [ACP v1 JSON schema](https://github.com/agentclientprotocol/agent-client-protocol/blob/main/schema/v1/schema.json).

## Boundary and ownership

```text
Task Management dashboard
  └─ AG-UI RunAgent input / typed event stream
       └─ backend bridge (policy, correlation, normalization, redaction)
            └─ ACP session with the operator-selected trusted coding agent
                 └─ governed task-management skills/tools
                      └─ the existing store functions and gates
```

- The browser is an AG-UI client. It never launches a coding-agent process, handles agent credentials, or speaks ACP.
- The backend bridge is the ACP client. It negotiates the ACP version, owns process/session health, correlates ACP session activity to an AG-UI `threadId` and `runId`, and preserves the ACP payload in AG-UI `rawEvent` where safe.
- `tm.*` AG-UI `CUSTOM` names below are bridge-owned application events, not additions to either protocol.
- Governed task-management writes still go through the same store functions and completeness gates as CLI/MCP/HTTP. The bridge does not write the board directly.
- The planner does not depend on the Claude Agent SDK. A Claude Code installation may be one operator-selected agent only when it is reached through its ACP adapter, exactly like any other trusted ACP agent.

## Run, update, and tool mapping

| ACP input at bridge | Bridge rule | AG-UI output | Visible state |
|---|---|---|---|
| Agent selected; `initialize` and `session/new` or `session/resume` succeed | Snapshot negotiated version, agent label, transport, supported prompt content, elicitation support, and governed tool health. Never expose command path or credentials to the browser. | `STATE_SNAPSHOT` with `/planner/agent` and `/planner/capabilities` | **Agent selection / health**: selected agent, `ACP connected`, task skills `available`, board writes `confirm each set`. |
| ACP initialize/spawn/auth fails | Retain the goal draft; do not send `session/prompt`; do not infer capability health. | `RUN_ERROR`; `STATE_DELTA` setting `/planner/agent/status = unavailable` | **Unavailable agent**: blocking error, exact bridge wording, switch-agent and manual-import actions. |
| Dashboard submits one bounded goal | Validate route, repo scope, required outcome, selected trusted agent, and capability health before prompting. Create local correlation record `{threadId, runId, acpSessionId}`. | `RUN_STARTED`; `STATE_SNAPSHOT`; then bridge sends ACP `session/prompt` | **Streaming** header begins. No chat transcript is opened. |
| ACP `session/update.user_message_chunk` (v1 echo/replay) | De-duplicate against submitted goal. Retain only for trace/replay diagnostics. | Usually no user-facing event; `RAW` only when diagnostics are enabled | No duplicate user bubble or goal card. |
| ACP `session/update.agent_message_chunk` | Accumulate only content classified for a bounded slot: clarification lead, evidence summary, proposal rationale, or terminal summary. Reject/clip unrelated general-chat output. | `TEXT_MESSAGE_START` → `TEXT_MESSAGE_CONTENT` → `TEXT_MESSAGE_END`, with bridge slot metadata in `rawEvent` | Text appears inside the relevant structured section, never as alternating speech bubbles. |
| ACP `session/update.agent_thought_chunk` or equivalent reasoning content | Do not forward private chain-of-thought. Derive only coarse activity labels from tool/plan lifecycle. | Optional `REASONING_START` / `REASONING_END` without content, or `ACTIVITY_DELTA` | “Inspecting repository” / current step only. No reasoning transcript. |
| ACP `session/update.plan` | Normalize stable step id, title, status, and dependency only. | `STATE_DELTA` on `/planner/steps`; `STEP_STARTED` / `STEP_FINISHED` when status changes | Compact step progress in **AG-UI streaming / tool calls**. |
| ACP `session/update.tool_call` with `status: pending` | Create one stable tool row keyed by ACP `toolCallId`; classify read vs proposed mutation. Buffer streamed input fragments until valid JSON. | `TOOL_CALL_START`; one or more `TOOL_CALL_ARGS` | Tool name, read/write class, progressively inspectable arguments, pending status. |
| ACP `session/update.tool_call_update` with `status: in_progress` | Update the same row. Redact secrets and content outside repo scope. | `TOOL_CALL_END` once args are complete; `ACTIVITY_DELTA` or `STATE_DELTA` for progress | Running state; terminal output is collapsed and opt-in, never fake terminal chrome. |
| Read-only governed tool completes | Preserve the store result or refusal verbatim after redaction. | `TOOL_CALL_RESULT`; `STEP_FINISHED` when applicable | Completed tool row; evidence summary can update. |
| Governed board mutation is proposed but not authorized | Freeze normalized tool name, arguments, consequence, validation result, and dependency ordering. No store function runs yet. | `STATE_DELTA` adding `/planner/proposalSet`; `CUSTOM tm.proposal.ready` | **Proposed skill actions**: inspectable mutation cards. Exactly one focused card may carry the claimed edge-light. |
| Governed tool returns a store refusal | Preserve the exact server message. Mark no unconfirmed sibling mutation as successful. | `TOOL_CALL_RESULT` with refusal; `RUN_ERROR` only if the run cannot continue; `STATE_DELTA` on proposal status | **Validation failure**: inline refusal at the action plus polite live-region announcement. |
| ACP `session/update.available_commands_update`, `current_mode_update`, `config_option_update`, `session_info_update`, or `usage_update` | Treat the variant set as open. Map known capability/session changes; never make usage a hero metric. | `STATE_DELTA` under `/planner/agent` or `/planner/run`; unknown variants also emit diagnostic `RAW` | Agent/health inspector updates without changing page hierarchy. |
| ACP `session/prompt` resolves with an idle/terminal stop reason | Finish the correlated run only after outstanding permission responders and tool rows are settled. | `RUN_FINISHED`; final `STATE_DELTA` | Final structured result: proposal ready, import success, refusal, or cancelled. |
| ACP `session/prompt` returns a JSON-RPC error | Preserve safe code/message/data, clear running state, retain draft and proposal. | `RUN_ERROR` | Inline failure with retry/switch/manual-import actions. |
| Dashboard cancels | Send ACP `session/cancel`; respond to every pending ACP permission request with `outcome: cancelled`; accept final tool updates until the cancelled stop response. | `CUSTOM tm.run.cancelled`; `RUN_FINISHED` after cancellation settles | Run reads cancelled. No proposed or partial write is shown as applied. |
| ACP sends an unknown `session/update` variant | Preserve forward compatibility. Do not coerce it into text, a tool result, or a mutation. | `RAW` with safe original event; optionally `CUSTOM tm.bridge.unknown_update` for diagnostics | Trace-only “unsupported update”; primary workflow continues when safe. |

## Elicitation and attachment mapping

ACP keeps structured information requests distinct from permission requests; the UI must preserve that separation.

| ACP / dashboard input | Bridge rule | AG-UI output | Visible state |
|---|---|---|---|
| ACP `elicitation/create` in supported form mode | Accept only bounded goal decisions and the supported flat schema. Strip any request for credentials or unrelated personal data. | `CUSTOM tm.elicitation.requested`; `STATE_DELTA` adding `/planner/questions/{id}` | **Questioning**: numbered decision block with evidence and explicit choices, not a chat bubble. |
| Operator submits answer | Validate against the requested schema; return ACP elicitation action `accept` with content. | `CUSTOM tm.elicitation.resolved`; `STATE_DELTA` marking answer | Choice persists inline; next unresolved decision receives focus. |
| Operator declines/cancels elicitation | Return ACP action `decline` or `cancel` exactly. | `CUSTOM tm.elicitation.resolved`; optionally `RUN_FINISHED` if the goal cannot continue | Decision reads declined/cancelled; draft remains. |
| User selects or drops attachments | Show names before transfer. Bridge checks size/type, repo/user scope, and ACP prompt capabilities. Images/resources are sent only when the selected ACP agent declared support. | `STATE_DELTA` adding local attachment states; `CUSTOM tm.attachment.accepted` after bridge acceptance | **Attachment upload**: `selected → scanning → ready/refused`; label says “session context · not board evidence.” |
| Attachment rejected | Preserve bridge wording and remove the bytes from pending context. | `CUSTOM tm.attachment.refused`; `STATE_DELTA` | Inline refusal at that file; planning can continue without it when optional. |

## ACP permission request mapping

ACP `session/request_permission` contains `sessionId`, a `toolCall` update, and agent-provided options. The current schema defines option kinds `allow_once`, `allow_always`, `reject_once`, and `reject_always`; the response is either `{ outcome: "selected", optionId }` or `{ outcome: "cancelled" }`. The bridge must preserve the offered `optionId` rather than inventing a response from the displayed label.

| ACP permission condition / operator choice | Bridge and AG-UI mapping | Visible state and guardrail |
|---|---|---|
| `session/request_permission` arrives for a normalized task-management mutation set | Hold the ACP responder outside the connection dispatch loop. Join the request to the proposal set by session/tool id. Emit `CUSTOM tm.permission.requested` and `STATE_DELTA /planner/permission`. | **Confirmation**: modal names tool set, exact consequences, proposed entities, validation, and options. Background remains the inspectable proposal. |
| `allow_once` selected | Respond `{ outcome: "selected", optionId }`; emit `CUSTOM tm.permission.resolved {kind:"allow_once"}`; allow the governed tool path to continue. | Primary “Allow once & apply.” No persistent permission is implied. |
| `allow_always` offered and selected | Show the agent-provided scope and a separate persistence consequence. The product policy may hide/disable this option; it must never silently upgrade `allow_once`. Respond with the offered `optionId` only after explicit confirmation. | Secondary persistent-permission action with stronger warning; never the default in goal planning. |
| `reject_once` selected | Respond with the offered reject-once `optionId`; emit `tm.permission.resolved`; keep proposal inspectable. | Proposal reads rejected for this run; no board mutation. “Revise” and “Close” remain. |
| `reject_always` offered and selected | Require a second consequence sentence because it changes future agent behavior. Respond with the offered `optionId` only after confirmation. | Persistent deny shown in agent health/config; no mutation. |
| Prompt/run cancelled while permission is pending | Respond `{ outcome: "cancelled" }` as ACP requires; then settle cancellation. | Confirmation closes, run reads cancelled, draft/proposal retained. |
| Permission request cannot be matched to the active session/tool/proposal | Do not display a generic approve button. Return an error/cancel according to the negotiated ACP version and log a bridge fault. | Blocking bridge error in trace; no write executes. |

## Visible state inventory

| Mockup scenario | Entry signal | Primary controls | Exit |
|---|---|---|---|
| Empty | No active run | Outcome, import instead, start | Questioning or manual import |
| Questioning | `tm.elicitation.requested` | Structured choices | Attachment / streaming |
| Attachment upload | User or agent requests context | File picker/drop, review list | Streaming |
| Agent selection / health | Agent chosen or preflight requested | Agent select, health inspect/recheck | Empty/ready or unavailable |
| AG-UI streaming / tool calls | `RUN_STARTED` and tool lifecycle | Cancel, inspect rows | Proposed / error |
| Proposed skill actions | `tm.proposal.ready` | Expand params, reject, review approval | Confirmation / questioning |
| Confirmation | `tm.permission.requested` | Reject/back, explicit review checkbox, allow once | Import success / proposed |
| Validation failure | Store refusal or bridge validation | Inspect, revise | Proposed / streaming |
| Import success | Tool results + board state delta | Open entities, plan another | Existing Board / Plans IA |
| Offline | AG-UI transport/bridge failure | Retry, prepare manual import | Health / manual path |
| Unavailable agent | ACP spawn/init/auth/capability failure | Switch agent, manual import | Health / manual path |

## Manual import path

Manual repo-path/paste import does not require an ACP session. It continues through the existing dashboard backend into `goalImport`, with the same store gates and verbatim refusals. Its success/refusal should still be normalized into the same result and live-region components so planner-created and manually imported goals do not develop conflicting status vocabularies.

## Version and correlation risk

- ACP v2 is evolving. Its overview separates `session/prompt` acceptance from `session/update` observation, and session updates do not necessarily carry a prompt/turn id. The bridge must pin and negotiate a schema version, own the local correlation record, and accept updates before/during/after the prompt response.
- The current v1 schema contains more `session/update` variants than older prose summaries. The adapter must generate/validate types from the negotiated schema and retain unknown variants as `RAW`; a closed switch is unsafe.
- AG-UI `CUSTOM` payloads need a versioned ByteDesk namespace and runtime schema before implementation. The `tm.*` payload shapes in this document are design names, not finalized API contracts.
