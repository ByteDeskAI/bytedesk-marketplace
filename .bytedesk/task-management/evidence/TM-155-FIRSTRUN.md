# TM-155 — three first-run questions, answered before a pane stalls

**Merge:** head of `tm/TM-155-first-run`, off `main@435bb03`. Code commit `b21ef45`.

All three conditions were found by running the EP-018 demo four times. Each one cost a run, and each
one is knowable before anything launches.

## 1. The trust gate — `doctor` now says it (AC1)

Claude Code asks "Is this a project you created or one you trust?" the first time it opens a
directory, and the highlighted answer is `❯ No, exit`. The orchestration layer handles that
**correctly**: TM-111's guard means nothing is ever typed at an attention screen. So the failure is
silent by design — `lead ensure` reports "Provider is not accepting startup instructions; session
preserved" and the pane waits for a human who is not watching.

`doctor` now reports `CLAUDE_FOLDER_UNTRUSTED` with the one action that clears it, and states that
the question is asked **per repository, not per agent directory**. That last clause is the correction
to this task's own original framing: my first filing said the modal blocks every governed launch, and
the second demo — in a repository Claude *had* been trusted in — showed the agents' own
subdirectories inherit that trust and come straight up.

## 2. AC2 is answered by design, not by code — and deliberately

There is no supported way to bring a governed run up in a never-trusted repository without a human
pressing a key once, **and there should not be**. A plugin that could answer a trust dialog would
defeat the check that dialog exists to make.

So this criterion is met the way `failover.consent` meets its equivalent: the one required human
action is **stated as part of the design** rather than left as an accident of the provider's UI, and
`doctor` names it up front. One action, once per repository:

```
cd <repo> && claude      # choose "Yes, I trust this folder", then Ctrl-C
```

## 3. The socket-path limit (AC3)

`sun_path` is 104–108 bytes and tmux builds `$TMUX_TMPDIR/tmux-<uid>/<name>`, so a per-session
scratch directory exceeds it. What tmux says is:

```
error connecting to /tmp/claude-1000/-home-ryan-…/demo-tmux/tmux-1000/default (File name too long)
```

which reads like a filename problem and is not. `socketPathProblem` answers first, names the byte
count and the limit, quotes what tmux will say so the two connect, and says the remedy is a shorter
directory.

## 4. The prompt refusal names its key (AC4)

`composePrompt` has always returned `errors` carrying layer, path and note. Several refusals threw
them away and said only `Invalid lead prompt; refusing restart.` Both shapes that actually occur now
say which key:

```
Invalid lead prompt; refusing restart. Cause: template ./prompts/lead.md — ENOENT: no such file…
Invalid lead prompt; refusing restart. Cause: template — template "lead-default" has no prompt.
```

The first is the trap this task hit: a repo-config override that copied the DEFAULT value. That path
is relative to the layer that declares it, so in a repo config it points at `<repo>/prompts/lead.md`
— correct behaviour, previously unreadable. The second is a partial override, which fails because a
template is **replaced rather than merged**.

## The check first reproduced the mistake it exists to correct

Running `doctor` live on this worktree — rather than reading the code — reported
`CLAUDE_FOLDER_UNTRUSTED` for a directory under `bytedesk-marketplace`, **which is trusted**. The
first version asked about the exact path only. Trust is INHERITED by subdirectories, which is the
correction I had already made to this task's framing, committed a second time inside the fix for it.

It now walks ancestors and names which one answered:

```
trust: { known: true, trusted: true, matched: "/home/ryan/.../bytedesk-marketplace" }
problems: ["SUPERVISOR_NEVER_TICKED"]        # and no false trust warning
```

Two regression tests cover it: a nested directory inherits its repository's trust, and an ancestor
whose entry says `false` is still untrusted — inheritance answers with the nearest ancestor that has
an entry, whatever that entry says, rather than searching for a `true`.

## VERIFIED, and one honest weakness

Seven tests in `tests/unit/topology-first-run.test.mjs`, 7/7.

**Their control against `main` is weaker than the ones I have been handing you**, and it should not
be read as equivalent: the file fails to **import** there, because `socketPathProblem` and
`promptErrorDetail` are new exports — that is evidence the surface did not exist, not evidence the
behaviour was wrong. The behavioural claims are carried by the demo transcripts on this task and on
TM-151, where the failures were observed on live panes.

| Gate | Result |
|---|---|
| topology unit | **362 tests, 362 pass, 0 fail** |
| both frozen presence validators, unmodified | `ok — 7 snapshot(s) conform to Presence v1`; `all negative tests pass` |
| `roadmap:check` | `ROADMAP OK: 55 tasks, 96 unlocks, 6 goals` |
| `doctor` run live on this repository | reports `SUPERVISOR_NEVER_TICKED` only, with `trust.trusted: true` |

## READ ONLY, not executed

- The trust check against a provider other than Claude. `CLAUDE_FOLDER_UNTRUSTED` is raised only
  when a ready `claude` adapter is present, because it is the only CLI observed to ask; codex, grok
  and kimi were not tested for an equivalent first-run gate.
- `~/.claude.json` shapes other than `{ projects: { <abs path>: { hasTrustDialogAccepted } } }`. An
  unreadable or absent file reports `known: false` and raises nothing, which is the safe direction.
