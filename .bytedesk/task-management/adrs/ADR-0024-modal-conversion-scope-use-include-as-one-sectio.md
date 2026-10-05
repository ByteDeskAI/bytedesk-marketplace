---
id: "ADR-0024"
kind: "adr"
status: "proposed"
created: "2026-09-27T02:25:19.253Z"
board: "bytedeskai/bytedesk-marketplace"
title: "Modal conversion scope: use Include as one section of this plan (Recommended)"
epic: "EP-021"
decisionKey: "a9d84ba308d1"
date: "2026-09-27"
updated: "2026-09-27T02:25:19.261Z"
---

## Context

Captured from an AskUserQuestion during a Claude Code session on 2026-09-27.
The question asked was: For the 'convert asides to modals' UI work — is that in scope for this planning pass, or should it be a separate follow-up plan?

## Decision

**Where should I look for the Claude/Codex/Grok transcripts to mine for issues — which repositories and paths?** → chose **~/.claude/projects/* across all ByteDeskAI repos (Recommended), Include Codex/Grok session logs too, Task-management's own event log (events.jsonl) and knowledge store**.

Rejected:
- **~/.claude/projects/* across all ByteDeskAI repos (Recommended)** — Scan all local Claude transcript dirs for repos under ~/Documents/GitHub/ByteDeskAI, plus subagent transcripts, filtered to last 10 days
- **Only bytedesk-marketplace + bytedesk-platform** — Limit to the two repos most likely to reference agent-orchestration/task-management directly
- **Include Codex/Grok session logs too** — Also search ~/.codex and ~/.grok (or equivalent) session logs, not just Claude
- **Task-management's own event log (events.jsonl) and knowledge store** — Use .bytedesk/task-management/.km/events.jsonl and km find as a primary source rather than raw transcripts

**For the 'convert asides to modals' UI work — is that in scope for this planning pass, or should it be a separate follow-up plan?** → chose **Include as one section of this plan (Recommended)**.

Rejected:
- **Note it but plan separately** — Just capture the aside-scroll bug as one finding; do full UI redesign planning in a follow-up session

**What's the deliverable format for the issue list — how should I hand back 'every issue, count, resolution'?** → chose **1 and 2 and they belong i a single epic in the marketplace board**.

Rejected:
- **Markdown report file under docs/ or knowledge store (Recommended)** — Write a structured report (issue, frequency, evidence, fix) into .bytedesk/knowledge/ or a docs file, plus a summary in chat
- **Task-management tasks directly** — File each distinct issue as its own tm task with evidence, skip a standalone report
- **Chat summary only** — Just present the list in the conversation, no file written

## Consequences

_TODO: what this makes easy, what it makes hard, and what would have to be true to revisit it._