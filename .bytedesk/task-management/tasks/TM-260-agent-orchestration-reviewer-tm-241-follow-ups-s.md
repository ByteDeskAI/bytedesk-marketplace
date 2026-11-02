---
id: "TM-260"
kind: "task"
status: "done"
created: "2026-09-27T03:00:41.449Z"
board: "bytedeskai/bytedesk-marketplace"
title: "agent-orchestration reviewer: TM-241 follow-ups — size-cap test, author-controlled binary classification, legacy hash path, manifest path quoting"
epic: "EP-028"
acceptance: [{"text":"Size-cap refusal has a test and reports real bytes","done":true,"at":"2026-10-05T15:27:37.071Z"},{"text":"A range that marks source files binary via its own .gitattributes still shows them as text diffs (test)","done":true,"at":"2026-10-05T15:27:37.515Z"},{"text":"Legacy-hash reproduction is consistent with the TM-241 patch format for binary ranges, or refuses with TOPOLOGY_REVIEWER_REREVIEW explicitly (test)","done":true,"at":"2026-10-05T15:27:37.918Z"},{"text":"Manifest paths are JSON-encoded; a newline filename cannot forge a row (test)","done":true,"at":"2026-10-05T15:27:38.349Z"}]
evidence: [".bytedesk/task-management/evidence/TM-260-1791214058780.log"]
commits: ["https://github.com/ByteDeskAI/bytedesk-marketplace/pull/210","https://github.com/ByteDeskAI/bytedesk-marketplace/pull/new/ep-028/integration-3"]
blockedBy: []
blocks: []
actor: "main"
session: "d82e2db7-2daf-4130-8dff-71d57be2583d"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["ready-for-agent"]
triagedBy: "auto"
updated: "2026-10-05T15:50:21.547Z"
touches: ["agent-orchestration/tests/unit","agent-orchestration/topology/lib/reviewer.mjs"]
evidenceSources: {".bytedesk/task-management/evidence/TM-260-1791214058780.log":{"source":null,"sha256":"f89116c5aaf1682a5829fdc58a8ae8123d5720ab74206c68a4706920ff3cb5dd","bytes":368,"at":"2026-10-05T15:27:38.780Z"}}
closed: "2026-10-05T15:27:39.212Z"
comments: [{"author":"review-sweep","ts":"2026-10-05T15:28:55.557Z","text":"review-sweep: TM-260 is done with commits and no reviewer verdict — needs an independent review or a decision."},{"author":"main","ts":"2026-10-05T15:50:21.542Z","text":"review verdict: changes requested — https://github.com/ByteDeskAI/bytedesk-marketplace/pull/210 (independent post-merge review rv-gov: all ACs met; NUL case TM-428, cache order TM-445)"}]
---

Faro minors on TM-241 at a7c5196 (approved). (1) reviewer.mjs:746 size-cap refusal branch untested; message reports UTF-16 length as bytes. (2) reviewer.mjs:760 binary classification follows the range's own .gitattributes, which the author controls; a *.mjs binary line turns source into a manifest row. Classify by content (NUL in leading bytes) or refuse/flag .gitattributes changes. (3) reviewer.mjs:751 TM-257 legacy path re-runs git diff --binary; a binary range stored in the new format never reproduces, and older binary approvals mismatch — either way re-review. (4) reviewer.mjs:803 manifest rows carry raw paths; a newline in a filename can fake a row — JSON-encode paths.