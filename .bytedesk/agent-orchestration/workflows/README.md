# Showcase orchestrations

Nine scenarios that demonstrate what the plugin can do, as distinct from the feature-by-feature
test plan. Each has a different **team shape** and produces a different **kind of outcome** —
they are not nine ways of doing the same thing.

Run one with:

```
AO=agent-orchestration/bin/ao-topology
$AO launch --workflow showcase-<name> --consumer "$PWD" --input <k>=<v> --json
```

Add `--dry-run` first to see the exact argv, granted directories and warnings without starting
anything. `$AO inputs --workflow showcase-<name>` lists what each one wants.

## The claude override that used to live in `../providers/`

Gone, and worth recording why it existed. `failure_patterns` was declared only on
`GENERIC_ADAPTER`, no shipped adapter overrode it, and it contained the bare word `authentication`
— so Claude Code's ordinary startup line *"2 MCP servers need authentication"* had every claude
agent declared a failed candidate in five seconds. Measured, same spec, same repo:

| | outcome |
|---|---|
| shipped adapter, before TM-110 | `"ready": false` — `screen matched failure pattern /authentication/`, 5s |
| the repo-local override | `"ready": true`, no warnings, 5s |
| shipped adapter, after TM-110 | `"ready": true`, with that banner on screen |

TM-110 narrowed the shipped list to require failure context, so the override is deleted and these
scenarios exercise the adapter everyone else gets. If a scenario ever comes up `ready: false` on a
pattern that looks like ordinary output, that is the shape of bug to suspect.

## Two words that mean different things

`lead` is a **roster** role — one per repository, `coordinates_only` by default, the only address an
outsider may reach. A spec's conductor is role **`orchestrator`**, and a spec must have exactly one.
They are not the same concept and a spec asking for `role: "lead"` will not validate.

Likewise `coordinates_only` in a run removes an agent's **write tools** via the adapter's
`coordinator_args`, but every agent in a run otherwise inherits the consumer repo as its working
directory. If you want the conductor kept out of the codebase as well, narrow its `cwd` — which is
what `showcase-contained-lead` does, and why it has a deliberately empty desk.
