---
id: "ADR-0039"
kind: "adr"
status: "accepted"
created: "2026-10-04T05:14:45.663Z"
board: "bytedeskai/bytedesk-marketplace"
title: "Adopt the per-agent NATS credential scheme (nats/integration, PR #179) as the live scheme"
epic: "EP-026"
deciders: ["Ryan"]
date: "2026-10-04"
updated: "2026-10-04T05:14:45.670Z"
---

## Context
On 2026-10-04 `main`'s shared-credential NATS clients (user `ao-orch`) were locked out of the live NATS home after processes from the unmerged `nats/integration` branch rewrote `state.json` to schema 2 (admin key, per-agent credentials). Two incompatible schemes shared one server (TM-335). EP-026 is in the release scope (ADR-0038).

## Decision
Ryan chose, on 2026-10-04, to adopt the per-agent credential scheme. `nats/integration` (draft PR #179, 37 commits ahead of `main`, 0 behind, checks green at 01cefdf2) becomes the live scheme once it is reviewed and a human merges it. Until then the integration build is used to read the mailbox. No further work that touches the NATS transport is dispatched against `main` before #179 lands, to avoid conflicts with its 84 changed files.

## Consequences
- TM-326, 327, 328, 329, 330, 315, 312 already have commits on `nats/integration`; they close when #179 lands, not before.
- TM-335 is resolved by the merge, plus a guard so an unmerged worktree build cannot write the live NATS home.
- The shared `ao-orch` password path in `nats-local.mjs` is replaced; older clients are refused with a named error.
