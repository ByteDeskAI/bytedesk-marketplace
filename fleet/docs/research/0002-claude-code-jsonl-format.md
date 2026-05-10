# Claude Code JSONL Transcript Format

**Status:** Reverse-engineered, 2026-05-10. Not an official spec — Claude Code may add or change fields between minor versions. Confirmed against `claude-code v2.1.126` and `v2.1.138` transcripts.

## Where the files live

Claude Code writes one `.jsonl` per conversation to:

```
~/.claude/projects/<sanitized-cwd>/<session-uuid>.jsonl
```

`<sanitized-cwd>` is the absolute working directory with `/` replaced by `-` and a leading `-`. Examples:

| Working directory | Sanitized dir |
|---|---|
| `/home/ryan/Documents/GitHub/bytedesk-marketplace` | `-home-ryan-Documents-GitHub-bytedesk-marketplace` |
| `/home/ryan/.claude/double-shot-latte` | `-home-ryan--claude-double-shot-latte` |

A single project dir contains one `.jsonl` per conversation; the **most-recently-modified** file is the active conversation. Sub-agents write under a `subagents/` subdir with their own `.jsonl` files (`agent-<id>.jsonl`); those entries carry `isSidechain: true` and `agentId` / `slug` fields.

## Per-line shape

Every line is one JSON object with a top-level `type`. The 11 known types are split into three groups:

### Conversation entries (carry timestamps and lineage)

These have `parentUuid`, `uuid`, `timestamp`, `sessionId`, `cwd`, `version`, `gitBranch`, and `entrypoint`.

- **`user`** — a user turn. The actual content can be:
  - human prompt text (`message.content` is a string)
  - a tool result (`message.content` is an array of `tool_result` blocks)
- **`assistant`** — claude's turn. Carries `message` with `role`, `model`, `stop_reason`, `usage`, and a `content[]` array.
- **`system`** — non-conversational events. The `subtype` field discriminates.
- **`attachment`** — auxiliary structured content surfaced into the conversation (hook output, memory files, plan-mode metadata, etc.).

### Session-scoped metadata (no per-line timestamp; latest wins)

- **`ai-title`** — claude's auto-generated short title for the session. `{type, aiTitle, sessionId}`.
- **`agent-name`** — agent identifier (often equal to `aiTitle`). `{type, agentName, sessionId}`.
- **`last-prompt`** — the most recent user prompt text (echoed for fast lookup). `{type, lastPrompt, leafUuid, sessionId}`.
- **`permission-mode`** — current permission mode. `{type, permissionMode, sessionId}`. Values include `default`, `plan`, `acceptEdits`, `bypassPermissions`.
- **`pr-link`** — written when claude opens a GitHub PR via `gh`. `{type, sessionId, prNumber, prUrl, prRepository, timestamp}`.

### Lifecycle / diff tracking

- **`file-history-snapshot`** — backups of files claude is about to modify. `{type, messageId, snapshot:{messageId, trackedFileBackups, timestamp}, isSnapshotUpdate}`.
- **`queue-operation`** — user-side command queueing. `{type, operation, timestamp, sessionId, content}`. Operations: `enqueue`, `dequeue`, `remove`.

## `assistant.message` deep-dive

```json5
{
  "type": "assistant",
  "uuid": "…",
  "parentUuid": "…",
  "timestamp": "2026-05-02T08:50:50.123Z",
  "sessionId": "…",
  "cwd": "…",
  "gitBranch": "main",
  "message": {
    "role": "assistant",
    "model": "claude-opus-4-7",
    "stop_reason": "tool_use" | "end_turn" | "stop_sequence" | "max_tokens",
    "content": [
      {"type": "thinking", "thinking": "…", "signature": "…"},
      {"type": "text", "text": "…"},
      {"type": "tool_use", "id": "toolu_…", "name": "Bash", "input": {...}, "caller": {...}}
    ],
    "usage": {
      "input_tokens": 6,
      "cache_creation_input_tokens": 43594,
      "cache_read_input_tokens": 0,
      "output_tokens": 248,
      "server_tool_use": {"web_search_requests": 0, "web_fetch_requests": 0},
      "service_tier": "standard",
      "cache_creation": {"ephemeral_1h_input_tokens": 43594, "ephemeral_5m_input_tokens": 0},
      "iterations": [/* per-iteration breakdown for streaming */]
    }
  }
}
```

