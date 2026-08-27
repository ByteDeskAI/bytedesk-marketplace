# The Claude ↔ Codex collaboration

This is the spine of the whole suite, not a detail of one stage. Read it before writing
or changing any member.

Claude has judgement, the filesystem, and the design authority. Codex has hands and takes
whatever direction it is given. Neither is much good alone: a model that can render but
cannot judge produces confident wrong work, and a model that can judge but not render
produces descriptions of work.

## The loop

Every producing stage runs the same shape:

1. **Brief.** Claude writes the reasoning down first — what this is for, where it will be
   seen, what must and must not be in it. The brief and the prompt are different
   documents. The brief is why; the prompt is the instruction handed over.
2. **Produce.** One Codex invocation, one artifact.
3. **Look.** Claude opens what came back. Not the log, not the reply text — the artifact
   itself, so it enters context and can actually be judged.
4. **Critique against the brief.** Say what is wrong plainly. "This one is fine" when it
   isn't wastes a round and costs the operator's trust in your eye.
5. **Revise, one axis per round.** Hold everything that worked verbatim and move one
   thing. Three rounds is a ceiling, not a quota.

Two rules travel with it everywhere:

**Round 1 diverges; rounds 2 and 3 converge.** Two or three genuinely different attempts,
not three variations on one idea. People rarely know what they want until they see the
wrong thing beside the right one.

**Look before promoting.** No stage may promote an artifact it has not inspected. This is
not a style preference — it is the failure this suite was built after. Fifteen images were
generated, three were looked at, twelve were promoted into a governed repository, and one
of them violated a rule the generating skill itself declared. The discipline evaporated
exactly when the work scaled, and nothing objected. So the contract says it out loud: an
unviewed artifact is not a finished artifact.

## Codex plays two roles. Keep them apart.

### Codex as hands

It produces. It does not touch the filesystem, does not run shell commands, and decides
nothing. Prompts open by saying so, because left to itself it will try to be helpful —
reading a template, copying a result to where you asked — and under a read-only sandbox
those attempts fail, cost a minute, and sometimes derail it into troubleshooting instead
of producing.

Claude collects, names, and files everything. Codex is never asked where something should
go.

### Codex as blind critic

For review, Codex is handed the artifact **without the brief** and asked a fixed question.

This exists because of a specific, structural blind spot: the author of a brief cannot
reliably judge whether the result matches it. Having written "markers on tracks", the
author reads markers on tracks; a reader who never saw those words sees a progress bar.
That is not carelessness — it is what writing the brief does to you, and no amount of
care removes it.

So the blind critic gets the artifact and a checklist, never the intent. Its answers are
evidence, not verdicts: Claude reconciles the blind read against the brief and decides.
A blind critic that disagrees with the brief is usually right about what is *there* and
wrong about whether it matters.

## Preflight, and failing closed

Check once per session, before any stage does work:

```bash
command -v codex && codex --version
```

**There is no fallback.** If Codex is missing or unauthenticated, stop. Say why, say how
to fix it, and do not quietly continue with Claude alone.

That is provenance, not caution. Every artifact in a run folder carries a header claiming
how it was made. A stage that silently substitutes a different process produces something
plausible that encodes a collaboration which never happened — the same class of problem as
promoting an image nobody looked at, and harder to detect later because the artifact looks
finished.

There are **three** states, not two, and they need different responses. The third was
found by running the arc with the CLI deliberately removed — six stages stopped, and the
orchestrator, which had the most latitude, found the case the rule had not named:

- **Not installed.** Name the install step and say where the suite looked. Stop.
- **Installed but unauthenticated.** Name the sign-in step, and do not describe it as
  missing — sending someone to reinstall a tool they already have wastes their afternoon.
  Stop.
- **Installed, working, signed in, but unreachable** — a clobbered shim, a half-finished
  upgrade, a `PATH` that lost an entry. This is a tooling fault, not an absence, and
  **repairing it is not substitution**: the collaboration still happens and the provenance
  is still true.

The third state is allowed, under one condition. **Repair is permitted; concealed repair
is not.** Silent self-repair is one step from silent substitution, and the difference has
to be visible in the artifact rather than resting on trust. So:

- Say what was broken and what you pointed at, in the user-facing message, not only in a
  comment.
- Keep the repair scoped to the run — a shim on the run's own `PATH`, never a global
  install. Mutating someone's toolchain is a bigger decision than the one you were asked
  to make.
- Record in `state.json` the version of the binary **actually invoked**, which is not
  necessarily the version the package manifest claims. A half-finished upgrade is exactly
  the case where those two disagree, and the invoked one is the one that made the artifact.

If you cannot repair it without a global change, you are back in state one: stop and say
what you would have run.

Fail at preflight rather than mid-arc, so there is no half-built run folder to clean up.
Where a run cannot proceed, offering the part that is still useful is good — write the
brief, write the art direction, so the operator can run it themselves. Never write it into
the run folder as though the stage completed.

## What this costs

Roughly two to four minutes per artifact. A stage producing three divergent round-1
attempts is a ten-minute stage. Say so before starting a large fan-out rather than
letting an operator discover it, and prefer fewer, better-briefed attempts to many
under-briefed ones.
