---
name: bytedesk-designer
description: "Run design work end to end: product idea to design brief to identity to art direction to real HTML screens to a published storybook, with an independent review before anything ships. Use this whenever someone wants to design a product, see what their idea would look like, get mockups made, refresh a look, or design several products or screens at once - and whenever design work needs more than one stage but nobody has said which. Works from nothing at all, bootstrapping a design system first if none exists, or picks up from a run already partly done. Fans out one focused worker per surface so attention does not dilute across a batch, and keeps set-level judgement in one place. Requires the Codex CLI installed and signed in."
license: Apache-2.0
metadata:
  suite: bytedesk-designer
  stage: orchestrator
  produces: a complete run folder
  requires: codex-cli
---

# Designer

The front door. It decides which stages a piece of work actually needs, runs them in an
order that makes sense, and owns the two things no individual stage can own: the run folder,
and judgement about the set as a whole.

Everything it coordinates is documented elsewhere. Read `${CLAUDE_PLUGIN_ROOT}/references/run-folder-contract.md`
and `${CLAUDE_PLUGIN_ROOT}/references/claude-codex-collaboration.md` before doing anything;
they are the substrate and the spine.

## Preflight, once

```bash
command -v codex && codex --version
echo "Reply with exactly: OK" | timeout 60 codex exec --skip-git-repo-check -s read-only -
```

**The second line is the one that matters.** `--version` does not start a session, so it
does not load the MCP servers declared in `~/.codex/config.toml` — it returns cleanly on a
machine where every real invocation hangs. A preflight built on it passes, and the arc then
fails several minutes in, which is precisely what failing at preflight is supposed to
prevent. Measured on a real machine: `--version` exit 0, `codex exec` timed out at 120s.

Use `${CLAUDE_PLUGIN_ROOT}/scripts/codex-exec.sh` for every invocation rather than calling
`codex exec` directly. It carries the bounded retry described below.

**Preflight the authority in the same breath**, unless this stage genuinely has no authority
to read:

```bash
${CLAUDE_PLUGIN_ROOT}/scripts/authority-doctor.sh
```

`CONNECTED` and you may proceed, recording the sha it reports. `NOT-CONFORMING` or `none`
and you stop, exactly as for a missing Codex — a stage that guesses at values produces work
that looks finished and is wrong.

This was a real gap, not a hypothetical one: authority resolution used to happen inside each
stage rather than at the gate, and across one sweep five runs silently adopted a repository
that two others correctly refused. Same machine, same repository. The only variable was the
working directory.

Do this **before creating the run folder**, not after. Failing mid-arc leaves a half-built
folder somebody has to clean up and a `state.json` that lies about where the work got to.

Missing or signed out: stop, say which, give the matching fix. If it is installed and
working but simply unreachable — a clobbered shim, a half-finished upgrade — repair it for
this run only, say plainly what was broken and what you pointed at, and never reach for a
global install to fix it. Three states, not two: `${CLAUDE_PLUGIN_ROOT}/references/claude-codex-collaboration.md`.

Record the version in `state.json` when it passes — the version the binary you invoked
reports, not the one the package manifest claims. Those disagree exactly when something is
half-upgraded, which is the case this record exists for.

## Resolve the authority, once

Per `${CLAUDE_PLUGIN_ROOT}/references/authority-contract.md`. Record the path and commit sha in `state.json`, and
say which path was resolved and how — an operator whose run silently used the wrong repo
finds out when the colours are wrong.

**No authority found?** That is a legitimate starting point, not an error. Say so and run
`bytedesk-designer-authority` first. It is the one stage that can run before everything
else because it is what everything else reads.

## Decide the arc

The full arc is discovery → identity → direction → surface → publish → review. Most work
needs a subset, and running stages nobody asked for is the fastest way to make this
unusable.

Read what the operator said and what already exists in the run folder:

