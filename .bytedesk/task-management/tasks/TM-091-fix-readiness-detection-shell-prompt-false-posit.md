---
id: "TM-091"
kind: "task"
status: "done"
created: "2026-09-05T04:01:22.975Z"
board: "bytedeskai/bytedesk-marketplace"
title: "Fix readiness detection: shell-prompt false positive and unreachable ready:false"
epic: "EP-014"
acceptance: [{"text":"The readiness match cannot be satisfied by the pane's pre-existing shell prompt","done":true,"at":"2026-09-05T07:32:14.745Z"},{"text":"The fixed-delay path can return ready:false, so the not-ready warning is reachable for all adapters","done":true,"at":"2026-09-05T07:32:14.862Z"},{"text":"failure_patterns no longer match on text unrelated to this launch attempt","done":true,"at":"2026-09-05T07:32:14.980Z"},{"text":"A test covers a pane whose shell prompt resembles the ready pattern","done":true,"at":"2026-09-05T07:32:15.107Z"}]
evidence: [".bytedesk/task-management/evidence/TM-091-topology-launch.test.mjs"]
commits: ["8f135ad"]
blockedBy: []
blocks: []
actor: "main"
session: "b0124774-6c67-41ff-9359-e1a31565e734"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
updated: "2026-09-05T07:32:15.377Z"
touches: ["agent-orchestration/providers","agent-orchestration/topology/lib/launch.mjs"]
comments: [{"author":"main","ts":"2026-09-05T07:32:14.628Z","text":"All four AC met, and the root cause was deeper than the ticket described. Beyond scoping the ready match to output produced after the launcher was sent (screenSince), nothing waited for the SHELL at all: the launcher was typed the instant the pane existed, so a slow rc file swallowed the keystrokes and the agent never started while readiness polling matched whatever the shell had drawn. launch.mjs now echoes a nonce through 'tmux wait-for' as a real cross-process barrier before typing anything, and takes the pane snapshot at that moment as the boundary between shell output and agent output. The fixed-delay path can now return ready:false, and failure patterns are matched only against fresh output so a run path containing 'quota' or 'capacity' no longer marks a healthy agent failed."}]
closed: "2026-09-05T07:32:15.372Z"
---

Two correctness bugs in waitReady (topology/lib/launch.mjs:158-181). First: claude.json's ready.pattern (^|\n)\s*[|]?\s*[>@]\s is tested against capture-pane -p -S -40, which includes the pane's own shell prompt and the echoed 'bash launch-0.sh' line, so a bare zsh or starship prompt matches on tick one. The bootstrap pointer is then typed into the shell before the CLI has drawn its input box; the agent never reads its bootstrap, run.state stays running, and the launch prints a tick. Silent total failure. Second: the fixed-delay path (grok, gemini, copilot, kimi, generic - five of seven adapters) sleeps delay_ms, runs one failure check and returns ready:true unconditionally, so ready:false is unreachable and the !started.ready warning at launch.mjs:340 is dead code for those five. Third, smaller: failureOnScreen regex-tests all 40 captured lines case-insensitively against words including quota and capacity, so a run path or banner containing one marks a healthy agent failed and burns a failover slot.