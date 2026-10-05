---
id: "ADR-0035"
kind: "adr"
status: "accepted"
created: "2026-10-03T05:27:00.736Z"
board: "bytedeskai/bytedesk-marketplace"
title: "agent-orchestration: an unreachable AO_NATS_URL is a hard failure; ao never falls back from an explicit server"
epic: "EP-019"
deciders: ["Ryan Helms"]
date: "2026-10-03"
updated: "2026-10-03T05:27:00.742Z"
---

## Context

ADR-0031 (2026-10-02) made ao keep working on its managed local NATS when a configured server is unreachable, and report the outage to the repository lead. ADR-0032 narrowed the sources to `AO_NATS_URL`, then the gateway `orch.sock`, then managed local; TM-308 applied the ADR-0031 fallback to `AO_NATS_URL` as well. A three-reviewer parallel review of PR #154 (run `20261002-212844-e4bx`, report in that run's `artifacts/REPORT.md`) split on whether an explicit `AO_NATS_URL` belongs in the fallback path: two reviewers read ADR-0031 as requiring the fallback, one read the code comment "an `AO_NATS_URL` is never replaced" as intended. Falling back from an explicit server is what lets agents on different machines quietly end up on different buses, which is the failure ADR-0031 set out to make visible. Decided with the operator on 2026-10-03.

## Decision

1. **An explicit `AO_NATS_URL` is never replaced.** When it is unreachable, `openNatsTransport` records the outage in `transport.json` (source `AO_NATS_URL`, `blocking: true`, no fallback) and fails with `TOPOLOGY_NATS_UNAVAILABLE`. No managed local server is started for it. Every open fails the same way until the server answers; the first open that reaches it closes the outage with `recovered_at`.
2. **The host stays visibly down, not quietly elsewhere.** Repository supervisors keep running and tick degraded (`transport-unavailable`); the degraded tick still runs the outage tick and reports the transport, so the outage is logged at supervisor start and on every change, `doctor` raises `NATS_CONFIGURED_UNREACHABLE` saying that nothing on the host continues until the server answers, and `services status` shows the outage.
3. **The lead is still told, once per outage and once when it ends (ADR-0031 item 2).** The outage mail is written durably at once. It cannot be published while the only configured server is down, so it lands when that server answers again, or over whichever transport replaces `AO_NATS_URL` if the operator removes it. The recovery or retirement mail follows it.
4. **Only `AO_NATS_URL` is blocking.** A stale gateway `orch.sock` still falls back to managed local and is reported per ADR-0031; a managed-port conflict is still reported per ADR-0032.

## Consequences

- A host whose `AO_NATS_URL` points at a dead or wrong server does no orchestration work until it is fixed or the variable is removed. That is the intended trade: a split bus across machines is impossible, and the condition is named in the supervisor log, `doctor`, `services status` and the lead's mailbox.
- Supersedes ADR-0031 decision item 1 for `AO_NATS_URL` only, and TM-308's "an unreachable `AO_NATS_URL` falls back and is reported". ADR-0031 items 2 to 4 and ADR-0032 stand.
- An outage no open has retried for `OUTAGE_RETIRE_MS` (the operator removed the variable) is retired as before; each failed open refreshes it.
- Implementation is tracked as the task that cites this ADR; `nats-outage.test.mjs` drives the blocking path through a real `nats-server`.
