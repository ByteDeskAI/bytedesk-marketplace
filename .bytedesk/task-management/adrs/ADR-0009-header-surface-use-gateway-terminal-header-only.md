---
id: "ADR-0009"
kind: "adr"
status: "proposed"
created: "2026-09-09T21:13:20.454Z"
board: "bytedeskai/bytedesk-marketplace"
title: "Header surface: use Gateway terminal header only"
epic: "EP-018"
decisionKey: "3676fa8e352b"
date: "2026-09-09"
updated: "2026-09-09T21:13:20.461Z"
---

## Context

Captured from an AskUserQuestion during a Claude Code session on 2026-09-09.
The question asked was: For "assign team lead and worker so a visual queue is shown in the terminal header" — which header? The two surfaces live in different repos and only one is in this plan's scope.

## Decision

**For "assign team lead and worker so a visual queue is shown in the terminal header" — which header? The two surfaces live in different repos and only one is in this plan's scope.** → chose **Gateway terminal header only**.

Rejected:
- **Both, presence-driven (Recommended)** — agent-orchestration writes role + state + slot queue position into the tmux pane title AND into the frozen Presence v1 snapshot the gateway already consumes. Works in bare tmux today; the gateway's orchestration-terminals plugin renders the rich header from the same source. No duplicated truth.
- **tmux pane title / status line only** — agent-orchestration sets a structured pane title and tmux status-left. Visible in any terminal, no gateway dependency, no cross-repo work. But it's plain text in a status bar, not a real UI.

**"Assign" team lead and worker — how much assignment machinery? TM-127 already ships `lead status|ensure|assign|detach` and a `reviewer` with an at-most-one-per-repo rule, keyed on the git common directory.** → chose **Add a full role-assignment CLI**.

Rejected:
- **Reuse TM-127, add worker roles (Recommended)** — Keep `lead assign` / `reviewer ensure` as-is; add explicit worker enrolment so every pane has a declared repoRole, and surface it. Smallest diff, and the presence contract already carries repoRole lead|reviewer|member.
- **Interactive picker** — A `/agent-orchestration:roles` skill that lists live panes and lets you assign roles conversationally, on top of whichever CLI exists.

**What should the "visual queue" in the header actually show?** → chose **Serial slot queue, Unread mailbox depth, Agent state, Current task**.

Rejected:
- **Serial slot queue** — Who holds each named slot (integration, cutover, deploy-safe) and each waiter's position — the thing the conductor tracked by hand.
- **Unread mailbox depth** — Undelivered/unacknowledged message count per agent. `queueDepth`/`observeQueueDepth` already compute this; nothing surfaces it.
- **Agent state** — working / idle / needs-input / quota-blocked / dead, from the liveness census.
- **Current task** — The TM-nnn the pane is claimed to, from the task store.

## Consequences

_TODO: what this makes easy, what it makes hard, and what would have to be true to revisit it._