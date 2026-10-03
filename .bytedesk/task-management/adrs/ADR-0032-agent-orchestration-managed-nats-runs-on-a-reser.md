---
id: "ADR-0032"
kind: "adr"
status: "accepted"
created: "2026-10-03T01:49:26.167Z"
board: "bytedeskai/bytedesk-marketplace"
title: "agent-orchestration: managed NATS runs on a reserved static high port; the ambient NATS_URL is not an ao source"
epic: "EP-021"
deciders: ["Ryan Helms"]
date: "2026-10-03"
updated: "2026-10-03T01:49:26.174Z"
---

## Context

ao's managed local NATS gets its port from the operating system (`listen(0)` in `topology/lib/nats-local.mjs`). It saves that port in `~/.bytedesk/agent-orchestration/nats/state.json` and reuses it, but the number is random, comes from the ephemeral range, and isn't recorded anywhere a developer would look. Separately, ao counts the generic `NATS_URL` environment variable as a configured server. On the authoring machine, `~/.zshenv` exports `NATS_URL=nats://localhost:4222` for a Kubernetes port-forward that is often down. ao then logs a fallback and reports an outage to every repository lead (ADR-0031). The operator does not want ao to depend on a port-forward. Decided with the operator on 2026-10-02.

## Decision

1. **The port lives in each developer's ao user config.** The key is `nats.port` in `$XDG_CONFIG_HOME/agent-orchestration/config.json` (default `~/.config/agent-orchestration/config.json`).
2. **It is chosen once, from what is free on that machine.** On the first managed start with no `nats.port` set, ao picks a free port in a high range that doesn't clash with ao's other ports: the session host uses 45000–45032 and process-compose 45100–45199. It verifies the port is free, writes it to the user config, and from then on starts managed NATS on exactly that port every time. A developer may set or change the key themselves. The value is validated as an integer from 1024 to 65535.
3. **ao does not move the port silently.** If the configured port is taken by another process at start, ao refuses to start NATS on a different port. It reports the conflict through `services status` and `doctor`, and to the repository lead (ADR-0031), naming the port and the process holding it.
4. **Sources, in order:** the explicit `AO_NATS_URL`, then the gateway listener (`orch.sock`), then managed local NATS on the configured port. The generic `NATS_URL` is **not** an ao source. Other tools may still use it. If it's set, ao logs once that it ignores it.
5. **Credentials:** the managed server's generated user and password stay in the private (mode 0600) `state.json`, not in the user config.

## Consequences

- Each machine has a stable, predictable NATS URL (`nats://127.0.0.1:<nats.port>`) that the developer can read in their own config and in `services status`.
- A broken port-forward no longer causes fallbacks or outage reports.
- This supersedes the part of ADR-0031 that treats the ambient `NATS_URL` as a source. ADR-0031's report-to-the-lead rule still applies to `AO_NATS_URL`, the gateway listener, and the port conflict in point 3.
- Migration: on the first start after this change, if `state.json` already records a port that is free and in range, it is adopted into the user config. Otherwise a new one is chosen as in point 2.
