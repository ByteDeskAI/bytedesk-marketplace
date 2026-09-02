---
id: "TM-077"
kind: "task"
status: "done"
created: "2026-09-02T11:49:49.294Z"
board: "bytedeskai/bytedesk-marketplace"
title: "CLI surface: task new --body/--ac flags, cap accept routed through gateTaskCreate"
epic: "EP-011"
acceptance: [{"text":"task new --body/--ac parsed and stored; sparse create refused exit 2 naming the flags","done":true,"at":"2026-09-02T12:40:41.187Z"},{"text":"cap accept gated: card without criteria refused with remedy, card with criteria passes, requireEpic now applies","done":true,"at":"2026-09-02T12:40:41.295Z"},{"text":"test-store.sh 116 pass + test-capability.sh 22 pass","done":true,"at":"2026-09-02T12:40:41.417Z"}]
evidence: [".bytedesk/task-management/evidence/TM-077-tm-076-080-suite.log"]
commits: []
blockedBy: []
blocks: []
actor: "main"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
updated: "2026-09-02T12:40:53.842Z"
closed: "2026-09-02T12:40:53.838Z"
---

CLI: task new gains --body <text|-> (stdin on '-', like edit) and repeatable --ac; draft passed to gateTaskCreate before create; cap accept routed through gateTaskCreate with the card-derived draft, refusal names the missing - [ ] criteria remedy. help text updated.