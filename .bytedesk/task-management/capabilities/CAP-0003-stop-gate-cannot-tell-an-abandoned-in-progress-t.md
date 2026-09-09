---
id: "CAP-0003"
kind: "capability"
status: "open"
created: "2026-09-09T21:55:30.120Z"
board: "bytedeskai/bytedesk-marketplace"
title: "Stop gate cannot tell an abandoned in_progress task from one a live delegated worker owns"
area: "product"
impact: "M"
effort: "M"
confidence: "M"
source: "research"
evidence: []
related: []
updated: "2026-09-09T21:55:30.127Z"
---

Observed repeatedly this session. A lead session running a fan-out has N tasks legitimately in_progress, each owned by a live teammate in its own worktree. done and block are both false, and park would misreport active work as paused — so the only honest action is to arm 'tm override' every turn, which trains the reflex the gate exists to prevent and wears out a mechanism meant for exceptions. The gate is right that an in_progress task with nobody on it is a lie the next session inherits; it just has no way to see the difference. Note this is adjacent to CAP-0002: both come from the store having no reliable notion of WHO is on a task right now. Possible shapes, cheapest first: (a) treat a task whose claim names a live session or agent as attributed, and exempt it from the stop sweep the way a dispatched task already is; (b) let a task record a delegated owner explicitly ('tm delegate <id> <agent>') so the gate can check liveness against the agent registry, which already tracks alive/dead; (c) have the gate report rather than block when every in_progress task has a live owner. Whatever the shape, the goal is that a lead running a fan-out never has to reach for override, and an genuinely abandoned task still gets caught.