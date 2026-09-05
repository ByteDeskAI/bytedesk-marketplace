---
id: "TM-099"
kind: "task"
status: "done"
created: "2026-09-05T04:02:08.824Z"
board: "bytedeskai/bytedesk-marketplace"
title: "Replace tmux polling with subscriptions, hooks and pipe-pane"
epic: "EP-014"
acceptance: [{"text":"Readiness is driven by a refresh-client subscription rather than a capture-pane poll loop","done":true,"at":"2026-09-05T10:26:13.645Z"},{"text":"Agent death is detected by a hook rather than by polling, with the real exit code recorded","done":true,"at":"2026-09-05T10:26:14.043Z"},{"text":"Pane output is captured durably without losing what was written before capture attached","done":true,"at":"2026-09-05T10:26:14.182Z"},{"text":"Agents no longer start strictly serially","done":true,"at":"2026-09-05T10:26:14.326Z"},{"text":"Ten agents cost no more per-agent polling than three","done":true,"at":"2026-09-05T10:26:14.463Z"}]
evidence: [".bytedesk/task-management/evidence/TM-099-two-projects.sh",".bytedesk/task-management/evidence/TM-099-topology-launch.test.mjs"]
commits: ["8f135ad","e0ec159","2d67bc2","4482125","50889c8"]
blockedBy: ["TM-088"]
blocks: []
actor: "main"
session: "4e1d7087-d606-432e-9341-3ce779b4baf8"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
updated: "2026-09-05T10:26:52.250Z"
touches: ["agent-orchestration/topology/lib/launch.mjs","agent-orchestration/topology/lib/tmux.mjs"]
parkedReason: "session ended (b0124774-6c67-41ff-9359-e1a31565e734)"
comments: [{"author":"main","ts":"2026-09-05T10:26:23.708Z","text":"Two latent defects surfaced while measuring AC5 and are fixed here: splits halved the active pane so the 7th agent died on 'no space for new pane', and on a shared tmux server the window inherited an unrelated client's size (93x20), leaving stacked panes 12 cols wide so the per-rendered-line ready search could never match a wrapped pattern."}]
closed: "2026-09-05T10:26:26.584Z"
---

The topology layer's entire tmux vocabulary is twelve verbs and it uses no event-driven surface at all: no control mode, no set-hook, no wait-for, no pipe-pane, no paste buffers (grep-confirmed). Readiness costs two capture-pane calls plus a display-message every 500ms per agent, and agents start strictly serially so worst-case launch is agents x timeout_ms. Verified against the live tmux 3.4 server: refresh-client -B "ready:%*:#{C/r:<regex>}" subscribes to a server-side content search across every pane and pushes %subscription-changed on change at most once a second, replacing the whole poll loop with zero polls; one control-mode client per session receives every pane's output as %output events, with pause-after=N and %pause/%continue for backpressure. Hooks make death detection push rather than poll - pane-died and pane-exited run a shell command with #{hook_pane} interpolated - and remain-on-exit on gives a real exit code and signal via #{pane_dead_status}, with respawn-pane -k restarting in place with the pane id intact. wait-for is a genuine cross-process barrier (measured 2.005s, zero polling). Two gotchas: the refresh-client argument must be quoted because # starts a comment and a leading % also breaks the parser, and show-hooks -g is not the full hook list - it omits pane-died and pane-exited even though both fire.