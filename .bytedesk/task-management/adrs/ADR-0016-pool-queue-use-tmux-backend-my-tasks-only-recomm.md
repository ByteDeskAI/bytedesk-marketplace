---
id: "ADR-0016"
kind: "adr"
status: "proposed"
created: "2026-09-13T21:28:54.315Z"
board: "bytedeskai/bytedesk-marketplace"
title: "Pool queue: use tmux backend, my tasks only (Recommended)"
epic: "EP-021"
decisionKey: "a2564bce5b56"
date: "2026-09-13"
updated: "2026-09-13T21:28:54.322Z"
---

## Context

Captured from an AskUserQuestion during a Claude Code session on 2026-09-13.
The question asked was: The pool is on but paused: the topology backend refuses every dispatch (filed as TM-198), and it's first in the backend order, so the pool failed three times and braked. The queue is 14 tasks, not the one I told you about — mostly EP-019 agent-orchestration bugs filed by another session, which is live in this repo right now on `feat/dispatch-duplicate-guard`. How do you want the pool to proceed?

## Decision

**The pool is on but paused: the topology backend refuses every dispatch (filed as TM-198), and it's first in the backend order, so the pool failed three times and braked. The queue is 14 tasks, not the one I told you about — mostly EP-019 agent-orchestration bugs filed by another session, which is live in this repo right now on `feat/dispatch-duplicate-guard`. How do you want the pool to proceed?** → chose **tmux backend, my tasks only (Recommended)**.

Rejected:
- **tmux backend, whole queue** — Set the backend to tmux and resume with all 14 ready. Fastest, but the pool will dispatch EP-019 tasks the other session may already be working on — which is the exact duplication TM-191 describes.
- **Leave it paused, fix TM-198 first** — The pool stays on but braked until the topology backend works. Nothing is dispatched. I take TM-198 next, and the queue drains once dispatch is reliable.

## Consequences

_TODO: what this makes easy, what it makes hard, and what would have to be true to revisit it._