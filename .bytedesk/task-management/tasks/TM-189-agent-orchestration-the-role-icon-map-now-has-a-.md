---
id: "TM-189"
kind: "task"
status: "open"
created: "2026-09-12T02:51:22.202Z"
board: "bytedeskai/bytedesk-marketplace"
title: "agent-orchestration: the role-icon map now has a downstream copy that can drift"
epic: "EP-019"
acceptance: [{"text":"PRESENCE-ROLE-ICON-ADDENDUM.md records the ASCII role-token transport as an accepted consumer pattern, with the gateway's countersignature and its two deviations referenced; the recorded addendum hash is updated","done":false},{"text":"A check fails when the registry changes without the downstream copy being refreshed: either our fixture test records the consumer copy's expected hash, or the request document names the notification step and the gateway test compares against a published hash","done":false},{"text":"The decision on which side owns the mapping table long term is recorded (single published artifact versus per-consumer copies)","done":false}]
evidence: []
commits: []
blockedBy: []
blocks: []
actor: "main"
session: "8e87dbc7-3321-4e05-8648-b64d7c6319bb"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["ready-for-agent","plugin:agent-orchestration"]
triagedBy: "auto"
updated: "2026-09-12T03:14:15.818Z"
comments: [{"author":"main","ts":"2026-09-12T03:14:15.813Z","text":"Gateway input 2026-09-12: they would prefer to consume a published artifact rather than keep a copy. Today they pin their own two copies to each other with src/role_icon_map_sync_test.go (present in their working tree, not on develop); that catches their copies diverging from each other but not our registry changing underneath them. So the honest floor is a drift check on our side plus their sync test, and the real fix is publishing the map as one artifact they consume. Verified 2026-09-12: their copy and ours are both sha256 cf40e82fd810a9639c678cfc844882bf1c10408da3064dbf05e69070944ecc1a."}]
---

From the gateway countersignature (2026-09-12, their TM-312). Their SDK validates badge.icon as ^[a-z0-9-]{1,64}$ (bytedesk-sdk-dependencies/plugin/terminal_presentation.go:103), so the emoji cannot travel in that field as request section 4.4 assumed. The plugin sends an ASCII role token (role-lead, role-implementer, role-unknown) and their SPA maps it to the character using a byte-identical copy of topology/fixtures/presence-role-icon/role-icon-map.json at plugins/orchestration-terminals/presence/role-icon-map.json. Verified 2026-09-12: both files are sha256 cf40e82fd810a9639c678cfc844882bf1c10408da3064dbf05e69070944ecc1a. Nothing tells either side when the other changes, so a future registry edit here silently diverges from what the gateway renders, and the signed addendum still describes only the character-in-field transport.