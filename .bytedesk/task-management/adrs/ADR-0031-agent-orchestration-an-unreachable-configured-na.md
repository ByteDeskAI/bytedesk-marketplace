---
id: "ADR-0031"
kind: "adr"
status: "accepted"
created: "2026-10-02T11:54:12.686Z"
board: "bytedeskai/bytedesk-marketplace"
title: "agent-orchestration: an unreachable configured NATS is reported to the repository lead, not hidden"
epic: "EP-021"
deciders: ["Ryan Helms"]
date: "2026-10-02"
updated: "2026-10-02T11:54:12.694Z"
---

## Context

Since 0.12.0, when the ambient `NATS_URL` refuses connections, ao falls back to its own managed local NATS (`orch-transport.mjs`, around lines 425–466). It logs nothing about this at supervisor start, so a broken shared NATS goes unnoticed, and agents on different machines can quietly end up on different buses. TM-276 had asked ao to fail instead. Decided with the operator on 2026-10-02.

## Decision

When the configured or ambient NATS (`AO_NATS_URL` / `NATS_URL`) is unavailable:

1. **Keep working on the managed local NATS.** Work on this host does not stop.
2. **Report the problem to the repository lead.** Send the lead a durable ao message (mailbox) that names the unreachable URL, its source, the error, and the transport now in use, so the lead can resolve it. Send it once per outage, not on every tick, and also when the configured NATS comes back.
3. **Log the selected transport and its source** at supervisor start (`AO_NATS_URL`, ambient `NATS_URL`, the gateway `orch.sock`, or managed local). Log a fallback as a named warning naming the URL. `services status` and `doctor` show the current transport and any active outage.
4. **After the fix is committed, update the installed plugin** so every host runs it. `services ensure` and host-copy sync (TM-284) handle the other hosts.

## Consequences

- A broken shared NATS is visible to the lead within one outage report instead of being hidden.
- Cross-machine teams can still split onto different buses during an outage. The lead's report is what makes that visible. TM-279 team persona allocation already refuses rather than falling back, so personas cannot collide.
- Implementation is tracked as TM-276 (criteria rewritten to this decision).
