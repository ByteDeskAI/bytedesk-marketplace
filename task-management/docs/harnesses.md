# Harnesses: the universal recipe

The store, CLI, MCP server and dashboard are harness-agnostic. A harness integration is
four independent surfaces, each of which either exists or is honestly absent — this file
is the map. Per-harness install detail lives in `docs/install.md`; the engineering
contract lives in `lib/harness/README.md`. This is the recipe that connects them.

| Surface | Claude | Codex | Grok | Kimi | Pi |
|---|---|---|---|---|---|
| Hooks | plugin `hooks.json` | `.codex/hooks.json` | — none | `[[hooks]]` in config.toml | extension (`hooks/pi-hooks.example.ts`) |
| Session identity | env `CLAUDE_CODE_SESSION_ID` | payload `session_id` | env `GROK_SESSION_ID` | payload `session_id` | env `PI_SESSION_ID` (bash-tool subprocesses) / payload from extensions |
| Native task tool mirrored | `TaskCreate`/`TaskUpdate` | `update_plan` | `todo_write` | `TodoList` | — none shipped (0.82.0, measured) |
| Work stream (transcript) | ✓ | ✓ | ✓ | raw fallback | raw fallback |
| MCP `tm_*` | ✓ | ✓ | ✓ | ✓ | ✓ via pi-mcp-adapter |

## Installing against any harness

Three moves, whatever the harness:

1. **Bootstrap the store** — `node <plugin>/bin/tm init` writes the committed launchers
   under `.bytedesk/task-management/bin/`. Hook configs everywhere call those launchers,
   so no PATH entry or absolute path is needed.
2. **Wire the hooks in the harness's own format**, from the matching
   `hooks/<name>-hooks.example.*`. Where the format lives differs: committed repo file
   (Codex), user-level config (Kimi's `~/.kimi-code/config.toml`), auto-discovered
   extension directory (Pi's `~/.pi/agent/extensions/` or `.pi/extensions/`).
3. **Register the MCP server** in the harness's own MCP config. The entry is always
   Claude-shaped `mcpServers` naming `<plugin>/bin/tm-mcp` — for Pi that is
   `~/.pi/agent/mcp.json`, read by the `pi-mcp-adapter` extension (MCP is not in pi's
   core; `pi list` shows the adapter).

Whichever surface a harness lacks, the board still works: drive it with the CLI or the
MCP tools. Claims hold whenever the session identity surface exists, because they read
the env var or the payload, not a hook.

## Porting to a new harness

Measure the installed CLI first — never port from a docs page. The procedure (it is the
one every existing row went through, and what `lib/harness/README.md` pins):

1. **Hooks?** `--help`, the shipped docs/, and the package source. Shell-command hooks,
   in-process extensions, or nothing. (Grok: nothing. Pi: extensions with
   `tool_call`/`tool_result`/`session_*` events that can block tool calls but not a
   session end.)
2. **Session id?** Grep the binary for `<NAME>_[A-Z_]*` candidates, then run one real
   session and list the environment inside a tool-spawned subprocess — a placeholder in
   the binary is not an exported variable (Kimi lesson). No env var usually means the id
   rides the hook payload, which `bin/tm` adopts as `TM_SESSION_ID`.
3. **Native task tool?** Histogram the tool calls in real session files under the
   harness's state dir. Shipped beats example: pi's repo carries a todo extension as
   sample code, which is not a tool the binary registers.
4. **Transcript?** Find where sessions land and read the layout off files on disk.
   Directory sanitizers differ per harness (Claude strips dots, Pi keeps them, Grok
   percent-encodes, Kimi keys by an opaque workspace id).

Then land the answers, in this order:

- `tests/fixtures/<name>-*.json` — verbatim captured payloads/transcripts.
- `lib/harness/<name>.mjs` — the adapter, or the measured-empty module when step 3 found
  no task tool (`pi.mjs` is the template for that).
- `lib/harness/index.mjs` — register the tool names in `ADAPTERS` (skip when empty).
- `lib/harness/sessions.mjs` — the harness row: `sessionEnv`, `format`, `transcript()`.
- `lib/hostcaps.mjs` — add the CLI to the probe so `tm caps` reports it.
- `hooks/<name>-hooks.example.*` — the harness's own hook format, calling the launchers.
- `tests/unit/<name>.test.mjs` — fixture-driven; never spawns the harness.

The full matrix above is the acceptance bar: every cell either wired and tested, or
marked absent with the measurement that proves it.
