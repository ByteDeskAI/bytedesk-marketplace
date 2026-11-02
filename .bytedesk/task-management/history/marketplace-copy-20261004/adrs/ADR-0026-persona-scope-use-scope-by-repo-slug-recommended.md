---
id: "ADR-0026"
kind: "adr"
status: "proposed"
created: "2026-10-02T02:48:29.025Z"
board: "bytedeskai/bytedesk-marketplace"
title: "Persona scope: use Scope by repo slug (Recommended)"
epic: "EP-021"
decisionKey: "168cfe69c670"
date: "2026-10-02"
updated: "2026-10-02T02:48:29.033Z"
---

## Context

Captured from an AskUserQuestion during a Claude Code session on 2026-10-02.
The question asked was: Solo persona names are unique per repo. The worker scoped them by the repo's NAME slug, not its full origin (owner/repo), so two different repos with the same name on one node (e.g. org1/app and org2/app) get different personas instead of identical session names. Keep that?

## Decision

**Solo persona names are unique per repo. The worker scoped them by the repo's NAME slug, not its full origin (owner/repo), so two different repos with the same name on one node (e.g. org1/app and org2/app) get different personas instead of identical session names. Keep that?** → chose **Scope by repo slug (Recommended)**.

Rejected:
- **Scope by full origin** — Personas per owner/repo; two same-named repos on one node could then produce identical session names and something else must break the tie.

**Without suffixes, a second concurrent run of the SAME workflow in the same repo (e.g. two parallel-review runs) is now refused, because both would be '...--run--parallel-review'. How should multiple runs of one workflow coexist?** → chose **Workflow as role, persona per run (Recommended)**.

Rejected:
- **Keep refusing; use --team** — One live run per workflow per repo per team; a second needs a different --team.
- **Keep 'run' role, persona per run** — node--repo--run--ada; workflow only in metadata.

## Consequences

_TODO: what this makes easy, what it makes hard, and what would have to be true to revisit it._