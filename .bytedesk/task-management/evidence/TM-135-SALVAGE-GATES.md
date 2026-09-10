# TM-135 — gate evidence for the salvaged revision `a5d550e`

The gap nobody had closed: `a5d550e` was committed unreviewed to avoid losing a
crashed worker's output, and **no gate output existed for it from anyone**. This
is that output. Produced by the worktree dispatcher.

## Method — isolated, and with a real control

Both revisions were extracted with `git archive` into separate `/tmp` trees. No
worktree was used, no shared checkout was written, and the two trees share
nothing. That matters: earlier in this epic a worker symlinked one `node_modules`
into both its test tree and its control tree, concluded "both fail identically =
pre-existing", and was wrong — **a control that shares the confounder is not a
control.** These do not share one.

Tests run with `node --test --test-concurrency=1`. The parallel run is OOM-killed
on this machine (exit 137).

## Results at `a5d550e`

| Gate | Result |
|---|---|
| `topology-*.test.mjs` (agent-orchestration) | **289 tests, 289 pass, 0 fail, 0 skipped** |
| `validate_presence.py` (frozen, unmodified) | `ok — 7 snapshot(s) conform to Presence v1 (contract revision 3)` |
| `test_validator.py` (frozen, unmodified) | `all negative tests pass` |
| `topology/fixtures/presence-v1/` touched by this commit? | **no** — diff is empty |
| `task-management` unit suite | 1347 tests, 1346 pass, **1 fail** |

(289 rather than main's 294: the branch predates the five TM-140/141 consistency
tests. Not a regression — a different base.)

## RETRACTED — the "pre-existing failure" conclusion was WRONG

**This section originally claimed `not ok 206 - the handshake identifies the code,
not merely 'dev'` was a pre-existing defect, verified by a control run on
`a5d550e^`. That conclusion is retracted. It was an artifact of my method.**

Caught by the integrator, who checked this evidence instead of accepting it.

**The confounder:** a `git archive` tree has **no `.git` directory**. That test
asserts the handshake does not answer `dev`, and its own comment says how it is
meant to pass — *"a source checkout asks git"*. With no repository to ask, it
answers `dev` and fails **by construction, at every revision, forever**.

Both my tree and my control were archive extracts. They shared that confounder
**identically**, so the control could not possibly have detected it. A control
that shares the confounder is not a control.

That sentence is in this very document, one section above, where I wrote it about
an earlier worker who symlinked one `node_modules` into both trees and drew the
same shape of false conclusion. I wrote the warning and then walked into it. The
`node_modules` confounder I did eliminate; the missing `.git` I did not even see.

**Verified properly by the integrator, in a real checkout rather than an archive:**
`main` **passes** this test — task-management unit suite 1350 pass, 0 fail — and
the *same* test fails when `main` is extracted with `git archive` into `/tmp`.

**Consequences, so nobody acts on the retracted claim:**

- There is **no unowned defect**. My earlier "someone should own this" was wrong;
  no task was filed and nobody should go looking for an owner.
- The real problem is that gates run from archive trees fail this test forever and
  read as a regression to the next person. The integrator filed **TM-149** for it,
  and an honest skip when no SHA is resolvable is a better fix than a document
  nobody reads before reaching for archive isolation.
- `build:check` and `roadmap:check` remain unverified at this revision for the
  same root cause: an archive tree has no `node_modules` either.

**What still stands from the original run:** topology 289/289, both frozen presence
validators passing unmodified, and the frozen fixtures untouched by this commit.
Those results do not depend on `.git` and are unaffected by the retraction.

## Original section, retained for the record

## The one failure is PRE-EXISTING, and that was verified, not assumed

```
not ok 206 - the handshake identifies the code, not merely 'dev'
```

Control run on **`a5d550e^`** — the parent commit, containing none of the
idle-dispatch code:

```
not ok 206 - the handshake identifies the code, not merely 'dev'
# tests 1347   # pass 1346   # fail 1
```

Identical failure, identical counts. `a5d550e` did not cause it. It touches
`task-management/lib/dispatch/backend.mjs` and adds `lib/dispatch/idle.mjs`,
neither of which is in that test's path — but the control is what establishes
that, not the reasoning.

**This failure is unowned.** It is not TM-135's to fix and it is not tracked
anywhere I can find. Someone should own it; flagging rather than adopting it.

## Verdict

The salvaged half **runs**. Combined with the source review in
`TM-135-SALVAGE-REVIEW.md` — where the double-assignment invariant was confirmed
to hold — it is a sound base for the remaining work.

Still not verified by anyone: `npm run build:check` and `roadmap:check` at this
revision, both of which need `node_modules` that an archive tree does not have.