### `stop_reason` semantics

| Value | Meaning |
|---|---|
| `tool_use` | claude is mid-iteration; another `assistant` entry follows after the tool returns |
| `end_turn` | claude finished its turn — awaits user input or shuts down |
| `stop_sequence` | claude emitted a configured stop sequence |
| `max_tokens` | hit the per-turn output cap (treat as error in fleet) |

### Content block types

| Type | Notes |
|---|---|
| `text` | claude's reply prose (markdown) |
| `thinking` | extended-thinking trace; `signature` is a server-side cryptographic seal so the trace can be verified across requests |
| `tool_use` | `{id, name, input, caller}`. `name` is the tool: `Bash`, `Read`, `Edit`, `Write`, `TaskCreate`, `mcp__playwright__browser_*`, etc. |
| `tool_result` | only inside `user` messages; carries `{tool_use_id, content, is_error}` |
| `image` | `{source: {type:"base64", media_type, data}}` for screenshots/uploads |

## `system.subtype` catalog

| Subtype | Notes |
|---|---|
| `stop_hook_summary` | result of post-turn hooks. `{hookCount, hookInfos, hookErrors, preventedContinuation, stopReason, hasOutput, level, toolUseID}` |
| `turn_duration` | wall-clock `durationMs` and `messageCount` for the turn that just ended |
| `away_summary` | claude's recap on returning from background work |
| `local_command` | output of slash commands or shell-prefixed input |
| `compact_boundary` | conversation auto-compacted. `{compactMetadata: {trigger, preTokens, preCompactDiscoveredTools}}` |
| `api_error` | upstream Anthropic API failure. `{level:"error", error:{status, headers, body}}` |

## `attachment.type` catalog

| Type | Use |
|---|---|
| `task_reminder` | TaskList state injected each turn |
| `hook_non_blocking_error` | hook printed to stderr without exiting non-zero |
| `hook_success` | successful hook output (e.g., `SessionStart:clear` adding context) |
| `nested_memory` | a `CLAUDE.md` discovered under cwd was loaded |
| `diagnostics` | LSP / build diagnostics surfaced into the conversation |
| `queued_command` | mirrored from a `queue-operation` |
| `command_permissions` | resolved per-command permissions |
| `file` | a file the user dragged in |
| `deferred_tools_delta` | newly-loaded MCP tool schemas (lazy-loaded on demand) |
| `mcp_instructions_delta` | new MCP server instructions surfaced |
| `edited_text_file` | snapshot of a file claude just edited |
| `compact_file_reference` | a reference inserted post-compact pointing into pre-compact memory |
| `skill_listing` | available skills (`/skill` registry) |
| `plan_mode` / `plan_mode_exit` / `plan_file_reference` | plan-mode state transitions |
| `invoked_skills` | skills the user invoked this session |

## Sub-agent transcripts

Sub-agents (Task tool spawns, plan-agent invocations) write their own jsonl under:

```
~/.claude/projects/<sanitized-cwd>/subagents/agent-<agentId>.jsonl
```

Every entry carries `isSidechain: true`, `agentId`, and `slug`. Otherwise the schema is identical.

## Robustness notes

- **Treat unknown `type` values as future-compat data.** Skip what you don't recognize; don't error out.
- **Lines may be truncated mid-write** if the file is being tailed during a flush. Wrap `json.Unmarshal` in try-and-skip.
- **Image base64 blobs are huge.** When tailing for state derivation, drop `image` content blocks before persisting.
- **Order matches wall-clock.** Within a session id, entries are append-only and timestamps monotonically increase (modulo clock skew).
- **`signature` on `thinking` blocks is opaque.** Don't try to reformat it.

## How fleet uses this

`fleet/web/server/transcript.go` walks the tail of the active jsonl to derive per-session state without parsing rendered terminal bytes. The detection cascade is documented in `fleet/docs/adr/0003-web-dashboard-architecture.md` (Section 9). Future tooling can subscribe to a tailed stream of these events for richer UI surfaces — see ideas at the bottom of that ADR and the open tickets under BDM.
