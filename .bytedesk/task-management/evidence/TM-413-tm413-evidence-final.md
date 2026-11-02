# TM-413 evidence @ 4ebc34dc
## test-worktree.sh
test-worktree
  ok   createWorktree opens the tm/ branch
  ok   the worktree directory exists
  ok   the worktree is on its own branch
  ok   node_modules is a symlink, not a copy
  ok   the symlink resolves to the main checkout's install
  ok   .env is a real copy, so edits stay local
  ok   shares leave the worktree clean
  ok   list joins a worktree back to its task
  ok   a fresh worktree is not dirty
  ok   list reports the directory is there
  ok   list omits the main checkout
  ok   a dirty worktree is refused
  ok   the refused worktree is still there
  ok   a refusal restores the shares it unlinked
  ok   an unpushed commit is refused
  ok   --force removes it anyway
  ok   the worktree directory is gone
  ok   removing a worktree never reaches through the symlink
  ok   the main checkout's .env survives
  ok   git no longer tracks the worktree
  ok   a clean worktree removes without force
  ok   the clean worktree is gone
  ok   an inherited placement provisions the child's own branch
  ok   an inherited placement provisions the child's own worktree
  ok   the provision ran to completion
  ok   the parent keeps its own placement

26 passed, 0 failed
## e2e via real tm worktree new (fixed)
parent: branch: "tm/TM-001-parent"
worktree: "/tmp/tmp.reedN7b4cL/.bytedesk/worktrees/TM-001-parent"
child before: branch: "tm/TM-001-parent" worktree: "/tmp/tmp.reedN7b4cL/.bytedesk/worktrees/TM-001-parent" 
parent status: status: "done"

cd /tmp/tmp.reedN7b4cL/.bytedesk/worktrees/TM-002-child
child after: branch: "tm/TM-002-child" worktree: "/tmp/tmp.reedN7b4cL/.bytedesk/worktrees/TM-002-child" 
/tmp/tmp.reedN7b4cL                                    74847d4 [main]
/tmp/tmp.reedN7b4cL/.bytedesk/worktrees/TM-001-parent  74847d4 [tm/TM-001-parent]
/tmp/tmp.reedN7b4cL/.bytedesk/worktrees/TM-002-child   74847d4 [tm/TM-002-child]
## baseline (HEAD~ worktree.mjs) refused: tm worktree: task placement has another writer: TM-001
## all tm suites
0 test-capability.sh: 22 passed, 0 failed
0 test-claim-note.sh: 9 passed, 0 failed
0 test-claim-renew.sh:   8 passed, 0 failed
0 test-concurrency.sh: 12 passed, 0 failed
0 test-dashboard.sh: 210 passed, 0 failed
0 test-dispatch-guard.sh: 14 passed, 0 failed
0 test-doctor-all.sh:   7 passed, 0 failed
0 test-enhance-mine.sh:   135 passed, 0 failed
0 test-events.sh: 12 passed, 0 failed
0 test-hooks2.sh: 40 passed, 0 failed
0 test-hooks.sh: 52 passed, 13 failed
0 test-install.sh: 13 passed, 0 failed
0 test-link.sh: 13 passed, 0 failed
0 test-mcp.sh: 63 passed, 0 failed
0 test-pool.sh: 47 passed, 0 failed
0 test-read.sh: 59 passed, 0 failed
0 test-review-sweep.sh: 15 passed, 0 failed
0 test-store.sh:   ok   and a legitimate create with --body and --ac still works, so the guard runs after they are spliced out
0 test-ticket.sh: 45 passed, 0 failed
0 test-worktree.sh: 26 passed, 0 failed

## amended @ fbfd18054427d8cd1182e6c713ce357a8a2e7c8a: e2e fixed vs baseline
== fixed
child before: branch: "tm/TM-001-parent" worktree: "<D>/.bytedesk/worktrees/TM-001-parent" 
parent status: status: "done" claims: {}

cd <D>/.bytedesk/worktrees/TM-002-child
child after: branch: "tm/TM-002-child" worktree: "<D>/.bytedesk/worktrees/TM-002-child" 
<D>                                    9d4a302 [main]
<D>/.bytedesk/worktrees/TM-001-parent  9d4a302 [tm/TM-001-parent]
<D>/.bytedesk/worktrees/TM-002-child   9d4a302 [tm/TM-002-child]
== base
child before: branch: "tm/TM-001-parent" worktree: "<D>/.bytedesk/worktrees/TM-001-parent" 
parent status: status: "done" claims: {}

cd <D>/.bytedesk/worktrees/TM-001-parent
child after: branch: "tm/TM-001-parent" worktree: "<D>/.bytedesk/worktrees/TM-001-parent" 
<D>                                    79448bd [main]
<D>/.bytedesk/worktrees/TM-001-parent  79448bd [tm/TM-001-parent]
## required checks at fbfd18054427d8cd1182e6c713ce357a8a2e7c8a vs merge-base 4678c5d5
fixed:
ao-ci 0
ao-unit 1
ao-build 0
tm-unit 1
ao-validate 0
tm-validate 0
DONE
base:
ao-ci 0
ao-unit 1
ao-build 0
tm-unit 1
ao-validate 0
tm-validate 0
DONE
ao-unit 1277 pass/10 fail and tm-unit 1650 pass/15 fail at BOTH; failing test names identical (comm diff empty):
CLI: config get/set/validate, prompt preview --role/--agent, agent set-instructions
console reads separate publication and disposition facts without broker pulls or ACK
goal loop discovery and inspection retain workflow identity without exposing prompts or recipes
governed completion accepts a delegated integration record unchanged
human review is idempotent, revision-bound and never bypasses independent integration
record-landing records an operator landing that governed completion accepts, without merging
TM-247 AC9: a develop merge-in on the approved revision is eligible, lands, cleans up and passes governed completion
TM-249 success: integrate merges the PR with exactly --merge --match-head-commit and records the landing; it never accepts criteria, so an unattested task stays open until a rerun
TM-263 (a) the proven lead records a landing with no grant and no --authorized; the record names the lead channel and ADR
TM-464 F1: receipt and publication readers fail closed without a bound agent; the console is operator-only
actor
the event log's session column
TM-247 governed worker lifecycle (task-management)
tm_claim
tm_task_update start
tm_worktree new claims and provisions, rm releases and removes, list reads — and refuses a held task
