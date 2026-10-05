---
id: "TM-261"
kind: "task"
status: "open"
created: "2026-09-27T03:39:59.972Z"
board: "bytedeskai/bytedesk-marketplace"
title: "agent-orchestration: TM-243 follow-ups — prove bare-command caller by ancestry, live harness evidence, settings.local.json ignore rule"
epic: "EP-024"
acceptance: [{"text":"bindingAgentId names a caller only when callerRunsInPane proves the caller runs in that pane (test: TMUX_PANE spoof on admit/report refused)","done":false},{"text":"A live auto-mode transcript shows a delegated lead running bare record-landing, admit and report with no prompt, and a non-delegated session refused by ao-topology","done":false},{"text":"TM-243 criterion 1 amended to the per-lead settings.local.json; the path is ignored by git and the CHANGELOG names it machine-local","done":true,"at":"2026-10-02T05:14:57.186Z"}]
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
updated: "2026-10-02T05:15:44.297Z"
touches: ["agent-orchestration/CHANGELOG.md","agent-orchestration/tests/unit","agent-orchestration/topology/lib/delegation.mjs","agent-orchestration/topology/lib/permissions.mjs"]
comments: [{"author":"main","ts":"2026-10-02T05:14:56.872Z","text":"TM-288 board review (approved by Ryan 2026-10-02): AC3 is met: .gitignore:83 ignores .claude/settings.local.json and CHANGELOG:199 names it machine-local. Ticking AC3."}]
---

Faro minors on TM-243 at 3ef2263 (approved). (1) delegation.mjs:203 bindingAgentId names a bare-command caller from the pane TMUX/TMUX_PANE name without TM-234's callerRunsInPane ancestry proof; harmless for integrate/record-landing (requireGranteeCaller proves), but admit/start-worker/stop-worker/report can be named as the lead by setting TMUX_PANE. Require callerRunsInPane in bindingAgentId. (2) permissions.mjs:37 criterion-2 test checks the module's own ruleMatches model, not Claude Code; criterion-4 live auto-mode evidence is missing — run the operator steps recorded in PR 134 and attach the transcript. (3) permissions.mjs:44 writes <lead agent dir>/.claude/settings.local.json instead of the project settings.json named in criterion 1 (sound, documented); amend the criterion and make sure the file is gitignored/flagged as machine-local state in the CHANGELOG.