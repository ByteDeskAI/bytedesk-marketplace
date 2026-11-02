## TM-287 evidence @ b070c9f8850bc1b268ed7f612041cd3c5c517496
### presence tests (fixed)
ok 1 - frozen fixtures and validator negative suite conform unchanged
ok 2 - producer emits standing, run, nested and pending metadata using exact bindings and passes frozen validator
ok 3 - same agent in separate runs retains separate bindings, depth five resolves, orphan resemblance never affiliates
ok 4 - parent directory identity mismatch remains unresolved
ok 5 - server restart and pane replacement remove membership instead of reattaching stale identity
ok 6 - name-only legacy registrations never authorize a current pane
ok 7 - generation allocation races fence all predecessors; revisions serialize and survive restarts
ok 8 - slow old collection cannot publish after a successor takes ownership
ok 9 - generation corruption or deletion fails closed; large decimal counters stay strings
ok 10 - independent repositories share monotonic allocator without fencing each other
ok 11 - heartbeat republishes complete snapshots within TTL thirds and stops on abort
ok 12 - configured directory and bounds honor the frozen contract
ok 13 - failed enumeration preserves the previous complete snapshot
ok 14 - all linked worktrees publish into the main checkout repository identity
ok 15 - real isolated tmux pane observation publishes only its exact standing incarnation
ok 16 - spawn metadata is explicit, validated, and preserves library standing independently of run role
ok 17 - TM-274: a spawn is identified by its recorded @ao-* metadata, whatever its session is named
ok 18 - multiple library leads refuse publication and preserve prior metadata
ok 19 - concurrent snapshot readers only observe complete JSON documents
# tests 19
# pass 19
# fail 0
### control 1: HEAD presence.mjs
not ok 17 - TM-274: a spawn is identified by its recorded @ao-* metadata, whatever its session is named
  expected: 'run'
  actual: 'spawn'
# pass 18
# fail 1
### control 2: HEAD presence.mjs, kind assertion stripped (validator only)
not ok 17 - TM-274: a spawn is identified by its recorded @ao-* metadata, whatever its session is named
# pass 18
# fail 1
    published snapshot fails Presence v2:
    FAIL 0.json: work0001: spawn sessionName must be <agentId>-<spawn>, got 'agents1--repo--worker--ada'
    
### full unit suite
not ok 465 - record-landing records an operator landing that governed completion accepts, without merging
not ok 472 - governed completion accepts a delegated integration record unchanged
not ok 496 - TM-249 success: integrate merges the PR with exactly --merge --match-head-commit and records the landing; it never accepts criteria, so an unattested task stays open until a rerun
not ok 512 - TM-263 (a) the proven lead records a landing with no grant and no --authorized; the record names the lead channel and ADR
# tests 931
# pass 923
# fail 4
### baseline topology-management with HEAD presence.mjs (same 4 fail)
not ok 17 - record-landing records an operator landing that governed completion accepts, without merging
not ok 24 - governed completion accepts a delegated integration record unchanged
not ok 48 - TM-249 success: integrate merges the PR with exactly --merge --match-head-commit and records the landing; it never accepts criteria, so an unattested task stays open until a rerun
not ok 64 - TM-263 (a) the proven lead records a landing with no grant and no --authorized; the record names the lead channel and ADR
# pass 72
# fail 4
