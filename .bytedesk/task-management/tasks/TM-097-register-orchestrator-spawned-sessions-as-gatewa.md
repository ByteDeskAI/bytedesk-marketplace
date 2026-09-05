---
id: "TM-097"
kind: "task"
status: "done"
created: "2026-09-05T04:02:08.557Z"
board: "bytedeskai/bytedesk-marketplace"
title: "Register orchestrator-spawned sessions as gateway tabs"
epic: "EP-014"
acceptance: [{"text":"A session spawned by the orchestrator appears in the gateway as a live terminal","done":true,"at":"2026-09-05T07:35:13.897Z"},{"text":"The tab binds to the correct project by cwd","done":true,"at":"2026-09-05T07:35:14.096Z"},{"text":"The approach follows the spike's finding on tab id pinning rather than assuming it","done":true,"at":"2026-09-05T07:35:14.259Z"},{"text":"Behaviour after a gateway restart or cutover is verified, not assumed","done":true,"at":"2026-09-05T07:35:14.425Z"}]
evidence: [".bytedesk/task-management/evidence/TM-097-1788593747167.log"]
commits: ["8f135ad","25c5664","df9696c","https://github.com/ByteDeskAI/bytedesk-remote-gateway/pull/124"]
blockedBy: ["TM-087","TM-096"]
blocks: ["TM-101"]
actor: "main"
session: "a7da6c38-57d4-464b-b856-ebdb3dd72e1b"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
updated: "2026-09-05T10:50:02.313Z"
comments: [{"author":"main","ts":"2026-09-05T04:17:47.943Z","text":"Raised in importance by TM-101: carrying an agent's static id into the tmux session name is impossible until a caller can name a session at all. TM-087 established the session name is derived from a server-minted tab id and req.Session is decoded then overwritten. The req.Session fix is now load-bearing for identity, not only for visibility."},{"author":"main","ts":"2026-09-05T07:35:13.681Z","text":"Done on branch ep014/session-pinning (commit cc70a11) in an isolated worktree of bytedesk-remote-gateway, branched from develop @7992a9c. Not pushed; awaiting review. The builder now honours a caller-supplied req.Session: charset letters/digits/-/_ , max 96 chars, whitespace rejected rather than trimmed. '.' and ':' are REFUSED against the task's suggested charset, on measurement — tmux 3.4 in this environment silently renames 'ep014.dot.test' to 'ep014_dot_test' and then 'has-session -t' fails with 'can't find pane: dot.test', so allowing a dot would break ensureTmuxSession's probe and attach. Collision rule: reject with 400 if the name resolves to a live tab or a pending-restore record; a tmux session belonging to no tab is free to adopt, which is the feature. No-session path is byte-for-byte unchanged and pinned by a test; no caller sets Session today. Restart/cutover measured both ways: a live session is REATTACHED (process and scrollback survive), a dead one is RECREATED FROM THE RECORD'S Command, not from what the orchestrator actually ran. Verified with a recording fake tmux plus one real-tmux adoption test; NOT verified end to end through a live gateway HTTP -> ttyd iframe."},{"author":"main","ts":"2026-09-05T10:50:02.309Z","text":"Landed for review: rebased onto current origin/develop (11 commits of drift, clean), go build ./... and go test ./... both pass, pushed as ep014/session-pinning and opened as ByteDeskAI/bytedesk-remote-gateway#124 against develop. The 'not pushed, awaiting review' state from the earlier session is resolved. Still not verified end to end through a live gateway HTTP -> ttyd iframe; coverage is a recording fake tmux plus one real-tmux adoption test."}]
closed: "2026-09-05T07:35:47.275Z"
---

Every gateway tab is a tmux session named bytedesk-emote-gateway-<kind>-<id>, and the session name is derived from the tab record (tmuxSession + '-' + rec.ID) held in GATEWAY_HOME/terminal-tabs.json. There is no discovery by convention, so an orchestrator-spawned session is invisible no matter what it is called - the session design-system-ao created on 2026-09-04 proves it. The seam is ensureTmuxSession (src/terminal_runtime_tabs.go:724), which runs has-session first and reuses an existing session rather than spawning: pre-create the session, then register a tab with the same kind and id, and the gateway attaches to what was built. Depends on the id-pinning spike. A project in the gateway is a registered root in projects.json, and a tab belongs to one when its cwd is under that root, so project binding comes free from launching in the right directory. Adding an agent CLI is config (GATEWAY_HOME/agent-clis.json); adding a stream kind is a code change in health.go terminalStreamKinds.