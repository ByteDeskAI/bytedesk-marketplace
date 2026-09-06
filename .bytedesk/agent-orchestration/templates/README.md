# Showcase orchestrations

Six scenarios that demonstrate what the plugin can do, as distinct from the feature-by-feature
test plan. Each has a different **team shape** and produces a different **kind of outcome** —
they are not six ways of doing the same thing.

Run one with:

```
AO=agent-orchestration/bin/ao-topology
$AO launch --template showcase-<name> --consumer "$PWD" --input <k>=<v> --json
```

Add `--dry-run` first to see the exact argv, granted directories and warnings without starting
anything. `$AO inputs --template showcase-<name>` lists what each one wants.

## The claude override in `../providers/claude.json`

Repo-local, and load-bearing. `failure_patterns` is declared only on `GENERIC_ADAPTER`, no shipped
adapter overrides it, and it contains the bare word `authentication` — so Claude Code's ordinary
startup line *"2 MCP servers need authentication"* had every claude agent declared a failed
candidate in five seconds. That is TM-110. This override narrows the patterns to require failure
context, and adapters resolve first-wins with consumer directories first, so it replaces the
shipped one outright.

Measured before and after, same spec, same repo:

| | outcome |
|---|---|
| shipped adapter | `"ready": false` — `screen matched failure pattern /authentication/`, 5s |
| this override | `"ready": true`, no warnings, 5s |

Detection is narrowed, not weakened: `authentication failed` and `usage limit` still match.
**Delete this file once TM-110 lands upstream.**

## Two words that mean different things

`lead` is a **roster** role — one per repository, `coordinates_only` by default, the only address an
outsider may reach. A spec's conductor is role **`orchestrator`**, and a spec must have exactly one.
They are not the same concept and a spec asking for `role: "lead"` will not validate.

Likewise `coordinates_only` in a run removes an agent's **write tools** via the adapter's
`coordinator_args`, but every agent in a run otherwise inherits the consumer repo as its working
directory. If you want the conductor kept out of the codebase as well, narrow its `cwd` — which is
what `showcase-contained-lead` does, and why it has a deliberately empty desk.
