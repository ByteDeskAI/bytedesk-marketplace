---
id: "TM-168"
kind: "task"
status: "open"
created: "2026-09-10T22:09:27.914Z"
board: "bytedeskai/bytedesk-marketplace"
title: "agent-orchestration: display consistent role icons on every orchestration agent"
epic: "EP-019"
acceptance: [{"text":"One pure role-visual registry returns the approved Unicode mapping for every built-in role, nested teams, and an unknown or custom-role fallback; agent definitions gain no icon field.","done":false},{"text":"Stored agents, inline workflow agents, durable role sessions, run agents, nested workflow participants, and unknown enrolled sessions all receive a computed roleIcon without rewriting existing agent.json files.","done":false},{"text":"Managed terminal title bars display the role icon with readable agent and role text while stable agent ids, session names, routing addresses, and provider-owned activity title data remain unchanged.","done":false},{"text":"CLI, run, census, and presence projections carry the same roleIcon; Presence v1 remains frozen and the new field is documented and tested as an additive extension.","done":false},{"text":"A linked task is sent to the owning GUI repository lead with the field contract and exact mapping, and browser acceptance proves the identical icon in both terminal title bars and GUI agent views before end-to-end completion is claimed.","done":false},{"text":"Icons are display-only, accompanied by accessible role text, never parsed for role or authority, and contain no user-controlled terminal escape data.","done":false},{"text":"Unit, real-tmux, presence-fixture, build, roadmap, installed-plugin, and user-facing browser tests pass.","done":false}]
evidence: []
commits: []
blockedBy: ["TM-164"]
blocks: []
actor: "main"
session: "01a088d4-54f3-7781-a6df-8860bd57ba9a"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
updated: "2026-09-11T18:53:55.841Z"
labels: ["ready-for-agent","plugin:agent-orchestration"]
type: "story"
touches: ["agent-orchestration/session-ui","agent-orchestration/tests","agent-orchestration/topology/PRESENCE-HEADER-ADDENDUM.md","agent-orchestration/topology/cli.mjs","agent-orchestration/topology/lib/census.mjs","agent-orchestration/topology/lib/identity.mjs","agent-orchestration/topology/lib/launch.mjs","agent-orchestration/topology/lib/presence.mjs"]
---

Give every orchestration agent a role-derived Unicode icon that is identical in terminal title bars and GUI views. One canonical display registry owns the mapping: lead 👑, orchestrator 🎼, reviewer 🔍, observer 👁️, worker 🔧, implementer 🛠️, designer 🎨, image-gen 🖼️, researcher 🔬, judge ⚖️, nested team 👥, and unknown or custom role 🤖. Icons are computed from the effective role, never stored in agent.json, and require no consumer-repository migration. Apply them to managed run panes, durable role sessions, human-readable CLI projections, run metadata, and the additive Presence roleIcon field without changing machine identifiers or authority. Preserve provider-owned pane title data used by liveness detection. Dispatch a linked task to the owning GUI repository lead; the marketplace ticket is not end-to-end complete until that consumer shows the same Unicode character in terminal title bars and GUI agent views.