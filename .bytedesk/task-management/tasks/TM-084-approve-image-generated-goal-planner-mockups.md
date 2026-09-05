---
id: "TM-084"
kind: "task"
status: "in_progress"
created: "2026-09-02T18:13:17.872Z"
board: "bytedeskai/bytedesk-marketplace"
title: "Approve image-generated goal-planner mockups"
epic: "EP-013"
acceptance: [{"text":"Canonical task-management product/design authority explicitly permits bounded goal-planning chat while rejecting general chat.","done":false},{"text":"Image-generated design probes and their prompts/metadata are stored under bytedesk/designer/mockups/.","done":false},{"text":"Mockups cover 390, 1024, and 1440 widths, light/dark themes, and all loading/error/approval/success states.","done":false},{"text":"The operator approves one direction before production UI implementation begins.","done":false},{"text":"Mockups include live ACP planner-agent selection, capability/health states, and AG-UI tool/approval streaming.","done":false}]
evidence: []
commits: ["900a13c","f234754","ac1d130","ed282e6","408bb98","23d2825","94466fe","eefd7ae","85b7619","dbc3508","e0ec159","2d67bc2","4482125"]
blockedBy: ["TM-083"]
blocks: ["TM-085"]
actor: "main"
session: "01a062eb-2024-7368-bdb3-ad3fcf853ad4"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
updated: "2026-09-05T10:19:56.592Z"
labels: ["ready-for-agent"]
touches: ["bytedesk/designer/mockups/**","design-system/profiles/task-management/**"]
---

Use a separate Codex GPT-5.6 Sol design role to derive a bounded goal-planning chat from the canonical design profile. Produce image probes and code-native responsive mockups before production UI work, storing every artifact under bytedesk/designer/mockups/.
