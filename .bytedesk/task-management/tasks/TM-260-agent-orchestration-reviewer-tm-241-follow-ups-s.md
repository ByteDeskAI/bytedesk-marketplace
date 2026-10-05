---
id: "TM-260"
kind: "task"
status: "open"
created: "2026-09-27T03:00:41.449Z"
board: "bytedeskai/bytedesk-marketplace"
title: "agent-orchestration reviewer: TM-241 follow-ups — size-cap test, author-controlled binary classification, legacy hash path, manifest path quoting"
epic: "EP-024"
acceptance: [{"text":"Size-cap refusal has a test and reports real bytes","done":false},{"text":"A range that marks source files binary via its own .gitattributes still shows them as text diffs (test)","done":false},{"text":"Legacy-hash reproduction is consistent with the TM-241 patch format for binary ranges, or refuses with TOPOLOGY_REVIEWER_REREVIEW explicitly (test)","done":false},{"text":"Manifest paths are JSON-encoded; a newline filename cannot forge a row (test)","done":false}]
evidence: []
commits: []
blockedBy: []
blocks: []
actor: "main"
session: "b41d685d-7094-4957-80a5-950b76fb0467"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["ready-for-agent"]
triagedBy: "auto"
updated: "2026-10-02T05:15:43.919Z"
touches: ["agent-orchestration/tests/unit","agent-orchestration/topology/lib/reviewer.mjs"]
---

Faro minors on TM-241 at a7c5196 (approved). (1) reviewer.mjs:746 size-cap refusal branch untested; message reports UTF-16 length as bytes. (2) reviewer.mjs:760 binary classification follows the range's own .gitattributes, which the author controls; a *.mjs binary line turns source into a manifest row. Classify by content (NUL in leading bytes) or refuse/flag .gitattributes changes. (3) reviewer.mjs:751 TM-257 legacy path re-runs git diff --binary; a binary range stored in the new format never reproduces, and older binary approvals mismatch — either way re-review. (4) reviewer.mjs:803 manifest rows carry raw paths; a newline in a filename can fake a row — JSON-encode paths.