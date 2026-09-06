---
id: "TM-110"
kind: "task"
status: "open"
created: "2026-09-06T04:54:46.271Z"
board: "bytedeskai/bytedesk-marketplace"
title: "agent-orchestration: a benign Claude startup banner kills the agent as a provider failure"
epic: "EP-016"
acceptance: [{"text":"A Claude agent launches and reports ready on a machine with an unauthenticated MCP server","done":false},{"text":"Generic failure patterns no longer fire on benign text containing a bare noun, or each adapter narrows its own","done":false},{"text":"A regression test covers a real provider banner rather than a fixture's canned failure line","done":false}]
evidence: []
commits: []
blockedBy: []
blocks: []
actor: "main"
session: "4e1d7087-d606-432e-9341-3ce779b4baf8"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
updated: "2026-09-06T04:54:46.280Z"
---

Launching a real Claude agent through the topology layer fails at readiness whenever the operator has any unauthenticated MCP server — common, and true on this machine.

Reproduced live. A single `cli: claude` agent returned in 5s: "ready": false, outcome "screen matched failure pattern /authentication/". The pane log shows what matched — Claude Code's ordinary startup line: '⚠ 2 MCP servers need authentication · run /mcp'.

Mechanism, verified against source rather than inferred:
- `failure_patterns` is declared ONLY on GENERIC_ADAPTER (providers.mjs:31-45). normalizeAdapter spreads it under every adapter ({...GENERIC_ADAPTER, ...raw}, providers.mjs:67) and NONE of the seven shipped provider JSONs override it. So all fifteen patterns — including bare `authentication`, `capacity`, `quota`, `billing` — apply to claude, codex and everything else. No per-adapter narrowing exists.
- The TM-091 path defence does not help: withoutPaths blanks tokens containing a slash, so the line becomes '⚠ 2 MCP servers need authentication · run' — /mcp gone, the killing word intact. Confirmed by calling the plugin's own function; /authentication/i still matches.
- tmuxFailureTrigger (launch.mjs:284) ORs the same list for the control-mode subscription, but its comment is accurate: it is only a trigger costing one capture, and failureOnScreen makes the real decision. It is the decision that fails here, not the trigger — stated so the fix is aimed correctly.

Consequence: agent.candidate_failed, pane respawned, chain walks on. It reads as a provider outage rather than a banner, and on a single-candidate spec the agent never comes up.

Two acceptable directions: give providers/claude.json and codex.json their own narrowed failure_patterns; or require failure context in the generic list (e.g. 'authentication (failed|error|required)') and review capacity, quota, billing and 'no such file or directory' the same way — an agent can print that last one in ordinary output.

Found while writing the 0.4.0 hand-test plan. Unreachable by existing tests: unit and contract drive fake adapters, the live harness runs cat.