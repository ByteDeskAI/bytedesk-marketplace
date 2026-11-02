---
id: "ADR-0021"
kind: "adr"
status: "proposed"
created: "2026-10-02T02:04:27.770Z"
board: "bytedeskai/bytedesk-marketplace"
title: "Identity: use Global ID in metadata (Recommended)"
epic: "EP-021"
decisionKey: "3f64109cd2ac"
date: "2026-10-02"
updated: "2026-10-02T02:04:27.777Z"
---

## Context

Captured from an AskUserQuestion during a Claude Code session on 2026-10-02.
The question asked was: A tmux session name is only unique on its own host (each host has its own tmux server). Where should GLOBAL uniqueness live once teams span hosts over NATS leaf nodes?

## Decision

**A tmux session name is only unique on its own host (each host has its own tmux server). Where should GLOBAL uniqueness live once teams span hosts over NATS leaf nodes?** → chose **Global ID in metadata (Recommended)**.

Rejected:
- **Name is globally unique** — The tmux name itself must be unique across every host and team, so it doubles as the NATS address. Longer names, but one identifier everywhere.

**What identifies a HOST in the name? Hostnames can be random inside containers or cloud VMs.** → chose **Assigned node name (Recommended)**.

Rejected:
- **Short hostname** — Always os.hostname() up to the first dot.
- **Omit from tmux name** — Host lives only in metadata/NATS subject; the tmux name drops it since it is always the local host.

**What identifies the REPOSITORY? Folder names differ between machines (e.g. 'bytedesk-marketplace (copy)').** → chose **Git remote slug (Recommended)**.

Rejected:
- **Folder name** — The main checkout's folder name, as in the current TM-274 spec.
- **Remote with owner** — bytedeskai-bytedesk-marketplace — unambiguous across orgs, longer.

**Should a TEAM (a group of agents working together across hosts) appear in the name?** → chose **In the name**.

Rejected:
- **Metadata only (Recommended)** — Team id goes in tmux options and the NATS subject; the tmux name stays short.
- **Not needed yet** — No team concept in naming until distributed teams exist; leave room in metadata.

## Consequences

_TODO: what this makes easy, what it makes hard, and what would have to be true to revisit it._