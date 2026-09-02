---
id: "TM-076"
kind: "task"
status: "done"
created: "2026-09-02T11:49:49.176Z"
board: "bytedeskai/bytedesk-marketplace"
title: "Core: lib/completeness.mjs, config keys, gate extensions in enforce.mjs"
epic: "EP-011"
acceptance: [{"text":"missingFields returns {field, hint} per field with exact remedy commands","done":true,"at":"2026-09-02T12:40:40.437Z"},{"text":"gateTaskCreate/gateStart/gateDone enforce the contract incl. mirror exemption, TM_ENFORCE=off and override bypass","done":true,"at":"2026-09-02T12:40:40.545Z"},{"text":"completeness.test.mjs + enforce-fields.test.mjs pass (32 tests)","done":true,"at":"2026-09-02T12:40:40.653Z"}]
evidence: [".bytedesk/task-management/evidence/TM-076-tm-076-080-suite.log"]
commits: []
blockedBy: []
blocks: []
actor: "main"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
updated: "2026-09-02T12:40:53.707Z"
closed: "2026-09-02T12:40:53.703Z"
---

Core of the completeness-gate feature: lib/completeness.mjs (missingFields → per-field {field, hint} with remedy commands), three flat DEFAULT_CONFIG keys (requireOnCreate/requireOnStart/requireOnDone, on by default), and the enforce.mjs extensions: gateTaskCreate(p, draft) refuses sparse explicit creates and skips the check for draft=null (mirror exemption); gateStart refuses incomplete tasks; gateDone adds body / ≥1-AC-present / evidence / actor checks, closing the zero-AC hole.