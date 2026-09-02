---
id: "TM-079"
kind: "task"
status: "done"
created: "2026-09-02T11:49:49.525Z"
board: "bytedeskai/bytedesk-marketplace"
title: "Doctor: incomplete-done and incomplete-open report-only findings"
epic: "EP-011"
acceptance: [{"text":"incomplete-done and incomplete-open fire with id, status, missing fields, remedy hints; complete tasks yield neither","done":true,"at":"2026-09-02T12:40:42.660Z"},{"text":"warnings are unfixable and never flip the exit code; doctor.test.mjs 65 pass","done":true,"at":"2026-09-02T12:40:42.764Z"}]
evidence: [".bytedesk/task-management/evidence/TM-079-tm-076-080-suite.log"]
commits: []
blockedBy: []
blocks: []
actor: "main"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
updated: "2026-09-02T12:40:54.118Z"
closed: "2026-09-02T12:40:54.114Z"
---

Doctor diagnose() gains report-only WARNING findings incomplete-done (done tasks missing requireOnDone fields — the audit net for harness-mirror closes, which bypass gateDone by design) and incomplete-open (open/in_progress tasks missing requireOnStart fields; blocked/parked exempt). No autofix; warnings never flip doctor's exit code.