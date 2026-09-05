---
id: "TM-091"
kind: "task"
status: "open"
created: "2026-09-05T04:01:22.975Z"
board: "bytedeskai/bytedesk-marketplace"
title: "Fix readiness detection: shell-prompt false positive and unreachable ready:false"
epic: "EP-014"
acceptance: [{"text":"The readiness match cannot be satisfied by the pane's pre-existing shell prompt","done":false},{"text":"The fixed-delay path can return ready:false, so the not-ready warning is reachable for all adapters","done":false},{"text":"failure_patterns no longer match on text unrelated to this launch attempt","done":false},{"text":"A test covers a pane whose shell prompt resembles the ready pattern","done":false}]
evidence: []
commits: ["8f135ad"]
blockedBy: []
blocks: []
actor: "main"
session: "a7da6c38-57d4-464b-b856-ebdb3dd72e1b"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
updated: "2026-09-05T04:08:51.466Z"
touches: ["agent-orchestration/providers","agent-orchestration/topology/lib/launch.mjs"]
---

Two correctness bugs in waitReady (topology/lib/launch.mjs:158-181). First: claude.json's ready.pattern (^|\n)\s*[|]?\s*[>@]\s is tested against capture-pane -p -S -40, which includes the pane's own shell prompt and the echoed 'bash launch-0.sh' line, so a bare zsh or starship prompt matches on tick one. The bootstrap pointer is then typed into the shell before the CLI has drawn its input box; the agent never reads its bootstrap, run.state stays running, and the launch prints a tick. Silent total failure. Second: the fixed-delay path (grok, gemini, copilot, kimi, generic - five of seven adapters) sleeps delay_ms, runs one failure check and returns ready:true unconditionally, so ready:false is unreachable and the !started.ready warning at launch.mjs:340 is dead code for those five. Third, smaller: failureOnScreen regex-tests all 40 captured lines case-insensitively against words including quota and capacity, so a run path or banner containing one marks a healthy agent failed and burns a failover slot.