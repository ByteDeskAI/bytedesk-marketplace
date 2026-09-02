# Native-task Bridge (multi-harness)

## Patterns

| GoF | Role here |
|-----|-----------|
| **Bridge** | Domain store ops (`apply.mjs`) stay stable while wire implementors vary. |
| **Adapter** | `claude.mjs` / `grok.mjs` / `codex.mjs` convert foreign tool payloads into `MirrorIntent[]` only. |
| **Strategy** | `ADAPTERS` map in `index.mjs` selects the adapter by `tool_name`. |

| Harness | Native tools mirrored |
|---------|------------------------|
| Claude Code | `TaskCreate`, `TaskUpdate` |
| Grok | `todo_write` |
| Codex CLI | `update_plan` |
| Kimi Code | `TodoList` |

## Adding a harness

1. Add `lib/harness/<name>.mjs` with `toIntents(input)` and `wouldCreate(input)`.
2. Register tools in `ADAPTERS` in `index.mjs`.
3. Extend `hooks/hooks.json` matchers for Pre/Post if needed.
4. Unit-test wire → intents → apply without spawning the harness.

Do **not** put harness conditionals in `bin/tm` or `store.mjs`.
