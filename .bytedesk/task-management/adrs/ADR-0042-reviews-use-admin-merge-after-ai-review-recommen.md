---
id: "ADR-0042"
kind: "adr"
status: "proposed"
created: "2026-10-05T11:01:57.504Z"
board: "bytedeskai/bytedesk-marketplace"
title: "Reviews: use Admin-merge after AI review (Recommended)"
epic: "EP-028"
decisionKey: "d0bcc5a765fe"
date: "2026-10-05"
updated: "2026-10-05T11:01:57.512Z"
---

## Context

Captured from an AskUserQuestion during a Claude Code session on 2026-10-05.
The question asked was: Bastion's develop branch requires an approving review, and GitHub won't let your own account approve its own PR. How should autonomous sessions get past required reviews?

## Decision

**Bastion's develop branch requires an approving review, and GitHub won't let your own account approve its own PR. How should autonomous sessions get past required reviews?** → chose **Admin-merge after AI review (Recommended)**.

Rejected:
- **Drop required approvals** — Set required approving reviews to 0 on ByteDeskAI repos so normal merges work. Required status checks stay.
- **Keep human review** — Sessions stop at an open PR and you approve it. Everything before that stays autonomous.

## Consequences

_TODO: what this makes easy, what it makes hard, and what would have to be true to revisit it._