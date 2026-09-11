# TM-169 — trust is keyed on the git common directory

## The defect

`doctor` reported no problems for a repository — specifically not
`CLAUDE_FOLDER_UNTRUSTED` — and the first agent then stopped at the folder-trust modal,
which is the exact failure that check exists to predict. A **false negative**, in the
direction that costs a stalled launch: it promises a demo will run, and it does not.

The check walked ancestors and took the nearest entry, so an accepted directory anywhere
above the repository answered "trusted".

## The rule, determined by experiment

Five cases, each run as a real interactive pane on an isolated socket and observed:

| cwd | git common dir | entry? | modal |
|---|---|---|---|
| agent dir in an untrusted repo | that repo | none | **YES** |
| agent dir in a trusted repo | that repo | true | no |
| fresh git repo under a **trusted** ancestor | itself | none | **YES** |
| fresh deep subdir of a trusted repo | that repo | true | no |
| linked worktree, own path never trusted | the **main** repo | true | no |

- Case 3 kills the ancestor walk — an accepted ancestor does **not** cover a repository nested under it.
- Case 4 kills an exact-path lookup.
- Case 5 kills keying on the worktree toplevel.

One rule fits all five: Claude Code keys folder trust on the **git common directory** —
the identity this plugin already uses for leads and slots, *"so every linked worktree
shares one lead"*. Not a new concept; the one already here.

## Verified (ran it)

| check | result |
|---|---|
| fixed doctor vs the five live observations | **all match** |
| `origin/main`'s doctor vs the same | **false negative on both untrusted cases** |
| new unit test vs `origin/main`'s doctor | **fails** (seen to fail before being trusted) |
| new unit test vs the fix | passes |
| `topology-first-run.test.mjs` | 9 pass, 0 fail |
| full topology unit suite, rebased on `7ebc08e` | **383 pass, 0 fail** |

## A decision worth stating

The non-git branch keeps the ancestor walk. Outside a git tree there is no repository to
key on, so there is no better answer, and it is the same two-branch shape
`canonicalRepoId` itself has. It is deliberately not the answer for a git tree.

This also means the existing *"a subdirectory of a trusted repository is trusted"* test
passes **unchanged** — its fixture has no git repo. I would rather leave someone else's
test alone than rewrite its fixture so my change passes; that move is how a fix quietly
redefines the thing it was supposed to satisfy.

## History

This is the third position this check has held. The first asked about the exact path and
was wrong for worktrees. The second walked ancestors and was wrong in the more dangerous
direction. This is the first with an experiment behind it rather than an argument — and
the reason it exists at all is that the demo stalled where `doctor` had said it would not.
