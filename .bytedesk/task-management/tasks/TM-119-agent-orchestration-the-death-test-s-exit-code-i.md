---
id: "TM-119"
kind: "task"
status: "in_progress"
created: "2026-09-07T00:03:13.314Z"
board: "bytedeskai/bytedesk-marketplace"
title: "agent-orchestration: the death test's exit code is lost under load"
epic: "EP-017"
acceptance: [{"text":"The exit status assertion passes with the suite under load, demonstrated on a loaded machine","done":true,"at":"2026-09-07T00:17:18.154Z"},{"text":"Deadness and exit status come from one tmux query, or the retry that closes the window is justified in a comment","done":true,"at":"2026-09-07T00:17:18.268Z"}]
evidence: [".bytedesk/task-management/evidence/TM-119-TM-119-two-projects-under-load.txt"]
commits: ["d741258"]
blockedBy: []
blocks: []
actor: "main"
session: "4e1d7087-d606-432e-9341-3ce779b4baf8"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
updated: "2026-09-07T00:17:18.271Z"
comments: [{"author":"main","ts":"2026-09-07T00:17:17.915Z","text":"Two defects in one place, both measured on tmux 3.4 rather than reasoned about.\n\n1. The one the task names. Liveness and exit status were two display-message calls — paneAlive to decide the verdict, paneDeath to fetch the number — so a pane reaped between them yielded 'pane exited' with exit_status null. paneState now answers both in one query and paneAlive delegates to it.\n\n2. Found while probing the first: tmux answers an UNKNOWN pane id with exit 0 and an empty line, not an error. 'display-message -p -t %99999 \"#{pane_dead}\"' prints nothing and exits 0, so 'pane_dead != \"1\"' read a pane that no longer exists as ALIVE — in the old paneAlive and in my first version of paneState alike. An empty answer is now 'gone'. The test pinning it was mutation-checked: removing that one guard turns it red.\n\nAC1 demonstrated rather than asserted: two-projects.sh run against 48 spinning processes on a 32-core box, load average 55-68 throughout. 'the real exit code reaches the journal' PASSED. The suite's one failure under that load was the startup-cost assertion ('three agents cost 10959ms against a 7819ms baseline'), which is a timing ratio measured across a load spike and is not what this task is about."}]
---

tests/live/two-projects.sh assertion 'the real exit code reaches the journal' failed once under load and passed on two clean reruns of the same tree, so it is a flake rather than a regression.

Observed 2026-09-06 while the suite ran alongside a second live suite. The journal held:
  {"type":"agent.candidate_failed","agent":"boss","candidate":"deadfake","reason":"pane exited","exit_status":null}
The death itself was detected; only the status was null, so the grep for 42 found nothing.

Path: the deadfake adapter declares ready.pattern but no tmux_pattern, so readiness takes waitReady, which decides 'pane exited' from paneAlive(pane) and then asks paneDeath(pane) for the status in a SECOND tmux call (launch.mjs withExitStatus, tmux.mjs:357). paneDeath returns status null when display-message answers with an empty pane_dead_status — which is what a pane tmux has not finished reaping looks like, and what a pane already gone looks like too.

Worth fixing because the number is the whole diagnosis: 'pane exited' with no status cannot distinguish a CLI that refused its flags from one that was killed. Likely fix is to read deadness and status in one display-message call rather than deciding from paneAlive and then asking again, so there is no window between the two.