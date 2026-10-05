---
id: "TM-252"
kind: "task"
status: "open"
created: "2026-09-25T18:03:22.435Z"
board: "bytedeskai/bytedesk-marketplace"
title: "agent-orchestration: the lead prompt forbids settings edits, wrapper scripts and routing refused actions to a peer"
epic: "EP-024"
acceptance: [{"text":"The common lead protocol states: never edit permission settings or CLAUDE.md, never write a wrapper script to get past a refusal, never ask a peer to perform an action this session was refused; report the refusal to the operator instead.","done":false},{"text":"A prompt test asserts the three rules are present in every generated lead prompt.","done":false}]
evidence: []
commits: []
blockedBy: []
blocks: []
actor: "main"
session: "40645e47-066b-4937-abc2-55d42e9ea247"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["ready-for-agent","plugin:agent-orchestration"]
triagedBy: "auto"
updated: "2026-10-02T05:15:42.449Z"
---

Plan from gateway lead d60f0608, 2026-09-25, reported as approved by Ryan in that session ('Approve as written') with the operating model: 'All I should be involved in is the planning and approving plans. team leads should drive the completion and approvals after planning until it is released and cleaned up.' This changes ADR-0001 (merge is PR-level; branch delete is repo-destructive and deploy is external, both always human) and the 'humans merge' rule, so it is held for Ryan's confirmation in the marketplace lead's session and a recorded decision. Part (d). Safe on its own: it only narrows what a lead may do.