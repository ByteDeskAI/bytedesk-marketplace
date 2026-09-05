---
id: "TM-099"
kind: "task"
status: "open"
created: "2026-09-05T04:02:08.824Z"
board: "bytedeskai/bytedesk-marketplace"
title: "Replace tmux polling with subscriptions, hooks and pipe-pane"
epic: "EP-014"
acceptance: [{"text":"Readiness is driven by a refresh-client subscription rather than a capture-pane poll loop","done":false},{"text":"Agent death is detected by a hook rather than by polling, with the real exit code recorded","done":false},{"text":"Pane output is captured durably without losing what was written before capture attached","done":false},{"text":"Agents no longer start strictly serially","done":false},{"text":"Ten agents cost no more per-agent polling than three","done":false}]
evidence: []
commits: ["8f135ad"]
blockedBy: ["TM-088"]
blocks: []
actor: "main"
session: "a7da6c38-57d4-464b-b856-ebdb3dd72e1b"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
updated: "2026-09-05T07:29:30.311Z"
touches: ["agent-orchestration/topology/lib/launch.mjs","agent-orchestration/topology/lib/tmux.mjs"]
---

The topology layer's entire tmux vocabulary is twelve verbs and it uses no event-driven surface at all: no control mode, no set-hook, no wait-for, no pipe-pane, no paste buffers (grep-confirmed). Readiness costs two capture-pane calls plus a display-message every 500ms per agent, and agents start strictly serially so worst-case launch is agents x timeout_ms. Verified against the live tmux 3.4 server: refresh-client -B "ready:%*:#{C/r:<regex>}" subscribes to a server-side content search across every pane and pushes %subscription-changed on change at most once a second, replacing the whole poll loop with zero polls; one control-mode client per session receives every pane's output as %output events, with pause-after=N and %pause/%continue for backpressure. Hooks make death detection push rather than poll - pane-died and pane-exited run a shell command with #{hook_pane} interpolated - and remain-on-exit on gives a real exit code and signal via #{pane_dead_status}, with respawn-pane -k restarting in place with the pane id intact. wait-for is a genuine cross-process barrier (measured 2.005s, zero polling). Two gotchas: the refresh-client argument must be quoted because # starts a comment and a leading % also breaks the parser, and show-hooks -g is not the full hook list - it omits pane-died and pane-exited even though both fire.