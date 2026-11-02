---
id: "ADR-0033"
kind: "adr"
status: "proposed"
created: "2026-10-03T01:55:50.675Z"
board: "bytedeskai/bytedesk-marketplace"
title: "Location: use Session scratchpad (Recommended)"
epic: "EP-021"
decisionKey: "9785d6945165"
date: "2026-10-03"
updated: "2026-10-03T01:55:50.682Z"
---

## Context

Captured from an AskUserQuestion during a Claude Code session on 2026-10-03.
The question asked was: Where should the two scratch repos live?

## Decision

**Where should the two scratch repos live?** → chose **Session scratchpad (Recommended)**.

Rejected:
- **~/Documents/GitHub/ByteDeskAI/ao-scratch-{a,b}** — Persistent sibling repos you can reopen and keep experimenting in across sessions.

**Which experiment should the first iteration prove?** → chose **1, 2 and 3**.

Rejected:
- **Cross-repo handoff with closure contract (Recommended)** — Repo A's agent hands work to repo B over NATS. The item cannot close without a reason and target, is deduplicated by message id, and B's reply lands back in A. Borrowed from OpenRig's hot-potato rule.
- **Event stream + KV watch** — Publish lifecycle events to a JetStream stream and replace polling with KV watch for presence, claims and state.
- **Work queue on the unused tasks stream** — Drive ORCH_TASKS so idle agents pull ready work, with claims compare-and-set in KV.

## Consequences

_TODO: what this makes easy, what it makes hard, and what would have to be true to revisit it._