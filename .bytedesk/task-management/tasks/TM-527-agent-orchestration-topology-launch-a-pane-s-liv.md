---
id: "TM-527"
kind: "task"
status: "open"
created: "2026-10-09T08:48:14.559Z"
board: "bytedeskai/bytedesk-marketplace"
title: "agent-orchestration: topology-launch 'a pane's liveness and exit status come from one answer' fails intermittently: tmux reports a dead pane with no exit status"
epic: "EP-029"
acceptance: [{"text":"The test passes 20 of 20 runs of the 12-way parallel probe pattern","done":false},{"text":"The test still fails if paneState takes the status from a second query","done":false}]
evidence: []
commits: []
blockedBy: []
blocks: []
actor: "@main"
session: "fd2b831f"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
filedBy: {"board":"bytedeskai/bytedesk-marketplace","agent":"b6cf650f","task":"TM-427"}
labels: ["decision:intake","needs-triage"]
triagedBy: "auto"
triageMissing: ["label decision:intake"]
updated: "2026-10-09T08:48:14.578Z"
---

Intermittent failure in tests/unit/topology-launch.test.mjs:813. After respawn-pane -k ... sh -c 'exit 42' with remain-on-exit on, tmux sometimes reports the pane dead with pane_dead_status empty, and it stays empty: it is not a timing delay, so a longer sleep does not fix it. Measured 2026-10-09 on tmux 3.4 with a probe sampling paneState every 100 ms for 3 s, 12 runs in parallel: 11 showed D/42 at 100 ms; 1 showed D/null for the full 3 s. Seen in 2 of 3 full npm run test:unit runs on a loaded host (TM-427 at fccb17b1); passes alone 4/4. The test file, topology/lib/tmux.mjs and the tmux test helpers are identical to main. Probe script: /tmp/tm427-diag/panestate.mjs and load.sh. Likely fix: make the respawned command outlive tmux's child setup (for example sh -c 'sleep 0.2; exit 42'), so the test pins one-answer semantics without depending on tmux catching an instant exit.