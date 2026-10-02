---
id: "ADR-0030"
kind: "adr"
status: "accepted"
created: "2026-10-02T02:19:43.855Z"
board: "bytedeskai/bytedesk-marketplace"
title: "agent-orchestration: tmux session naming and agent identity for distributed teams"
epic: "EP-021"
deciders: ["Ryan Helms"]
date: "2026-10-02"
updated: "2026-10-02T02:19:43.862Z"
---

## Context

ao's tmux session names were opaque, for example `ao-fd2b831f` and `<agentId>-<7hex>`, so `tmux ls` couldn't show which host or repository a session belonged to. Code also identified agents by parsing those names.

Agent teams will span several hosts connected as NATS leaf nodes. Each host runs its own tmux server, so a tmux name is unique only on its own host. Numeric suffixes added on a collision (`-2`) mean nothing outside that host, and the user rejected them. Decided with the user on 2026-10-02.

## Decision

1. **Name format.** A session is named `[team--]node--repo--role--persona`, with segments joined by `--`.
   - Each segment is slugged to `[a-z0-9-]` and capped in length, so `--` can only be the separator.
   - Example team session: `core--agents1--bytedesk-marketplace--lead--ada`.
   - Example solo session: `agents1--bytedesk-marketplace--reviewer--linus`.
   - **team:** present only when the run has a team, set by the workflow, the run, or `--team`.
   - **node:** `AO_NODE_NAME`, else the ao user config's node name, which is also the NATS leaf-node name, else the short hostname.
   - **repo:** the slug of the git `origin` remote's repository name. The owner is kept in metadata. Use the main checkout's folder name only when there is no remote.
   - **role:** lead, reviewer, or the workflow role. A workflow session that holds several panes uses the **workflow name** as its role. Its persona segment is a registry-allocated persona for that run, for example `agents1--bytedesk-marketplace--parallel-review--ada`. Concurrent runs of one workflow therefore never collide. The run's persona is released when the run ends. (Revised on 2026-10-02: an earlier draft used the role `run` and named the persona after the workflow, which refused a second concurrent run of the same workflow.)
   - **persona:** the agent's stable generated first name. Once the first-name pool for a scope is exhausted, add a surname (`ada-lovelace`).
2. **The name is a label, not a key.** Every session gets a global ID (a ULID), recorded as tmux session options together with the agent, role, repo, node and team. The same ID is used in NATS subjects. Every reader resolves identity from that metadata, never by parsing the name. Legacy `ao-<id>` and `<id>-<spawn>` sessions are still recognised until they end.
3. **No collision suffixes. Uniqueness comes from the design:**
   - An agent may have only one live session.
   - Parallel work gets distinct agents.
   - A persona name is unique within its team, or within its repo for solo work.
   - The solo scope is the repo **slug** (the name segment), not the full origin. Two different repositories with the same name on one node therefore draw from one persona pool, so their session names can never be identical. Decided with the user on 2026-10-02.
   - Names are allocated by a registry: NATS KV with an atomic create for team scope, and a local file lock when offline or solo.
4. **Re-spawning a live agent:**
   1. Wait for the current turn to end (bounded).
   2. Ask the agent for a handoff in the `tm handoff` shape: goal, state, open questions, files.
   3. End the old session and start a fresh one under the same name.
   4. The lead or conductor that requested the re-spawn decides whether the handoff goes to the new session.

## Consequences

- `tmux ls` groups sessions by team, node and repo, and a name means the same thing on every host.
- Readers must move to metadata in the same change. A reader still parsing names would silently miss new sessions.
- Persona allocation becomes a coordination point. Team scope depends on NATS KV being reachable; solo work does not.
- A re-spawn is slower, because it waits for the turn to end and for the handoff. In exchange, an agent is never cut off mid-edit and its context isn't lost.
- Gateway tab names are minted by the gateway and are not covered by this decision.
- Delivery is split into three tasks: TM-274 (format, identity metadata, readers, config, local allocator behind a registry interface), then the NATS KV team registry, then the re-spawn handoff flow.