| They said | Run |
|---|---|
| "design my product" / "what would this look like" | the full arc |
| "make me a logo" | identity, and stop |
| "mock up the settings screen" | surface, if a brief and authority exist |
| "some visual direction for X" | direction |
| "package this up" | publish |
| "is this ready?" | review |
| "we need a design system" | authority |

**Say which stages you're running and why, before starting.** The full arc is on the order
of half an hour of model time; an operator who wanted one screen and got an arc has lost
that time to a decision you made silently.

Stages whose inputs are already satisfied are skipped, not re-run. An existing `brief.md`
is an input, not an invitation.

## Fan out per surface — one worker, one thing

When there is more than one surface or product, dispatch **one worker per surface**, each
running a single stage focused on one thing.

This is the suite's central operational finding, and it is worth stating plainly because
the obvious alternative feels more efficient: **a single context handling fifteen artifacts
does not fail loudly, it fails by degrading.** Fifteen images were once generated in one
pass; three were inspected; twelve were promoted unviewed, and one violated a rule the
generating skill itself declared. Nothing objected. The discipline evaporated exactly when
the work scaled, and no individual step looked wrong at the time.

One worker holding one surface will look at what it made. Fifteen surfaces in one context
will not, however carefully that context was instructed.

So the split is:

**Fanned out** — anything per-artifact: generating a direction piece, building a surface,
critiquing a single image, drawing a mark. Give each worker its stage, its one artifact, its
slice of the brief, and the authority path. Tell it what it owns and what it must not touch.

**Never fanned out** — anything about the set: the contact sheet, cross-surface
consistency, which direction wins, whether the family holds together, and every promotion
decision. These need everything in one context by definition, and splitting them produces
locally reasonable choices that don't cohere.

### Retrying a fan-out

Spawning fails in two different ways and they want opposite responses, so decide which one
you have before retrying anything.

**It refused to start.** An explicit error — `no space for new pane` is the one seen here.
Naming a worker allocates it a terminal pane; when that budget is gone, *named* spawns fail
while unnamed ones are fine. Retry unnamed, in batches of three rather than all at once. A
run that did exactly this got six failures, then launched all six on the retry with no work
lost, because nothing had started.

**It started and returned nothing.** No error, no artifact, no answer to a status ping.
Here a retry is the wrong instinct: you do not know whether the first worker is dead or
merely slow, and a second worker on the same subtree will collide with it. Wait once, check
the disk, and if it is still empty run that stage yourself.

Either way the loop is **bounded at two attempts and then you do the work**. An orchestrator
that keeps re-dispatching is an orchestrator that never finishes, and the operator cannot
tell it apart from one that is making progress.

Three rules that hold for both:

- **Check the disk, not the reply.** A nested spawn is asynchronous; its result arrives
  later and a stage that ends its turn never sees it. The artifact on disk is the only
  honest signal.
- **Never retry into a subtree that already has output.** Half-written work plus a second
  worker is worse than either alone.
- **Say which attempt produced what.** Same rule as everywhere: a fallback is fine, a
  silent one is not, and a later review's independence depends on knowing.

Before a large fan-out, prefer fewer workers over more. The fan-out is itself the thing most
likely to exhaust the budget it needs, so six products at once is the shape that fails; six
products in two waves of three is the shape that does not.

### Verify the fan-out actually happened

**After dispatching workers, check each one produced its artifact before treating the
stage as done.** Not "did the worker return" — did the file appear, and is it what was
asked for.

This is not defensive padding, and the cause turned out to be specific enough to work
around rather than fear. **Giving a worker a name allocates it a terminal pane.** When that
budget is exhausted — by long-lived sessions from other tools, not necessarily anything you
started — every *named* spawn fails with `no space for new pane` while unnamed spawns work
fine. A probe confirmed the plain case succeeds in six seconds.

So if a fan-out fails to launch: **retry without names, in smaller batches.** A run that hit
this dispatched six named workers, got six failures, retried unnamed in two batches of
three, and launched all six with no work lost — the run folder was already built and no
worker had started.

Two practical consequences:

