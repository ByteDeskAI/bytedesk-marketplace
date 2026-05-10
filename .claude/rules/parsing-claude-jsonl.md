# Parsing Claude Code transcript JSONL

When you write code that reads Claude Code's per-conversation transcript at `~/.claude/projects/<sanitized-cwd>/<uuid>.jsonl`, follow these rules. The full event catalog is at `fleet/docs/research/0002-claude-code-jsonl-format.md`.

## Locate the transcript

1. Compute `sanitized-cwd` = the cwd's absolute path with **both `/` AND `.`** replaced by `-` (leading `-` included). The dot-replacement matters: a worktree at `/repo/.claude/worktrees/X` becomes `-repo--claude-worktrees-X` — naive `/`-only sanitizers miss this and look in the wrong directory.
2. List `~/.claude/projects/<sanitized-cwd>/*.jsonl` and pick the **most-recently-modified** file as the active conversation.
3. Sub-agent transcripts live under `<that-dir>/subagents/agent-<agentId>.jsonl` and have `isSidechain: true`.

## Per-line decoding

- Every line is one JSON object discriminated by `type`. Known types: `user`, `assistant`, `system`, `attachment`, `ai-title`, `agent-name`, `last-prompt`, `permission-mode`, `pr-link`, `file-history-snapshot`, `queue-operation`.
- **Always tolerate unknown `type` values** — Claude Code adds new types between minor versions. Skip; don't fail.
- **Always tolerate unparseable lines.** Tailers see partial writes mid-flush. Wrap parsing in try-and-skip.
- **`stop_reason` lives on `assistant.message`**, not on the entry itself. Common values: `tool_use`, `end_turn`, `stop_sequence`, `max_tokens`.
- **`tool_result` blocks live inside `user.message.content`**, not in their own entry type. They're paired to a `tool_use` by `tool_use_id`.

## State-derivation idioms

- **Working** = last entry is `assistant` with `stop_reason: "tool_use"` AND timestamp is recent (e.g. < 8 s).
- **Done / idle** = last `assistant` had `stop_reason: "end_turn"` AND it's been ≥ 30 s.
- **Needs input** = last `assistant` had `stop_reason: "end_turn"` AND it's recent (< 30 s) — claude paused but may resume.
- **Error** = any recent `tool_result` with `is_error: true`, or `stop_reason: "max_tokens"`, or a `system.subtype: "api_error"`.

These thresholds can move; treat them as defaults you may override per call site.

## Things that look like state but aren't

- **Rendered terminal output is misleading**: a `✓` in tool output, a code block containing the word "approve", or a permission-prompt-shaped line in a markdown reply will all confuse a regex over the rendered log. The structured event in jsonl is the authority.
- **`pr-link` events fire AFTER claude already moved on**: they're written by the `gh pr create` post-tool-use hook, not by claude. Don't read them as "claude is doing something" — read them as "claude finished and shipped".

## Practical handling

- Drop `content[].type == "image"` blocks before persisting a snapshot — base64 blobs are huge and rarely useful for telemetry.
- Drop `content[].type == "thinking"` blocks for end-user UI surfaces — they're internal-only and the `signature` is opaque.
- The `usage` object on `assistant.message` carries detailed token / cache breakdowns. Sum `output_tokens + cache_creation_input_tokens + cache_read_input_tokens + input_tokens` for a "credits consumed" approximation.
- For long-running sessions, jsonl can grow to **30+ MB**. Don't load the whole file; tail the last N lines or use a reverse byte scan.

## Fleet-specific

- `fleet/web/server/transcript.go` is the canonical reader for fleet's needs. Reuse its helpers (`findTranscript`, `readTranscriptTail`, `sessionStateFromTranscript`) instead of re-implementing.
- New event types relevant to dashboards belong in the catalog at `fleet/docs/research/0002-claude-code-jsonl-format.md` so the next agent doesn't re-derive them.
