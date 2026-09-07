---
id: "ADR-0007"
kind: "adr"
status: "proposed"
created: "2026-09-07T15:49:58.140Z"
board: "bytedeskai/bytedesk-marketplace"
title: "Folder trust: use I pre-trust it for you"
epic: "EP-017"
decisionKey: "d1ef3f4bb3ad"
date: "2026-09-07"
updated: "2026-09-07T15:49:58.148Z"
---

## Context

Captured from an AskUserQuestion during a Claude Code session on 2026-09-07.
The question asked was: Claude has never been trusted for the new client directory, so all four discovery agents fell back off their Claude chains — three landed on Codex, one on Grok. How should I clear it?

## Decision

**Claude has never been trusted for the new client directory, so all four discovery agents fell back off their Claude chains — three landed on Codex, one on Grok. How should I clear it?** → chose **I pre-trust it for you**.

Rejected:
- **You run it, I relaunch (Recommended)** — In a normal terminal: cd ~/Documents/GitHub/ByteDeskAI/clients/viking-surface-care && claude, choose "Yes, I trust this folder", quit. Takes five seconds; I relaunch discovery immediately with its intended rosters. Trusting a directory for Claude is a decision about where it may execute, so it should be yours.
- **Run it on Codex and Grok anyway** — Discovery proceeds now with the fallback roster. Codex and Grok are capable of the research and synthesis, but the conductor, auditor and synthesist all end up on one family, which loses the independent-evidence split the stage is designed around — on the brief every later stage reads.

## Consequences

_TODO: what this makes easy, what it makes hard, and what would have to be true to revisit it._