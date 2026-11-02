---
id: "ADR-0034"
kind: "adr"
status: "proposed"
created: "2026-10-03T02:20:49.536Z"
board: "bytedeskai/bytedesk-marketplace"
title: "Storage seam: use Backend interface + schema registry (Recommended)"
epic: "EP-021"
decisionKey: "0cb6c32a38b3"
date: "2026-10-03"
updated: "2026-10-03T02:20:49.543Z"
---

## Context

Captured from an AskUserQuestion during a Claude Code session on 2026-10-03.
The question asked was: How should the pluggable storage seam work for task-management?

## Decision

**How should the pluggable storage seam work for task-management?** → chose **Backend interface + schema registry (Recommended)**.

Rejected:
- **NATS only, schema registry only** — Drop the file backend after migration. Pluggability is limited to schema extension; no alternate backends.
- **Backend interface, any transport** — Same as the first, but design the interface so other backends (S3, Postgres) can be added later. More abstraction now.

**What is the backward-compatibility rule for schema changes?** → chose **Versioned envelope + upcasters (Recommended)**.

Rejected:
- **Additive-only, no upcasters** — Only add optional fields; never rename or retype. Simplest, but any real restructure needs a migration.
- **Strict versions with migrations** — Readers reject unknown versions; a migration tool upgrades data in place. Safest for correctness, worst for mixed-version fleets.

**What git and merge authority do I have for this work?** → chose **Full authority to make any decisions that yo need to make this the best it can be.**.

Rejected:
- **Branches + PRs, you merge (Recommended)** — I work on feature branches in marketplace and remote-gateway, commit and open PRs, and never merge or push to main. Matches the repo rule that humans merge.
- **Branches + commits, no pushes** — I commit locally on branches and you push and open PRs.
- **Merge to main myself** — I commit and merge. Faster, but it overrides the repo's human-merge rule, so name the repos where it applies.

**What does the cross-server topology look like?** → chose **Gateway as hub, servers are leaf nodes (Recommended)**.

Rejected:
- **Peer cluster** — Machines form a NATS cluster with replicated streams. Stronger availability, needs 3+ nodes and stable networking.
- **Single server first** — Prove everything on one server; design for leaf links but do not build them yet.

## Consequences

_TODO: what this makes easy, what it makes hard, and what would have to be true to revisit it._