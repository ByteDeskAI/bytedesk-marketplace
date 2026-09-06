---
id: "ADR-0004"
kind: "adr"
status: "proposed"
created: "2026-09-06T02:29:25.025Z"
board: "bytedeskai/bytedesk-marketplace"
title: "Stale procs: use Leave both running"
epic: null
decisionKey: "cd9e8d2507ff"
date: "2026-09-06"
updated: "2026-09-06T02:29:25.030Z"
---

## Context

Captured from an AskUserQuestion during a Claude Code session on 2026-09-06.
The question asked was: Both processes turned out to be live boards for other repos, not stale leftovers. How should I proceed?

## Decision

**Both processes turned out to be live boards for other repos, not stale leftovers. How should I proceed?** → chose **Leave both running**.

Rejected:
- **Kill both anyway** — Terminate pids 332003 and 2955161 (plus their wrappers). Whoever is using those boards loses them; they can be restarted with `tm tm-dashboard` from each repo. Ports 49230 and 56399 free up.
- **Kill only the design-system one** — Terminate pid 2955161 on port 56399, since it was started via a malformed `--help` invocation. Leaves the gateway board alone. Note it is still serving normally despite how it was launched.

## Consequences

_TODO: what this makes easy, what it makes hard, and what would have to be true to revisit it._