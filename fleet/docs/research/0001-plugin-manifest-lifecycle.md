# Plugin manifest + monitor lifecycle research (BDM-6)

Research output answering the schema and lifecycle questions blocking BDM-3 / BDM-4 / BDM-5 / BDM-8.

Sources consulted:

- [code.claude.com/docs/en/plugins-reference](https://code.claude.com/docs/en/plugins-reference) — canonical manifest reference
- [code.claude.com/docs/en/hooks](https://code.claude.com/docs/en/hooks) — hook event names + entry shape
- [code.claude.com/docs/en/env-vars](https://code.claude.com/docs/en/env-vars) — env var availability
- [json.schemastore.org/api/json/catalog.json](https://json.schemastore.org/api/json/catalog.json) — schema-availability check
- [docs.claude.com/en/docs/claude-code/plugins](https://docs.claude.com/en/docs/claude-code/plugins) (now 301 → `code.claude.com/docs/en/plugins`)

## A. Schema URLs

Tested with `curl -fsSL` and cross-referenced against the SchemaStore catalog (`https://json.schemastore.org/api/json/catalog.json`):

| URL | Status |
|---|---|
| `https://json.schemastore.org/claude-code-plugin-manifest.json` | ✅ exists (title: "Claude Code Plugin Manifest") |
| `https://json.schemastore.org/claude-code-marketplace.json` | ✅ exists (title: "Claude Code Plugin Marketplace") |
| `https://json.schemastore.org/claude-code-hooks.json` | ❌ 404 — does not exist |
| `https://json.schemastore.org/claude-code-monitors.json` | ❌ 404 — does not exist |

Catalog listing confirms only four `claude-code-*` schemas are published: `keybindings`, `plugin-manifest`, `marketplace`, `settings`. Hooks and monitors have no published JSON Schema.

**Fix applied in this PR:**

- `fleet/hooks/hooks.json` — removed the broken `$schema` line.
- `fleet/monitors/monitors.json` — removed the broken `$schema` line.

The `$schema` fields on `.claude-plugin/plugin.json` and `.claude-plugin/marketplace.json` (which point at real schemas) are kept as-is.

## B. Manifest shape

### Hook event names — confirmed CamelCase

`PreToolUse`, `PostToolUse`, `SessionStart`, etc. The current `hooks.json` is correctly cased.

Canonical hook entry fields (from plugins-reference.md):

```json
{
  "type": "command",
  "command": "${CLAUDE_PLUGIN_ROOT}/...",
  "timeout": 10,
  "matcher": "Bash",
  "statusMessage": "...",
  "if": "Bash(rm *)",
  "async": false,
  "asyncRewake": false,
  "shell": "bash"
}
```

Our existing entries (matcher + type + command + timeout + optional statusMessage) match this shape.

### Monitor entry — official schema is narrower than what we shipped

Documented monitor fields (plugins-reference.md → "Monitors"):

| Field | Required | Values |
|---|---|---|
| `name` | yes | unique identifier (used to deduplicate within a session) |
| `command` | yes | shell command; supports `${CLAUDE_PLUGIN_ROOT}`, `${CLAUDE_PLUGIN_DATA}`, `${user_config.*}`, `${ENV_VAR}` |
| `description` | yes | short description |
| `when` | no | `"always"` (default — start at session start) or `"on-skill-invoke:<skill>"` |

**Our v0.1 `monitors.json` used `lifecycle` and `restart` — those are NOT in the official schema.** Likely silently ignored. Replaced with the canonical `"when": "always"` in this PR.

### `${CLAUDE_PLUGIN_ROOT}` interpolation — confirmed

Documented to interpolate inside hook `command` and monitor `command` strings. No alternative spelling expected. Our usage is correct.

## C. Environment variables

| Variable | Hook | Monitor | Bash tool / PATH-injected |
|---|---|---|---|
| `CLAUDE_PLUGIN_ROOT` | ✅ | ✅ | ✅ |
| `CLAUDE_PLUGIN_DATA` | ✅ | ✅ | ✅ |
| `CLAUDE_PROJECT_DIR` | ✅ | ⚠️ implied (not explicit) | ✅ |

`CLAUDE_PLUGIN_DATA` resolves to `~/.claude/plugins/data/<plugin-id>/` and persists across plugin updates (but not across uninstalls — intentional).

The monitor-context guarantee for `CLAUDE_PROJECT_DIR` is implied (plugins-reference.md:320: monitors support "the same variable substitutions as MCP and LSP server configs") but not explicitly demonstrated. Consider it best-effort and verify in the BDM-7/8 smoke test.

## D. Lifecycle questions (Q1–Q5)

**The five lifecycle questions are not answered in the official documentation.** This is itself an actionable finding:

| Q | Question | Doc answer |
|---|---|---|
| Q1 | Monitors per session (1 plugin enabled) | Not documented. Inference: 1 process per `name` per session — the docs explicitly say `name` "Prevents duplicate processes when the plugin reloads or a skill is invoked again", so within a session the dedup is by name. |
| Q2 | Two sessions same project → 1 shared monitor or 2 separate? | **Not documented.** Need empirical test in BDM-7/8. Design defensively (PID-lock) — works in both cases. |
| Q3 | Signal sent on session-exit | Not documented. Likely SIGTERM by Unix convention. Defensive: trap SIGTERM + SIGINT + SIGHUP. |
| Q4 | `lifecycle: "plugin-active"` semantics | Field doesn't exist in the documented schema. Use `when: "always"` instead — starts at session start; lifetime tied to the session. |
| Q5 | `restart: "always"` respawn behavior | Field doesn't exist in the documented schema. Don't depend on respawn semantics; design the daemon's own loop to handle hand-off. |

### Implications for BDM-4 design

The original BDM-4 design assumed:

1. **`restart: "always"` re-spawns daemons after exit 0** — false (field doesn't exist).
2. **`lifecycle: "plugin-active"` keeps the daemon alive across sessions** — false (field doesn't exist).
3. **Multiple sessions in same project might spawn multiple monitors** — undocumented; assume yes for safety.

Resulting design:

- Use `when: "always"` (canonical). Daemon's lifetime = session lifetime; no automatic respawn.
- Per-project PID lock at `${CLAUDE_PLUGIN_DATA}/projects/<KEY>/notify/pid` is still useful: if 2 sessions both spawn a monitor for the same project, one acquires the lock and runs; the other stands by polling. When the lock-holder's session dies and SIGTERM is delivered, the trap releases the lock and the stand-by takes over within ~5s.
- Daemon must handle stale PID files (PID no longer alive → reclaim) for crash recovery. There's no Claude Code respawn to pick up the slack.
- Daemon at `CLAUDE_SESSION_DEPTH >= 1` should still early-exit (fleet child sessions don't need their own daemon).

### Implications for BDM-3

`${CLAUDE_PLUGIN_DATA}` is confirmed available in hooks, monitors, and PATH-injected bin scripts. The state-dir migration can rely on it. PROJECT_KEY derivation (sha256[:12] of canonical git repo root) is unchanged — that's our concern, not Claude Code's.

### Implications for BDM-5

ADR-0002 should reference this research note as the basis for "why `${CLAUDE_PLUGIN_DATA}`" and "why per-project keying." The lifecycle uncertainty (Q2 in particular) is the load-bearing motivation for per-project state.

### Implications for BDM-7/8 smoke test

Three things must be verified empirically (no doc answer):

1. **Q2** — open two Claude Code sessions in the same project; count monitor processes (`ps aux | grep claude-sessions`). One? Two?
2. **Q3** — kill a session and observe what signal the monitor receives (strace / signal handler logging).
3. **Manifest correctness** — confirm `when: "always"` (the doc-canonical field) actually starts the monitor in a fresh `/plugin install`. If not, the design needs adjusting.
