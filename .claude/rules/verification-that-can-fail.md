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

## What to do with a green run

State what you **verified** and what you only **read**. They are different words. A gate reported as
passing from the tail of its output without its exit code, or a behaviour claimed from a unit test
when the criterion says "on a live pane", is a number that has not been earned — and this repository
has now caught both, in both directions, on the same day.
