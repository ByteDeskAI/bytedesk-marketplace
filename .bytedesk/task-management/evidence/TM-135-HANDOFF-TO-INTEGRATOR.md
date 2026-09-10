# TM-135 — exact revision for the integrator

**Merge this:** the head of branch `tm/TM-135-idle-dispatch-quota-failover`. It is named by branch
rather than by SHA on purpose: the tip is this evidence file itself, so any SHA written in here is
stale the moment it is committed. The last code commit is `0a0228f` (the config-text fix in finding
1); everything after it is evidence.

That head is `8631f2b` (all the code) plus `091f85e` (evidence only — the correction to my own
earlier review). The two commits before it on this branch, `ef33efc` and `74fdb5f`, are evidence
files that were later corrected in place; they are kept for the record and change no code.

| Revision | What it is |
|---|---|
| `a5d550e` | TM-135 part A, salvaged from a crashed worker, committed unreviewed |
| `ef33efc` | my review of it — **wrong twice**, corrected at `091f85e`, kept |
| `74fdb5f` / `27625ae` | gate evidence, and the retraction of its "pre-existing failure" claim |
| `8631f2b` | part B + part A completion; fixes two real bugs in `a5d550e` |
| **`091f85e`** | **branch head** — the review correction |

## VERIFIED, and how

Everything in this section I ran or mutated myself in this session. Nothing here is inferred from
the commit message.

**Gates at `8631f2b`** (`node --test --test-concurrency=1`; the parallel run is OOM-killed here):

| Gate | Result |
|---|---|
| `agent-orchestration` unit, all files | 494 tests, 490 pass, 0 fail, 4 skipped |
| `agent-orchestration` contract | 6 tests, 6 pass, 0 fail |
| `build:check` | pass |
| `roadmap:check` | `ROADMAP OK: 55 tasks, 96 unlocks, 6 goals, 7 trajectories, 7 gaps` |
| `validate_presence.py`, frozen and unmodified | `ok — 7 snapshot(s) conform to Presence v1 (contract revision 3)` |
| `test_validator.py`, frozen and unmodified | `all negative tests pass` |
| `topology/fixtures/presence-v1/` touched by the commit | **no** — the diff is empty |
| `task-management` unit | 1364 tests, 1364 pass, 0 fail |
| operator tmux sessions, before and after | **5 → 5** |

**The merge into `main` is clean, and clean semantically as well as textually.**

- `git merge-tree --write-tree main HEAD` produces a tree with no conflict.
- The only `main` commit touching the shared files since this branch's base (`36b9308`) is
  `14b3ecd`, TM-140/TM-141.
- I built the throwaway merge commit `82540a6` (`commit-tree` from that merged tree, `main` and the
  branch as parents), checked it out into a detached worktree, and ran the suites **on the merged
  tree**: topology unit **324 pass, 0 fail**; `task-management` unit **1364 pass, 0 fail**.
  324 is exactly the branch's 319 plus main's five new TM-140/141 consistency tests — additive, so
  the quota watch riding the supervise tick and TM-141's degraded-tick semantics compose.

**The two bug fixes are load-bearing, proved by mutation** — I broke each one in a throwaway
`git archive` extract of `8631f2b` and confirmed the suite goes red:

| Mutation | Result |
|---|---|
| envelope id back to `(repo, task, agent)`, no round | `not ok 5 — reassigning the same task to the same agent mints a NEW envelope, not the last round's` |
| six-tuple re-proof deleted from inside the lock | `not ok 3 — an agent the census calls idle but whose pane incarnation is gone is refused` |
| defence 1's second-look delay removed from `quotaTick` | 6 failures, including `not ok 11 — DEFENCE 1: a single trigger is a suspicion` |

Baseline for those two files unmutated: 10/10 and 20/20.

**Detection restarts nothing — verified by call graph, not by comment.** `failoverAgent` has exactly
one caller in the whole tree: `topology/cli.mjs:1089`. `supervision.mjs` mentions it only in a
comment. So the supervise tick can write an incident and ring the lead, and cannot take a pane over,
under any value of `failover.consent`.

## READ ONLY, not executed

- `topology/lib/quota.mjs`'s tmux control-mode path against a **real** tmux server. Its 20 tests use
  a fake control client that pushes values; no live `ControlClient` subscription was exercised here.
- `collectIdle` against a real `ao-topology` binary. Its tests stub `spawnImpl`; I read the CLI and
  confirmed `manage assignment|release --task --consumer` and `--reason` exist
  (`cli.mjs:103`, `:360`, `:431`), but I did not run the two processes end to end.
- The idle-dispatch happy path on live panes. No end-to-end demo was run for TM-135.

## Findings — one to decide, two to note

**1. FIXED on this branch, was: `failover.consent: "never"` does not do what its own config text says.** `config.defaults.json`'s
`_why` states never "refuses every takeover, whatever anyone types on the command line." It does not:
`failoverAgent` consults consent only when an `incidentId` is supplied (`launch.mjs`, the
`if (incidentId)` branch), so a bare `ao-topology failover --run … --agent …` with no `--incident`
proceeds under `never`. The code's intent is deliberate and defensible — the CLI comment says an
operator at a keyboard is already the human turn — but the config text asserts the opposite and an
operator reading it would be wrong. I fixed the text rather than the gate, because gating the manual
path would mean an operator with a genuinely dead provider must edit config before recovering. The
`_why` string now states the gate's real scope and says why the manual path is outside it.
`config.defaults.json` still parses and `topology-quota.test.mjs` is 20/20 after the edit.

**2. Residual false positive, bounded.** `confirmQuota`'s defence 2 confirms on "no progress". An
agent that prints a quota signature and then **ends its turn** is alive, is not animating, and the
words do not scroll away, so defences 1 and 2 both pass and an incident is opened. The cost is one
incident record and one message to the lead — in every consent mode, because of the call-graph fact
above. Worth a follow-up capability entry, not a merge blocker.

**3. Version marker.** `agent-orchestration/package.json` is `0.7.1` on both `main` and this branch,
and both CHANGELOGs accumulate under `## [Unreleased]`. That is the epic's convention, so this
commit needs no bump; the minor bump belongs to the EP-018 closeout commit.

## Routed to you, not done by me

`.bytedesk/task-management/capabilities/CAP-0002-stop-gate-mis-attributes-a-claim-that-has-no-ses.md`
in the **shared main checkout** is modified and uncommitted — the Part B worker wrote CAP-0002's
body up there rather than in this worktree. It is a write under `.bytedesk/task-management/`, so it
is yours. 75 lines, modified 21:36.
