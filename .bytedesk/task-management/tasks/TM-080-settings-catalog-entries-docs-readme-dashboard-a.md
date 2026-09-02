---
id: "TM-080"
kind: "task"
status: "done"
created: "2026-09-02T11:49:49.643Z"
board: "bytedeskai/bytedesk-marketplace"
title: "Settings catalog entries, docs (README/dashboard-api/CHANGELOG/AGENTS/skills), close-out"
epic: "EP-011"
acceptance: [{"text":"three catalog entries round-trip via applySettings; docs all describe the landed contract","done":true,"at":"2026-09-02T12:40:43.182Z"},{"text":"close-out: run-tests.sh all green + claude plugin validate passes + smoke verified","done":true,"at":"2026-09-02T12:40:54.263Z"}]
evidence: [".bytedesk/task-management/evidence/TM-080-tm-076-080-suite.log"]
commits: []
blockedBy: []
blocks: []
actor: "main"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
updated: "2026-09-02T12:40:54.404Z"
closed: "2026-09-02T12:40:54.400Z"
---

Settings catalog gains requireOnCreate/requireOnStart/requireOnDone (policy group, json type, settable via tm config / POST /api/settings / dashboard). Docs: README quick-start + CLI reference + new completeness-gates block + config table; dashboard-api.md §7; CHANGELOG Unreleased Added; AGENTS.md escape-hatches section; epic/map/tickets skills updated to the --body/--ac incantation. Close-out: full suite green, plugin validate, smoke, board, commit.