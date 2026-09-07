---
id: "TM-119"
kind: "task"
status: "open"
created: "2026-09-07T00:03:13.314Z"
board: "bytedeskai/bytedesk-marketplace"
title: "agent-orchestration: the death test's exit code is lost under load"
epic: "EP-017"
acceptance: [{"text":"The exit status assertion passes with the suite under load, demonstrated on a loaded machine","done":false},{"text":"Deadness and exit status come from one tmux query, or the retry that closes the window is justified in a comment","done":false}]
evidence: []
commits: ["d741258"]
blockedBy: []
blocks: []
actor: "main"
session: "4e1d7087-d606-432e-9341-3ce779b4baf8"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
updated: "2026-09-07T00:03:20.981Z"
---

tests/live/two-projects.sh assertion 'the real exit code reaches the journal' failed once under load and passed on two clean reruns of the same tree, so it is a flake rather than a regression.

Observed 2026-09-06 while the suite ran alongside a second live suite. The journal held:
  {"type":"agent.candidate_failed","agent":"boss","candidate":"deadfake","reason":"pane exited","exit_status":null}
The death itself was detected; only the status was null, so the grep for 42 found nothing.

Path: the deadfake adapter declares ready.pattern but no tmux_pattern, so readiness takes waitReady, which decides 'pane exited' from paneAlive(pane) and then asks paneDeath(pane) for the status in a SECOND tmux call (launch.mjs withExitStatus, tmux.mjs:357). paneDeath returns status null when display-message answers with an empty pane_dead_status — which is what a pane tmux has not finished reaping looks like, and what a pane already gone looks like too.

Worth fixing because the number is the whole diagnosis: 'pane exited' with no status cannot distinguish a CLI that refused its flags from one that was killed. Likely fix is to read deadness and status in one display-message call rather than deciding from paneAlive and then asking again, so there is no window between the two.