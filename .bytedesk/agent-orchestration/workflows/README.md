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

## Outcomes

Filled in after a run, not before.

### `astra-image-pipeline` — run 2026-09-06, `20260906-213535-puat`

**Brief:** a logo for TideBell, a marine salvage and wreck-survey firm in Cork (company drawn at
random). **Result:** two rounds, one revision, `tidebell-r2.png` final at 841,049 bytes.
Conductor `claude:opus`, illustrator `codex:gpt-6-astra`, critic `claude:opus`. No failovers.

What the scenario was meant to show, and did:

- **The image comes from the agent that reasoned about the brief.** Astra committed to a direction
  in prose before drawing, caught its own first render for having shading (breaking the flat-vector
  constraint) and re-prompted itself before showing anyone.
- **A critic on a different family judged the picture, not the prompt.** It downsampled to
  64/32/16px and sampled the fill at six points rather than taking the illustrator's word: flat
  navy confirmed at `srgb(4,40,84) ±1`, a lip gap measured at 1.1px-at-64px that closed below 48px,
  and a right-shoulder wedge that orphaned into a 1.2px fleck. Its tone score of 2/5 — "the standard
  notification-bell icon construction" — was the finding that drove the revision.
- **The conductor never described the image.** Its report says so explicitly: *"I have not looked at
  either image."* That is the separation the spec asks for and it held.

Three things it turned up that the harness could not:

1. **The mailbox doorbell silently fails to submit (TM-121).** Three times in one run, on Claude and
   Codex alike, the pointer was typed into the pane and left unsent. Nothing errored; the agent just
   looked idle. Measured to `sendText` batching the text and its Enter into one tmux invocation, so
   the pane read `"…the message\r"` as a single chunk — a paste, not a keystroke. Fixed.
2. **The illustrator's instructions under-specified its own tooling.** It reported *"I cannot produce
   native SVG output with the image-generation tool"* and stopped. True of `image_gen`, which is
   raster by design — but it has a shell and write access and could have authored the SVG. The spec
   now says so, and says PNG is the default.
3. **A 30s readiness window is not enough for a Codex with unauthenticated MCP servers.** Five failed
   MCP handshakes pushed the prompt past the window; the agent was healthy and the run continued, but
   it launched as `ready: false`.

Open on the deliverable itself: there is no vector file, and the critic's point stands that the mark
is about the name rather than about salvage or survey — a brief question, not a revision.
