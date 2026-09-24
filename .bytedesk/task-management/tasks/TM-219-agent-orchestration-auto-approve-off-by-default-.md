---
id: "TM-219"
kind: "task"
status: "open"
created: "2026-09-24T19:43:24.581Z"
board: "bytedeskai/bytedesk-marketplace"
title: "agent-orchestration: auto_approve off by default, switchable live by lead or operator"
epic: "EP-021"
acceptance: [{"text":"Absent auto_approve launches with prompts on (default false); explicit true starts in bypass; tests","done":false},{"text":"Claude agents launch with --allow-dangerously-skip-permissions so bypass is available but inactive; reviewer argv unchanged","done":false},{"text":"A live switch changes a running non-reviewer agent's mode, verifies it from the pane, and persists it; refuses reviewers; unit tests with a fake pane","done":false},{"text":"Docs and CHANGELOG updated; unit suite, build:check and plugin validate pass","done":false}]
evidence: []
commits: []
blockedBy: ["TM-215","TM-218"]
blocks: []
actor: "main"
session: "1b07de2e-6b73-47c6-ad14-aa29eeea67fd"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["ready-for-agent"]
triagedBy: "auto"
updated: "2026-09-24T22:21:54.472Z"
---

Operator decision 2026-09-24, superseding TM-214's default: auto_approve is an option that is FALSE by default and can be flipped in real time by the lead or the operator on a running agent.

Mechanism (claude): launch non-reviewer agents with --allow-dangerously-skip-permissions (verified in claude --help: "Enable bypassing all permission checks as an option, without it being enabled by default") plus the stored mode via --permission-mode. A live switch cycles the session's mode (Shift+Tab / BTab), confirms it by reading the pane's mode indicator, then records the new value in agent.json. The operator can also switch in the pane directly. Add a lead-callable verb, e.g. `ao-topology agent mode <id> bypass|default|auto` (name open).

The reviewer never gets the allow flag, and the switch refuses role reviewer (TM-150 and TM-214 guards). Other providers: document each provider's live equivalent or refuse with a clear error; no silent downgrade. Keep TM-214's removal of the --allow-auto-approve launch refusal.