**A nested spawn is asynchronous.** It returns an identifier immediately and the result
arrives later. A stage that dispatches workers and then finishes its own turn never sees
them complete — from inside, that is indistinguishable from workers that did nothing. Wait
for them, and check the disk rather than the reply.

**A worker that produced nothing looks exactly like a stage with nothing to do.** An empty
directory reads as "no work needed" and the arc walks past a hole. That is the whole reason
this check exists.

When a worker comes back empty, run its stage yourself, one artifact at a time, holding
the same look-before-promoting discipline. Then say so. Falling back is fine; falling back
silently is not, because the reason for fanning out in the first place was to keep one
context from judging many artifacts — and once you are doing that, a later review's
independence is gone and the operator should know it.

**Read the stage's SKILL.md before standing in for it.** This is the part that gets skipped,
and skipping it is measurable. Across the evaluation runs, surfaces built by the surface
stage carried a generic-interface tell in **0 of 12** cases; surfaces the orchestrator built
inline, after a fan-out failed, carried it in **8 of 12**. Same model, same authority, same
brief. The whole difference was whether anything had read the stage's rules.

A fallback is not "do the work myself instead". It is "become that stage": load its
SKILL.md, follow its checks, produce its artifacts to its contract. An orchestrator that
skips that is not running a degraded arc, it is running a different and worse one — and
because the artifacts still land in the right folders with the right names, nothing looks
wrong.

## Own the run folder

Workers produce artifacts. The orchestrator names them, files them, and writes
`state.json`. A worker that files its own output invents its own convention within two
surfaces.

After each stage, update `state.json`: what completed, what it produced, what it viewed.
**Never mark a stage complete whose `viewed` list is missing an artifact it promoted.** That
check is the orchestrator's job because it is the only place that can see it, and it is the
one the review stage will treat as blocking.

## Review before publish, always

Even when nobody asked. Review is cheap relative to what it catches, and its findings are
about the set — exactly what a fan-out cannot see.

If review returns blocking findings, **stop and report** rather than fixing them silently.
The operator may disagree that a finding is blocking, and a run that quietly re-rolled three
images has thrown away information about what the brief got wrong.

## Say what it costs, before spending it

Each Codex invocation is roughly two to four minutes. A round-1 direction stage with three
divergent attempts across four surfaces is twelve invocations — well over half an hour.

State the shape before starting: how many stages, how many artifacts, roughly how long. An
operator who knows a run is thirty minutes goes and does something else. One who doesn't
watches it and interrupts halfway, which wastes all of it.

**And say it again at the end, in wall-clock time.** This rule failed three times across two
evaluation rounds, and the reason is structural rather than careless: in a single-turn run
there is no "before" — the operator gets one message, after the work. A cost stated only in
a plan they never saw is a cost never stated.

So the final report carries it too, in minutes, not in stage counts or invocation counts. A
run that says "twelve Codex invocations" has told the operator something they cannot convert
without knowing what an invocation costs. Say the minutes.

## Resuming

A run folder is resumable by design. Read `state.json`, report where it got to, and continue
from the first incomplete stage. Do not restart completed stages, and do not assume a stage
marked complete actually is — cross-check its artifacts exist on disk. A stage whose files
have been deleted is incomplete regardless of what the JSON says.

## What this stage must never do

- **Never fan out a set-level judgement.** Promotion, consistency, and the contact sheet
  stay in one context.
- **Never run stages nobody asked for without saying so first.**
- **Never let a worker write to another worker's subtree.**
- **Never mark complete a stage that promoted an artifact it did not view.**
- **Never start an arc before preflight passes.** No half-built run folders.

## Reference files

Shared contracts: `${CLAUDE_PLUGIN_ROOT}/references/run-folder-contract.md` (the substrate — read first),
`${CLAUDE_PLUGIN_ROOT}/references/claude-codex-collaboration.md` (the loop every stage runs),
`${CLAUDE_PLUGIN_ROOT}/references/authority-contract.md` (resolution order), `${CLAUDE_PLUGIN_ROOT}/references/codex-handoff.md` (mechanics).
