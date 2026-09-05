---
id: "TM-097"
kind: "task"
status: "blocked"
created: "2026-09-05T04:02:08.557Z"
board: "bytedeskai/bytedesk-marketplace"
title: "Register orchestrator-spawned sessions as gateway tabs"
epic: "EP-014"
acceptance: [{"text":"A session spawned by the orchestrator appears in the gateway as a live terminal","done":false},{"text":"The tab binds to the correct project by cwd","done":false},{"text":"The approach follows the spike's finding on tab id pinning rather than assuming it","done":false},{"text":"Behaviour after a gateway restart or cutover is verified, not assumed","done":false}]
evidence: []
commits: ["8f135ad","25c5664"]
blockedBy: ["TM-087","TM-096"]
blocks: ["TM-101"]
actor: "main"
session: "a7da6c38-57d4-464b-b856-ebdb3dd72e1b"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
updated: "2026-09-05T04:18:03.767Z"
comments: [{"author":"main","ts":"2026-09-05T04:17:47.943Z","text":"Raised in importance by TM-101: carrying an agent's static id into the tmux session name is impossible until a caller can name a session at all. TM-087 established the session name is derived from a server-minted tab id and req.Session is decoded then overwritten. The req.Session fix is now load-bearing for identity, not only for visibility."}]
---

Every gateway tab is a tmux session named bytedesk-emote-gateway-<kind>-<id>, and the session name is derived from the tab record (tmuxSession + '-' + rec.ID) held in GATEWAY_HOME/terminal-tabs.json. There is no discovery by convention, so an orchestrator-spawned session is invisible no matter what it is called - the session design-system-ao created on 2026-09-04 proves it. The seam is ensureTmuxSession (src/terminal_runtime_tabs.go:724), which runs has-session first and reuses an existing session rather than spawning: pre-create the session, then register a tab with the same kind and id, and the gateway attaches to what was built. Depends on the id-pinning spike. A project in the gateway is a registered root in projects.json, and a tab belongs to one when its cwd is under that root, so project binding comes free from launching in the right directory. Adding an agent CLI is config (GATEWAY_HOME/agent-clis.json); adding a stream kind is a code change in health.go terminalStreamKinds.