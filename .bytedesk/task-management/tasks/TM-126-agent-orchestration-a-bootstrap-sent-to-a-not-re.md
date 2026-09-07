---
id: "TM-126"
kind: "task"
status: "done"
created: "2026-09-07T23:38:10.559Z"
board: "bytedeskai/bytedesk-marketplace"
title: "agent-orchestration: a bootstrap sent to a not-ready agent is lost silently"
epic: "EP-017"
acceptance: [{"text":"A bootstrap sent to an agent that was not ready is verified to have landed, and retried when it did not","done":true,"at":"2026-09-07T23:49:14.414Z"},{"text":"A pointer that cannot be delivered after the retries is reported as a failure rather than a warning","done":true,"at":"2026-09-07T23:49:14.552Z"},{"text":"The regression test covers a pane that is not listening when the send happens","done":true,"at":"2026-09-07T23:49:14.674Z"}]
evidence: [".bytedesk/task-management/evidence/TM-126-deaf-pane.mjs"]
commits: []
blockedBy: []
blocks: []
actor: "main"
session: "4e1d7087-d606-432e-9341-3ce779b4baf8"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
updated: "2026-09-07T23:49:14.967Z"
evidenceSources: {".bytedesk/task-management/evidence/TM-126-deaf-pane.mjs":{"source":"/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace/agent-orchestration/tests/fixtures/deaf-pane.mjs","sha256":"6fd25c94c36164e46a59d30663e2de8939f97c6ed6664558dd95e1b7b6048f3e","bytes":637,"at":"2026-09-07T23:49:14.783Z"}}
closed: "2026-09-07T23:49:14.962Z"
---

When readiness times out the launcher sends the bootstrap pointer anyway and warns 'bootstrap pointer was sent anyway'. That is a guess, and on a real client run it was wrong: both Claude agents reported ready=False, the pointer was typed into panes whose TUI had not yet attached a key handler, and the keystrokes went nowhere. The composers were EMPTY — not holding unsent text, which is the TM-121 signature. Nothing errored. The run sat with three healthy agents and an empty mailbox until the operator noticed.

Sequence, from run 20260907-192827-bsb7:
  agent.started challenger ready=True   (grok)
  agent.started conductor  ready=False  (claude:opus)
  agent.started strategist ready=False  (claude:opus)
Both Claude panes then showed a fresh Claude Code banner, the '3 MCP servers need authentication' warning, and an empty composer. A manual nudge to each was picked up immediately, so the panes were fine — they simply were not listening when the launcher typed.

This is the third distinct way the same thing fails. TM-121 was the write being batched into a paste; its follow-up was the composer needing to settle. This is typing before anything is listening at all. All three share one cause: the launcher sends and assumes.

The fix is to stop assuming. After sending the bootstrap, confirm it landed — the pointer text, or the agent's own acknowledgement, visible on the pane — and retry a bounded number of times if not. A send whose arrival is never checked is not a delivery, and readiness already tells us when to be suspicious.