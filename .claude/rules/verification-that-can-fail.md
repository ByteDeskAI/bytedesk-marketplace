# A check that cannot report finding nothing is not a check

Three patterns cost this repository most of a working day during EP-018. Each was found more than
once, by more than one agent, after the previous instance had already been written down as an
incident. They are here because "be more careful" did not work — each one needs a specific question
asked at a specific moment.

## 1. A clean result in a messy domain is a claim, not an answer

Every one of these produced a *perfectly clean* output that meant nothing:

| what was run | what it said | why it was empty |
|---|---|---|
| `git diff $(git merge-base main <branch>) <branch>` over eight merged branches | 8 of 8 clean | for a MERGED branch the merge base **is** the tip; every diff compared a commit to itself |
| a `[[ =~ ]]` census with `BASH_REMATCH`, under zsh | 18 of 18 orphaned | zsh does not populate `BASH_REMATCH`; every sibling name came out empty |
| a file list passed unquoted to `git diff`, under zsh | 10 of 10 merges clean | zsh does not word-split; the list became one pathspec matching nothing |
| `grep -c` for a pattern in the wrong of two panes | 4 acks confirmed | the count matched the *question* text, not any answer |

**Ask before believing a clean result: "if the thing I am looking for were absent, would this output
look different?"** If it would look identical, the check has not run.

**Make the check report its own coverage.** A branch audit that prints *how many of the branch's own
commits it found* turns a silent zero into `NO OWN COMMITS FOUND`. A fixture test that asserts
`names.length >= 2` before looping cannot pass over an empty directory.

## 2. Isolation is never free — ask what it removes

Every isolation mechanism deletes something. The question is whether the check depends on it.

- **`git archive` removes `.git`.** A test that resolves a version by asking git then fails *by
  construction* at every revision. Two archive trees "failing identically" is not a control; it is
  the same confounder twice.
- **A symlinked `node_modules` removes path identity.** esbuild writes each module's resolved path
  into the bundle, so `build:check` passed in the canonical checkout and failed in every worktree —
  and the control that shared the symlink introduced the very difference it was meant to exclude.
- **A detached copy removes whatever the host provides.** `test-pool.sh` passed in an archive tree
  because the real `ao-topology` was absent there, and failed in every real checkout because it was
  present. The suite was reporting the machine.

**Name what your isolation removed, in the evidence, before reporting the result.**

## 3. A fix applied to one of two callers is not a fix

Three instances in one epic:

- `epic new` grew a stray-flag guard after `EP-017` was created with `--body` baked into its name.
  `edit` never got it, so `tm edit <id> --title "X"` wrote the literal string `--title` into the
  title — and reported success, because it prints the OLD title.
- TM-151's styled composer check reached the safe-to-ring path and not the landing verdict, so a
  message that was genuinely delivered reported `stuck-in-composer`.
- TM-154 read the commit message and then took the UNION with the command string, leaving the looser
  source in charge; a heredoc body attached one commit to nine tasks.

**A guard present in one verb and absent in its sibling is worse than no guard**: the tool behaves
inconsistently, and the inconsistent half looks like it worked. When you fix a predicate, grep every
caller of the thing you fixed and make them share one implementation.

## 4. A capability described in a comment is not a capability that is reachable

- The reviewer was judged on a nonce handshake it was never instructed to perform, by a probe that
  deleted itself before the reviewer's next turn.
- `TM_DISPATCH_REGISTRY`, whose own doc comment says it exists "so dispatch can be exercised end to
  end without spawning a worker", could not be consulted at all: selection walked a fixed order the
  registry was never added to.
- Two doc comments claimed the readiness probe "rings the pane with a pointer naming the ack
  command". Neither implementation rang anything.

**Prose in a comment is a claim about intent. Run the path.**

## 5. The refusal is usually the most informative output, and nobody reads it

`tm task new` refused with "no active epic" and the id it never returned was used anyway, mutating a
completed task on another epic. `tm evidence` printed an `ENOENT` naming `TM-143-TM-143-…` — the
double-prefix bug announcing itself — and it was read as noise. `ao-topology` printed
`{ok:false, code, message}` on **stdout** with an empty stderr, and three dispatch backends built
their failure reason from stderr alone, so the board recorded `ao-topology launch exited 1:` — an
exit code, a colon, and nothing.

**Read the failure text before deciding what the failure was.** A verb that refused is not a verb
that succeeded, and the id it did not return is not yours to use.

## 6. A default a caller hardcodes past is not a default

The sibling of rule 4, and the one this file was first used to FIND rather than to record. Fixing a
library is worthless while every caller supplies its own value.

The late-ack fix let a probe outlive its wait so a lead that was mid-turn could answer at its next
boundary. It was correct, it had unit tests, and on a live pane it changed nothing — three
consecutive `unresponsive` reads. Both of its real callers passed a timeout past the default it had
just raised:

| caller | what it passed | consequence |
|---|---|---|
| `cli.mjs` | `Number(flags['ack-timeout'] \|\| 5000)` on every call | the env-configurable 30s default was never consulted; a probe expired five seconds after it was written, so the ack a lead ran at its next turn boundary was refused as STALE rather than accepted as LATE |
| `startup.mjs` | a hardcoded `1000` | a one-second probe nobody can answer: it burns a ring, its own sweep deletes it, and its expiry defeats the late-ack path from a caller that never intended to wait |

The second one is why "raise the number" was the wrong fix. That path is a SessionStart screen for
every session on the machine and genuinely cannot wait for a model turn — so it now passes `0`,
meaning **answer from proof already on disk and mint nothing**. A screen asks; it does not
interrogate. "Not proven" is an honest answer for it to give, and it is checked after the cached and
late paths, so a screen still reports proof that already exists.

