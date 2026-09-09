---
id: "ADR-0010"
kind: "adr"
status: "proposed"
created: "2026-09-09T21:17:13.457Z"
board: "bytedeskai/bytedesk-marketplace"
title: "SDK contract: use Approve the generic contract"
epic: "EP-018"
decisionKey: "a7c26228830a"
date: "2026-09-09"
updated: "2026-09-09T21:17:13.462Z"
---

## Context

Captured from an AskUserQuestion during a Claude Code session on 2026-09-09.
The question asked was: The gateway terminal header is blocked on a decision that has been sitting since this morning. `GATEWAY-SDK-PROPOSAL.md` asks you to approve a generic `terminal-presentation` SDK contribution — the gateway's own AGENTS.md:80-95 forbids changing the SDK or working around it with a local type without asking you first, so nobody has proceeded. Without it there is no sanctioned way to put role badges and group labels in the header.

## Decision

**The gateway terminal header is blocked on a decision that has been sitting since this morning. `GATEWAY-SDK-PROPOSAL.md` asks you to approve a generic `terminal-presentation` SDK contribution — the gateway's own AGENTS.md:80-95 forbids changing the SDK or working around it with a local type without asking you first, so nobody has proceeded. Without it there is no sanctioned way to put role badges and group labels in the header.** → chose **Approve the generic contract**.

Rejected:
- **Approve, but prototype behind a flag first** — Same contract, but the gateway ships it disabled by default so the header can be proven end-to-end against real presence data before the SDK release chain is committed to.
- **Defer the header** — Do the marketplace-side work only — roles, slots, liveness, delivery guarantee, presence producer — and leave the gateway header for a later cycle once the SDK direction is settled.

**Landing TM-127 (Phase 0) is a review-fix-verify-merge job on 69 files, and the five new primitives are largely independent of each other. How should the subagent fan-out be shaped?** → chose **Sequential Phase 0, then parallel (Recommended)**.

Rejected:
- **Fully parallel from now** — Fan out immediately, with the TM-127 lander and the feature agents working simultaneously. Fastest wall-clock, but every feature agent rebases onto a moving TM-127 and conflicts in topology/lib are near-certain.
- **One agent per phase, sequential** — Strictly one agent at a time, each building on the last merged state. Simplest to reason about and review, much slower.

## Consequences

_TODO: what this makes easy, what it makes hard, and what would have to be true to revisit it._