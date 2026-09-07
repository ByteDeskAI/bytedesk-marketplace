---
id: "TM-125"
kind: "task"
status: "in_progress"
created: "2026-09-07T02:42:48.113Z"
board: "bytedeskai/bytedesk-marketplace"
title: "client-rebrand: plugin packaging, skill and tests"
epic: "EP-017"
acceptance: [{"text":"test-rebrand.sh passes and covers every gate refusal including the digest-drift case","done":true,"at":"2026-09-07T02:54:58.694Z"},{"text":"claude plugin validate ./client-rebrand passes with only the expected version warning","done":true,"at":"2026-09-07T02:54:58.836Z"}]
evidence: [".bytedesk/task-management/evidence/TM-125-README.md"]
commits: []
blockedBy: []
blocks: []
actor: "main"
session: "4e1d7087-d606-432e-9341-3ce779b4baf8"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
updated: "2026-09-07T02:54:59.316Z"
---

The plugin shell: versionless .claude-plugin/plugin.json per .claude/rules/version-enforcement.md, marketplace registration, skills/client-rebrand/SKILL.md for an agent driving this on an operator's behalf, README and CHANGELOG.

tests/test-rebrand.sh follows the task-management idiom: mktemp -d plus a HOME override, no network, no models. The six-stage walk runs on the generic adapter with cat as the CLI, as agent-orchestration/tests/live/nested-workflow.sh does.