**When a fix changes a default, grep every call site before believing it shipped.** The unit suite
passed in both states, because it exercised the library directly and never went through either
caller's argument construction — which is rule 1 wearing different clothes: testing the piece you
wrote instead of the behaviour the criterion names.

## 7. When two explanations predict the same bit, stop asserting on the bit

The first rule used to break a tie between two of my own theories, both wrong, in the same hour.

A test put a fake `tmux` on `PATH` that wrote a marker file, and asserted the marker never appeared.
It failed. Theory A: the delivery state machine now legitimately reads the pane, so the invariant is
stale. Theory B: a delivery change made `send` reach tmux by mistake. **Both theories predict the
same failing assertion**, so the assertion could not distinguish them — and a fix was already
written for theory A: permit reads, forbid only `send-keys`, with a confident comment explaining why
the old invariant predated the feature. It passed 3 of 3. It would have merged green and deleted the
guard that was working.

What broke the tie was replacing the boolean with a value — record *which* subcommands ran:

| instrument | possible answers | could it distinguish A from B? |
|---|---|---|
| `assert.rejects(readFile(marker), {code:'ENOENT'})` | called / not called | no — both theories say "called" |
| shim appends `$1`, test prints the list | any set of subcommands, including none | yes |

It returned **`nothing`**, which was in neither theory. The failure did not exist in the tree being
explained; see rule 8. Note that the losing instrument was not weak — it is the right assertion for
the suite. It was simply the wrong instrument for *choosing between two stories*, because its output
was already determined by both.

**Before writing the explanation, ask what result would tell you the explanation is wrong.** If a
pass/fail bit is the same under every theory you are entertaining, go get the underlying value:
which command, which argument, which count, which path. A theory that no available measurement can
refute is not yet a finding — and being able to write it up convincingly is not evidence, because
the writing gets easier as the theory gets further from the facts.

## 8. The tree you measured is part of the result

A shared checkout is mutable state owned by nobody. Work in flight there belongs to the session
editing it, and it is invisible to a test run that does not look:

| what was believed | what was true |
|---|---|
| "this test is deterministically red on `main`, 3/3 in isolation" | the checkout held 48 uncommitted files of another session's feature; the test is 10/10 green on that same commit in a clean worktree, and 5/5 red with those files copied in |
| a 5-run flakiness distribution (1, 4, 2, 3, 1 failures) | measured in the same contaminated tree; void |

"In isolation" had meant *one test file instead of the suite*. It had not meant *this commit instead
of somebody's unfinished feature* — and that is the isolation the conclusion depended on. Rule 2
again: name what your isolation actually removed, because the word covers several different things
and the useful one is easy to skip.

So flakiness has a fourth cause, alongside load, ordering and timing assumptions: **tree
contamination** — a failure that is another agent's half-finished work. It is the one that most
looks like a defect in your own code, because it is a real failure, reproducible while it lasts, in
a file you did not change.

**Record the commit AND the dirty state beside every measurement, and refuse to call a dirty tree a
measurement of a commit.** `npm run test:stability` in `agent-orchestration` does both: it prints the
uncommitted paths before the numbers, and it separates *consistently failing* from *passed some runs
and failed others*, exiting non-zero for instability specifically — so a caller that checks only
"did it pass" cannot read one lucky green run as health.

## 9. A count is not a direction, and four checks proved it in one day

The other rules are about checks that cannot fail. This one is about checks that *can* fail
and are blind along the axis you care about — harder to spot, because they do sometimes go red.

Four in a single day, each clean while unable to answer the question actually being asked:

| the check | what it answered | what was asked |
|---|---|---|
| `git diff --numstat`, flag a file removing more than it adds | is content being lost? | is my merged fix being reverted? |
| `validator … \| tail -3; echo $?` | did `tail` succeed? | did the validator refuse? |
| `grep -c '\\uXXXX'` through two layers of shell quoting | does this literal appear? | did the file get re-escaped? |
| a board sweep matching `TM-<id>` against a commit message | does the message name this task? | does this ref belong to this task? |

The first is the sharpest. A guard written *that morning* to catch a staged revert passed a
staged revert, because the revert was a representation swap — the escape `\u276f` for the glyph `❯` — at **+8/−8**.
Counting says balanced; the file was a complete undo of the fix it had just merged. The
guard's author caught it anyway, by reading a line and recognising which way the glyph went.

The shape: **an aggregate cannot see a direction.** Line counts, violation totals, pass/fail
tallies and exit codes all compress the thing you need to look at into a number that is equal
on both sides of the case you fear. A same-size swap, a message that names the right task for
the wrong reason, a refusal that exits 0 through a pipe — each is invisible to the aggregate
and obvious in the raw line.

**Read one line you recognise, in the direction that matters, before trusting a count.** Not
a better predicate — the fix for all four was the same and it was not cleverness: print the
thing and look at it. The one that nearly shipped was found by printing which tmux
subcommands ran; the escaping was found by printing the pattern; the staged revert was found
by reading the diff instead of its numstat.

A corollary worth its own sentence, because it cost most of a day here: **a check written to
catch a specific failure is not exempt from that failure.** The counting guard, the isolation
rule, and this file have each been violated by the person who had just written them.

## What to do with a green run

State what you **verified** and what you only **read**. They are different words. A gate reported as
passing from the tail of its output without its exit code, or a behaviour claimed from a unit test
when the criterion says "on a live pane", is a number that has not been earned — and this repository
has now caught both, in both directions, on the same day.
