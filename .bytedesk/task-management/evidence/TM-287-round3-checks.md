# TM-287 round 3 checks @ b561eaec815660314ed2330bcdbdcdfb4b05ca10
## build:check (exit 0)
  ..../../../tmp/ao-build-check-cwzTs4/claude-agent-acp.mjs.LEGAL.txt  197b 

⚡ Done in 174ms
## test:unit (exit 1: 4 known topology-management failures)
not ok 469 - record-landing records an operator landing that governed completion accepts, without merging
not ok 476 - governed completion accepts a delegated integration record unchanged
not ok 500 - TM-249 success: integrate merges the PR with exactly --merge --match-head-commit and records the landing; it never accepts criteria, so an unattested task stays open until a rerun
not ok 516 - TM-263 (a) the proven lead records a landing with no grant and no --authorized; the record names the lead channel and ADR
# tests 941
# pass 933
# fail 4
## test:contract (exit 1)
not ok 8 - tests/contract/topology-tmux.test.mjs
# tests 20
# pass 19
# fail 1
topology-tmux.test.mjs: all 5 subtests pass; the file fails on the TM-290 provider guard (5 real claude lead spawns from enrolled temp repos). Identical on base 4c87f1ed (origin/fix/ao-local-nats-autostart) without TM-287 changes.
