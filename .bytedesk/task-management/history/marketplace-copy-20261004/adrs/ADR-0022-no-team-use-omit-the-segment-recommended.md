---
id: "ADR-0022"
kind: "adr"
status: "proposed"
created: "2026-10-02T02:08:29.158Z"
board: "bytedeskai/bytedesk-marketplace"
title: "No team: use Omit the segment (Recommended)"
epic: "EP-021"
decisionKey: "3aa0c4c20070"
date: "2026-10-02"
updated: "2026-10-02T02:08:29.164Z"
---

## Context

Captured from an AskUserQuestion during a Claude Code session on 2026-10-02.
The question asked was: When an agent is not part of a team (solo lead, ad-hoc spawn), what goes in the team segment?

## Decision

**When an agent is not part of a team (solo lead, ad-hoc spawn), what goes in the team segment?** → chose **Omit the segment (Recommended)**.

Rejected:
- **Fixed word 'solo'** — Always five segments: solo-agents1-bytedesk-marketplace-lead-ada. Uniform shape, easy to filter.
- **Default to the repo** — Every repo is implicitly a team; the segment repeats the repo slug when no team is named.

**Parts like 'bytedesk-marketplace' already contain hyphens, so hyphen-joined names are ambiguous to read back. Which separator between segments?** → chose **Double hyphen '--' (Recommended)**.

Rejected:
- **Underscore '_'** — core_agents1_bytedesk-marketplace_lead_ada. Compact; underscores are then forbidden inside parts.
- **Single hyphen** — core-agents1-bytedesk-marketplace-lead-ada. Prettiest, but only metadata can split it.

**Two live sessions on one host would get the same label (same team, repo, role, name). How should they differ?** → chose **How do we fix this collision another way than this so we dont need arbitrar extension**.

Rejected:
- **Short id from the global ID (Recommended)** — Append the last 4 characters of the session's global ID: …--ada-7f3k. Stable for that session, traceable to its NATS address.
- **Counter** — Append -2, -3… Friendlier, but the number means nothing outside this host and can be reused.
- **Always include short id** — Every name ends with the 4-char id, collision or not. Uniform; no surprise when a second spawn appears.

**What is the <name> segment?** → chose **Agent's persona name (Recommended)**.

Rejected:
- **Provider + persona** — e.g. claude-ada, codex-linus, so the provider is visible in tmux ls.
- **Task key when working a task** — e.g. tm-274 while assigned, persona name otherwise.

## Consequences

_TODO: what this makes easy, what it makes hard, and what would have to be true to revisit it._