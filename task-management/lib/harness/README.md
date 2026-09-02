# Native-task Bridge (multi-harness)

## Patterns

| GoF | Role here |
|-----|-----------|
| **Bridge** | Domain store ops (`apply.mjs`) stay stable while wire implementors vary. |
| **Adapter** | `claude.mjs` / `grok.mjs` / `codex.mjs` / `kimi.mjs` / `pi.mjs` convert foreign tool payloads into `MirrorIntent[]` only. |
| **Strategy** | `ADAPTERS` map in `index.mjs` selects the adapter by `tool_name`. |

| Harness | Native tools mirrored |
|---------|------------------------|
| Claude Code | `TaskCreate`, `TaskUpdate` |
| Grok | `todo_write` |
| Codex CLI | `update_plan` |
| Kimi Code | `TodoList` |
| Pi | none — measured absent on 0.82.0 (see `pi.mjs`); tasks use the MCP `tm_*` tools |

## The universal adapter contract

Porting the plugin to a harness means answering four questions about it. Only the
first is close to universal; the rest are independently optional, and a measured
"absent" is a complete answer — Pi is the worked example (extension hooks, session
env var, no native task tool, transcript with raw fallback).

1. **Hooks.** How does the harness run code around tool calls and lifecycle? Shell
   commands (Claude `hooks.json`, Kimi `[[hooks]]` in config.toml), in-process
   extensions (Pi), or nothing. Needed for the create gate, mirroring, the Stop gate.
2. **Session identity.** A session id from an env var the harness exports
   (`CLAUDE_CODE_SESSION_ID`, `CODEX_THREAD_ID`, `GROK_SESSION_ID`, `PI_SESSION_ID`),
   or a `session_id` field on the hook payload (Codex, Kimi, Pi extensions) adopted as
   `TM_SESSION_ID`. Without one, claims and the Stop gate attribute to nothing.
3. **Native-task mirroring.** Does the harness ship a task/todo/plan tool? If yes, one
   adapter module maps its payloads to `MirrorIntent[]`. If no, the adapter says so and
   tasks flow through MCP `tm_*` instead — never invent a tool name.
4. **Work stream.** Where is the transcript, and can `transcript.mjs` parse it? A new
   `format` may read as raw lines until a parser lands — the panel says so rather than
   showing an empty box.

## Measuring a new harness

Read the installed CLI, not its marketing. The procedure that produced every row above:

1. `--help`, the shipped docs/ dir if there is one, and the binary/package source for
   hook mechanisms and env vars (`grep -o 'PI_[A-Z_]*' dist/**/*.js`-style). Note what
   exists AND what is only a placeholder (Kimi's `KIMI_SESSION_ID` is a skill-template
   variable, not exported — an invented name reads as support and never matches).
2. Run one real session. Capture hook payloads to disk verbatim, list the env inside a
   tool-spawned subprocess, and keep both as `tests/fixtures/<harness>-*.json`.
3. Histogram the tool calls in real transcripts (`~/.<tool>/…` session files). The
   native-task answer comes from what the tool actually called, not from a docs page.
4. Find where sessions are written and read the layout off the files on disk —
   directory sanitizers differ per harness (Claude strips dots, Pi keeps them).

## Adding a harness

1. Measure first (above); land the fixtures.
2. Add `lib/harness/<name>.mjs` with `toIntents(input)` and `wouldCreate(input)` — or
   the measured-empty module when there is no native task tool.
3. Register tools in `ADAPTERS` in `index.mjs` (skip when the tool set is empty).
4. Add the harness row in `sessions.mjs` (sessionEnv + transcript) and the CLI probe in
   `hostcaps.mjs`.
5. Ship the harness's own hook config under `hooks/<name>-hooks.example.*`.
6. Extend `hooks/hooks.json` matchers for Pre/Post if Claude-side wiring changes.
7. Unit-test wire → intents → apply without spawning the harness.

Do **not** put harness conditionals in `bin/tm` or `store.mjs`.
