---
id: "TM-075"
kind: "task"
status: "done"
created: "2026-09-02T10:06:30.766Z"
board: "bytedeskai/bytedesk-marketplace"
title: "Write docs/use-cases.md — 20 fully-detailed plugin use cases in one consistent format"
epic: "EP-010"
acceptance: [{"text":"docs/use-cases.md exists with exactly 20 use cases, all in the identical five-section format (Scenario / When to use / Usage / Natural language prompts / Expected outcome)","done":true,"at":"2026-09-02T11:57:17.516Z"},{"text":"every command, MCP tool and HTTP route named in the doc exists in the current code (spot-check against tm help and lib/)","done":true,"at":"2026-09-02T11:57:17.524Z"},{"text":"agent-first surfaces are covered: caps, dispatch + all four backends, pool, agent registry/reap, collect, events/webhooks","done":true,"at":"2026-09-02T11:57:17.533Z"},{"text":"README.md links the new doc from its docs list","done":true,"at":"2026-09-02T11:57:17.541Z"}]
evidence: [".bytedesk/task-management/evidence/TM-075-1788350237506.log"]
commits: []
blockedBy: []
blocks: []
actor: "main"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
updated: "2026-09-02T11:57:20.605Z"
session: "01a06199-2a58-7962-bb20-0d244201385f"
closed: "2026-09-02T11:57:20.602Z"
---

Create `task-management/docs/use-cases.md`: 20 use cases for the task-management plugin, every one in the SAME structure so the doc reads as a catalog, not a grab-bag.

Per-use-case format (identical sections, identical order, for all 20):

  ## <NN>. <Use-case name>
  **Scenario** — the situation and who is in it (agent-first framing: the agent executes, the human views/plans/decides).
  **When to use** — the trigger or smell that says this use case applies.
  **Usage** — the concrete commands/tools/routes: `.bytedesk/task-management/bin/tm ...` CLI lines, MCP tool calls (tm_*), and/or HTTP routes, with realistic arguments.
  **Natural language prompts** — 2-3 quoted examples of what a user would actually say to their coding agent to get this outcome ("...").
  **Expected outcome** — what the board/store/worker looks like afterwards; what proves it worked.

Coverage guidance (span the whole surface, roughly half classic board work, half agent-first):
- classic: capturing work from a goal doc, epics/stories/subtasks, dependencies and `tm why`, claims/parallel sessions, worktrees, sprints/backlog ranking, standup/handoff, decision-map and enhance gates, acceptance criteria + evidence, ntfy notifications
- agent-first (shipped this cycle): `tm caps` host detection, `tm dispatch` (backends orchestration → fleet → tmux → manual), the `ready-for-agent` pool loop, agent registry + heartbeats + `tm agent reap`, `tm collect` result protocol, `tm events --json/--follow` + webhooks, multi-harness operation (Claude Code / Codex / Grok / Kimi), cross-repo store sharing via TM_ROOT

Ground every command in reality: read README.md, `tm help`, lib/ and docs/ first — no invented flags. Match the README's voice (terse, declarative, no marketing).

Do not commit; leave the file in the working tree for review.
