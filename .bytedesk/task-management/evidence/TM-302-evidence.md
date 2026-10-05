# TM-302 evidence — fc0cb3865cb38726dd5b33a6380232d0324150aa (PR #165)

## reviewer restart tests
ok 1 - TM-302 restart applies a staged prompt by a read-only relaunch and clears restart_required
ok 2 - TM-302 restart is refused TOPOLOGY_AGENT_BUSY while a review request is published and uncollected
ok 3 - TM-302 resume on a reviewer is a fresh read-only launch and says so
ok 4 - TM-302 restart refuses an agent that is not the registered reviewer
# pass 4
# fail 0
exit=0

## build
npm ci / build / build:check: 0 / 0 / 0; git status clean after build:check

## contract
# pass 19
# fail 0
contract exit=0

## unit (full)
not ok 532 - record-landing records an operator landing that governed completion accepts, without merging
not ok 539 - governed completion accepts a delegated integration record unchanged
not ok 563 - TM-249 success: integrate merges the PR with exactly --merge --match-head-commit and records the landing; it never accepts criteria, so an unattested task stays open until a rerun
not ok 579 - TM-263 (a) the proven lead records a landing with no grant and no --authorized; the record names the lead channel and ADR
# pass 1009
# fail 4
unit exit=1

The 4 unit failures fail identically on clean base 37918336; topology-management.test.mjs passes 76/76 on base and branch with TM_DISPATCH_*/TM_ACTOR/TM_SESSION_ID/TM_ROOT unset:
# pass 76
# fail 0
