---
id: "ADR-0038"
kind: "adr"
status: "proposed"
created: "2026-10-04T05:11:29.617Z"
board: "bytedeskai/bytedesk-marketplace"
title: "Release scope: use Everything, EP-026 and EP-025"
epic: "EP-026"
decisionKey: "99edb8709208"
date: "2026-10-04"
updated: "2026-10-04T05:11:29.625Z"
---

## Context

Captured from an AskUserQuestion during a Claude Code session on 2026-10-04.
The question asked was: Which work must be finished before the agent-orchestration release ships?

## Decision

**Which work must be finished before the agent-orchestration release ships?** → chose **Everything, EP-026 and EP-025**.

Rejected:
- **Hardening and services only (Recommended)** — All open EP-019, EP-021, EP-023 and EP-024 tasks. EP-026 (per-agent NATS credentials, NATS-native task storage, gateway grants) and EP-025 (gateway console) move to the next release.
- **Everything, including EP-026** — Adds the NATS-native epic (19 tasks, 0 done). It needs gateway work (TM-313) and a decision on the per-agent credential scheme, so it is the longest and riskiest path.

## Consequences

_TODO: what this makes easy, what it makes hard, and what would have to be true to revisit it._