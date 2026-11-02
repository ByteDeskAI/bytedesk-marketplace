---
id: "TM-331"
kind: "task"
status: "open"
created: "2026-10-03T07:33:42.568Z"
board: "bytedeskai/bytedesk-marketplace"
title: "agent-orchestration: sandbox/real-agent runs must set AGENT_ORCHESTRATION_SERVICES=0 and disable the installed plugin; document it"
epic: "EP-026"
acceptance: [{"text":"Recipe documented and exercised once from a clean shell","done":false},{"text":"Doctor warns when a home is used by two plugin versions","done":false}]
evidence: []
commits: ["e1a6dadb"]
blockedBy: []
blocks: []
actor: "main"
session: "177a0074-f13b-446a-92db-45e161f580ba"
branch: "fix/ao-local-nats-autostart"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["ready-for-agent"]
triagedBy: "auto"
updated: "2026-10-03T08:48:02.657Z"
comments: [{"author":"main","ts":"2026-10-03T08:48:02.652Z","text":"Isolation recipe in docs/nats-native/ISOLATION.md (PR 179). Doctor warning for two plugin versions on one home is still to do."}]
---

Real claude panes put the installed plugin's bin first on PATH and inherit AGENT_ORCHESTRATION_BIN, so they ran the installed 0.15.4 and rewrote a new home's state. Document the isolation recipe (settings override enabledPlugins false, PATH, AGENT_ORCHESTRATION_BIN, SERVICES=0, short socket paths) in docs/ and in the setup skill.