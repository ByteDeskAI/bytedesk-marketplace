---
id: "TM-098"
kind: "task"
status: "done"
created: "2026-09-05T04:02:08.688Z"
board: "bytedeskai/bytedesk-marketplace"
title: "Convert the tm dispatch fleet backend to ao"
epic: "EP-014"
acceptance: [{"text":"Dispatching a task through the former fleet path works end to end against ao","done":true,"at":"2026-09-05T07:45:12.640Z"},{"text":"Whatever fleet provided and the chosen layer lacks is either replaced or explicitly dropped with the reason recorded","done":true,"at":"2026-09-05T07:45:12.757Z"},{"text":"Worktree ownership follows the ADR rather than producing a second worktree per task","done":true,"at":"2026-09-05T07:45:12.872Z"},{"text":"The fleet backend and its host-capability gate are removed from the backend list","done":true,"at":"2026-09-05T07:45:12.980Z"}]
evidence: [".bytedesk/task-management/evidence/TM-098-topology.mjs"]
commits: ["85b7619","2c979b7"]
blockedBy: ["TM-088"]
blocks: []
actor: "main"
session: "a7da6c38-57d4-464b-b856-ebdb3dd72e1b"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
updated: "2026-09-05T07:45:31.198Z"
comments: [{"author":"main","ts":"2026-09-05T07:45:12.522Z","text":"All four AC met. A new topology backend launches ao-topology with --consumer <tm worktree> and creates no checkout of its own — one worktree per task, so the ADR's ownership rule is realised rather than restated. The prompt never becomes an argv element: it travels as the instructions string inside a JSON spec file plus a durable human copy at .tm-dispatch-prompt.md. A dispatched worker takes its identity from the repo's agent roster when one exists (read as JSON off disk, no cross-plugin import) and falls back to an inline single-agent spec otherwise. fleet is gone from the module registry, DEFAULT_ORDER, the collector, the host-capability probe and every doc and skill that named it; a regression test asserts it is neither in the order nor loadable. Order is now topology -> tmux -> orchestration -> manual, with manual as the floor that can never disappear. Both live defects the ADR uncovered are fixed and each was proved real first by reverting the fix and watching the new test fail. Verified independently: 1260 task-management unit tests pass, 0 fail."}]
closed: "2026-09-05T07:45:13.227Z"
---

fleet is retired as a plugin but its tm dispatch backend converts to ao rather than being deleted, so dispatches keep working and the dependency goes. This is not a swap: fleet gave tm dispatch worktree isolation, a visible tmux session per ticket, JSONL transcript observation and depth-based authorization together, and neither ao layer has that set - the MCP layer loses the visible session, topology loses the worktree and sandbox. The target layer comes from the ADR. The raw tmux backend is also a candidate for collapsing into ao, since topology does the same job better. Watch the worktree duplication: ao's MCP layer derives its own detached worktree under tm's provisioned one, the same shape fleet had, so the waste moves rather than resolving unless ownership is settled.