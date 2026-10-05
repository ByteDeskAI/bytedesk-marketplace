---
id: "TM-280"
kind: "task"
status: "done"
created: "2026-10-02T02:20:50.635Z"
board: "bytedeskai/bytedesk-marketplace"
title: "agent-orchestration: re-spawning a live agent collects a handoff and replaces the session (ADR-0030 part 4)"
epic: "EP-023"
acceptance: [{"text":"a re-spawn of a busy agent waits for its turn to end and never interrupts mid-turn (tested with a fake pane that ends its turn later)","done":true,"at":"2026-10-02T13:10:39.258Z"},{"text":"the old session writes a handoff that is returned to the requesting lead, and the new session receives it only when the lead passes it","done":true,"at":"2026-10-02T13:10:39.621Z"},{"text":"when the old agent does not answer in time, the flow proceeds with a transcript summary labelled as such, and the old session is still ended exactly once","done":true,"at":"2026-10-02T13:10:40.010Z"}]
evidence: [".bytedesk/task-management/evidence/TM-006-closure-audit-2026-10-02.md"]
commits: ["ADR-0030"]
blockedBy: ["TM-274"]
blocks: []
actor: "main"
session: "62549d39-62d5-458d-808e-8375ef53518d"
branch: "fix/ao-local-nats-autostart"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["ready-for-agent"]
triagedBy: "auto"
updated: "2026-10-02T13:10:41.071Z"
comments: [{"author":"main","ts":"2026-10-02T03:57:50.156Z","text":"Shipped locally at 4472a744 (0.14.0) with TM-279279; PR opened. Suite 911/907/0/4."},{"author":"main","ts":"2026-10-02T03:58:03.329Z","text":"Correction to previous comment: shipped together with TM-279 as 0.14.0 (4472a744), PR #148."},{"author":"@dc778cb2","ts":"2026-10-02T13:10:40.721Z","text":"Closed by Bastion TM-006 (lead dc778cb2): PR merged into fix/ao-local-nats-autostart (head 35488ce2, not yet main). Each criterion verified against merged code and recorded evidence; see .bytedesk/task-management/evidence/TM-006-closure-audit-2026-10-02.md."}]
evidenceSources: {".bytedesk/task-management/evidence/TM-006-closure-audit-2026-10-02.md":{"source":"/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace/.bytedesk/task-management/evidence/TM-006-closure-audit-2026-10-02.md","sha256":"1ff3962db490e740ae7b2844b8938497b7ea480dc6fdab98c647a1adde72ef5b","bytes":5647,"at":"2026-10-02T13:10:40.390Z"}}
closed: "2026-10-02T13:10:41.065Z"
---

Replaces TM-274's refusal for a second spawn of a live agent. Flow: wait (bounded) for the live session's current turn to end; ask it to write a handoff in the tm handoff shape (goal, state, open questions, files); end the old session; start a fresh session under the same name; return the handoff to the requesting lead/conductor, which decides whether to pass it to the new session. If the agent does not answer within the bound, fall back to a transcript-derived summary and say so.