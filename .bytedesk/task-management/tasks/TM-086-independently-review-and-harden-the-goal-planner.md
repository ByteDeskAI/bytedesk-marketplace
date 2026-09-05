---
id: "TM-086"
kind: "task"
status: "open"
created: "2026-09-02T18:13:18.034Z"
board: "bytedeskai/bytedesk-marketplace"
title: "Independently review and harden the goal planner"
epic: "EP-013"
acceptance: [{"text":"Codex produces an evidence-backed review covering backend, frontend, uploads, tool authorization, atomicity, accessibility, and tests.","done":false},{"text":"All high-severity findings are fixed or explicitly rejected with evidence, then re-reviewed.","done":false},{"text":"The complete task-management verification and packaging suite passes in the integration worktree.","done":false}]
evidence: []
commits: ["38194d4","6a82df8","e5b9091","2f8d30f","edcc827","5eae4f0","716d6f4","5c140bf","fec622a","20924e8"]
blockedBy: ["TM-085"]
blocks: []
actor: "main"
session: "01a062eb-2024-7368-bdb3-ad3fcf853ad4"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
updated: "2026-09-05T14:51:08.439Z"
labels: ["ready-for-agent"]
touches: ["task-management/**"]
comments: [{"author":"main","ts":"2026-09-05T14:51:08.433Z","text":"Three review rounds. Round one: Codex CLI plus a fresh independent agent, four HIGH agreed between them. Round two: both re-reviewed the fixed tree and found seventeen more between them, including two they independently found the same way — check() spending the operator's one-shot override, and task.create resolving its destination at apply time. Round three is under way with the fresh agent; Codex is unavailable (its account hit a usage limit until 2026-09-12), which is recorded here rather than worked around.\n\n24 findings fixed across the two rounds, every one reproduced before it was written and pinned by a test that fails against the old behaviour. The ones that mattered most:\n\n- previewOps was not read-only. check() called gateTaskCreate, which SPENDS the override at each refusal point, so previewing wrote board state and logged override_used from the read-only planner profile — and the page re-proposes on load, so a refresh burnt the token. It also broke the proposal it was previewing: the apply re-checked, found nothing, and refused or rolled back a set the card had called validated.\n- A landing killed rather than thrown out of stayed half applied for ever. 'All of it or none of it' was true only for failures that throw. Verified by SIGKILLing a real landing mid-transaction: one epic, one task and a moved active epic left behind; after the journal and recovery, all three undone.\n- Any other page on localhost could write to the board. Every port counted as this origin and a request with no Origin skipped the check entirely, which is what a simple text/plain form post sends.\n- A closeSession failure refunded a spent approval, and a rollback that could not finish did the same thing through a different door.\n\nFull list in the CHANGELOG under Unreleased/Fixed, each entry naming what was wrong rather than what was changed."}]
---

Have a read-only Codex GPT-5.6 Sol agent review the Fable implementation for security, task-store invariants, orchestration isolation, accessibility, UX fidelity, tests, and packaging. Remediate findings with Fable and repeat review until no unresolved high-severity issues remain.
