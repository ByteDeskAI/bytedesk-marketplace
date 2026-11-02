---
id: "TM-491"
kind: "task"
status: "done"
created: "2026-10-09T00:09:11.767Z"
board: "bytedeskai/bytedesk-marketplace"
title: "agent-orchestration: tests/unit/mcp-contract.test.mjs never exits after its last test, hanging the required unit check"
epic: "EP-028"
acceptance: [{"text":"mcp-contract.test.mjs exits on its own within 60 s after its last test","done":true,"at":"2026-10-09T03:04:29.197Z"},{"text":"The open handle is closed by the code or fixture that opened it, not by a forced process exit in the test","done":true,"at":"2026-10-09T03:04:29.572Z"}]
evidence: [".bytedesk/task-management/evidence/TM-491-1791515069987.log"]
commits: ["https://github.com/ByteDeskAI/bytedesk-marketplace/pull/239","https://github.com/ByteDeskAI/bytedesk-marketplace/pull/242"]
blockedBy: []
blocks: []
actor: "main"
session: "d82e2db7-2daf-4130-8dff-71d57be2583d"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
filedBy: {"board":"bytedeskai/bytedesk-marketplace","agent":"a33a204b","task":"TM-485"}
labels: ["decision:intake","needs-triage"]
triagedBy: "auto"
triageMissing: ["label decision:intake"]
updated: "2026-10-09T03:12:41.212Z"
priority: "high"
comments: [{"author":"main","ts":"2026-10-09T01:22:53.382Z","text":"Root cause of the governed check hang (lead fd2b831f, 2026-10-08): .bytedesk/agent-orchestration/config.json management.required_checks 'agent-orchestration: unit' runs bare 'env -u TMUX node --test --test-concurrency=1 tests/unit/*.test.mjs' — no harness --import helpers (tmux-preflight, register-file-transport), the form known to hang. GitHub CI runs 'npm run test:unit' (with helpers) and passes. Fix the check argv to 'cd agent-orchestration && env -u TMUX -u TMUX_PANE -u AO_SESSION_AGENT_ID -u AO_SESSION_CONSUMER npm run -s test:unit' on main (TM-442 reads required_checks from the server default branch). Separately fix mcp-contract.test.mjs's open handle. Owned by the EP-028 lead."},{"author":"review-sweep","ts":"2026-10-09T03:06:14.083Z","text":"review-sweep: TM-491 is done with commits and no reviewer verdict — needs an independent review or a decision."},{"author":"main","ts":"2026-10-09T03:07:10.079Z","text":"review verdict: approved — independent reviewer rv-230 (subagent, not the author) approved PR #239 at 6672687a; its R1 finding was fixed in 73097a1c before merge 09fdd6ee. https://github.com/ByteDeskAI/bytedesk-marketplace/pull/239. The verdict was delivered to the lead session, not posted on the PR."}]
evidenceSources: {".bytedesk/task-management/evidence/TM-491-1791515069987.log":{"source":null,"sha256":"18077bf44278609b3c371ce242dd6abe2e58c684e15c7196c023bb7f132d39ec","bytes":261,"at":"2026-10-09T03:04:29.989Z"}}
closed: "2026-10-09T03:04:30.394Z"
---

Found while running TM-485's required checks. 'node --test --test-concurrency=1 tests/unit/mcp-contract.test.mjs' (with env -u TMUX) prints 'ok' for all 5 tests, the last being 'TM-352: orchestration_mailbox_wait returns a standing reply and refuses an unknown id' (line 181), and then never exits; timeout 240 kills it with 124. This reproduces at 44b030d4 (origin/main merge of PR #221) in a clean detached worktree with no local changes, so it predates TM-485. Effect: the required check 'agent-orchestration: unit' (tests/unit/*.test.mjs) cannot finish, so no finish report can list a passing run. Likely cause: an open handle left by the TM-352 test (sendStandingMessage/recordStandingReply or the MCP client fixture), such as a timer, watcher or NATS connection that fx.cleanup does not close.