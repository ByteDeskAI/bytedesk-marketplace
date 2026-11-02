# TM-529 evidence — commit f45a4c86f19fae58f556c3aea777fa1a0c269e9b

## AC1/AC2 unit tests (fail on parent 3f3fe7ce, pass at f45a4c86f19fae58f556c3aea777fa1a0c269e9b)
- parent: provider-dirs-trust TM-529 test `not ok`; ringLeadPane TM-529 test returned {"rang":false,"reason":"the lead provider has no measured safe composer"}
- fixed: provider-dirs-trust 3/3 pass; lead-probe-stacking TM-529+TM-402 2/2 pass

## Bundle root resolution
/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace/.bytedesk/worktrees/TM-529-regression-240-tm-467-providerdirs-without-a-plu/agent-orchestration/dist/cli.cjs -> /home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace/.bytedesk/worktrees/TM-529-regression-240-tm-467-providerdirs-without-a-plu/agent-orchestration true
/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace/.bytedesk/worktrees/TM-529-regression-240-tm-467-providerdirs-without-a-plu/agent-orchestration/dist/mcp.cjs -> /home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace/.bytedesk/worktrees/TM-529-regression-240-tm-467-providerdirs-without-a-plu/agent-orchestration true
/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace/.bytedesk/worktrees/TM-529-regression-240-tm-467-providerdirs-without-a-plu/agent-orchestration/topology/lib/providers.mjs -> /home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace/.bytedesk/worktrees/TM-529-regression-240-tm-467-providerdirs-without-a-plu/agent-orchestration true

## AC3 live check (2026-10-09T18:10Z): ao-topology lead status --consumer <marketplace> against live Claude lead fd2b831f
status=responsive verdict_source=probe proof_age_ms=0
probe-state/fd2b831f.last-probe.json:
{
  "nonce": "1a9dc1f2-920b-49f7-908f-88b6b9c38ef4",
  "binding": {
    "serverKey": "/tmp/tmux-1000/default",
    "serverPid": 60758,
    "sessionId": "$17",
    "sessionCreated": 1791152777,
    "paneId": "%17",
    "panePid": 88351
  },
  "rang": true,
  "submitted": true,
  "reason": null,
  "at": 1791569446602,
  "rings": 1
}

answered at 14:10:50 local (4 s after the ring). The only 'no measured safe composer' text in the output is recovery.last_error stored at 18:08Z, before this run.

## Required checks at f45a4c86f19fae58f556c3aea777fa1a0c269e9b
npm ci 0; build:check 0; plugin validate ao 0; plugin validate tm 0; plugin-rsync tests 0
agent-orchestration unit: exit 1 — # pass 1330 # fail 11 
  failures identical to parent 3f3fe7ce control (10 pre-existing) plus 'a pane''s liveness and exit status come from one answer' — tmux timing only, passes 3/3 in isolation
task-management unit: exit 1 — 41 failures, identical list on parent 3f3fe7ce control (pre-existing; no task-management files changed)

Failing tests at f45a4c86f19fae58f556c3aea777fa1a0c269e9b:
- actual tm CLI provisions once, records worker claim, and enforces start before admission
- a pane's liveness and exit status come from one answer
- governed completion accepts a delegated integration record unchanged
- production worker proof uses actual tm registry and observed process exit before merge and cleanup
- record-landing records an operator landing that governed completion accepts, without merging
- TM-240: a standing reviewer refuses unadmitted tm dispatch; admit, dispatch, finish yields a reviewable revision
- TM-247 AC9: a develop merge-in on the approved revision is eligible, lands, cleans up and passes governed completion
- TM-249 success: integrate merges the PR with exactly --merge --match-head-commit and records the landing; it never accepts criteria, so an unattested task stays open until a rerun
- TM-263 (a) the proven lead records a landing with no grant and no --authorized; the record names the lead channel and ADR
- TM-347: a governed task returns to working after changes are requested, and only a new revision can be approved
- TM-417 AC4: admit, tm dispatch on the topology backend, finish report and reviewer request agree on one run id

## AC3 recheck at f45a4c86 (18:42Z)
status=responsive, verdict_source=cached (proof from the 18:10Z ring still valid, so no new ring was sent).
The 18:10Z ring ran commit 42e88f27, whose providerDirs fallback is identical in effect; f45a4c86 only
changes how the root is computed, and the bundle-root check above shows that computation resolves to the
plugin directory (where providers/claude.json exists) from source, dist/cli.cjs and dist/mcp.cjs.
Not done: a live ring driven through dist/mcp.cjs itself (the installed MCP server runs main, not this branch).
