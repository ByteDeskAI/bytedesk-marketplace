---
id: "ADR-0008"
kind: "adr"
status: "proposed"
created: "2026-09-09T21:07:11.807Z"
board: "bytedeskai/bytedesk-marketplace"
title: "TM-127: use Land it, then extend (Recommended)"
epic: "EP-018"
decisionKey: "cea064753338"
date: "2026-09-09"
updated: "2026-09-09T21:07:11.815Z"
---

## Context

Captured from an AskUserQuestion during a Claude Code session on 2026-09-09.
The question asked was: There is already a 69-file, 6.7k-line implementation committed at f3f21e7 on the TM-127 branch/worktree (leads, presence producer, standing mailbox, lockfile, reviewer, management gates) — parked, 21 ACs unticked, four coordinator reviews written against the *older uncommitted* tree. How should the plan treat it?

## Decision

**There is already a 69-file, 6.7k-line implementation committed at f3f21e7 on the TM-127 branch/worktree (leads, presence producer, standing mailbox, lockfile, reviewer, management gates) — parked, 21 ACs unticked, four coordinator reviews written against the *older uncommitted* tree. How should the plan treat it?** → chose **Land it, then extend (Recommended)**.

Rejected:
- **Extend inside the TM-127 branch** — Add the new primitives to the same branch and merge everything as one. Faster to a single merge, but a much bigger review surface and TM-127 stays parked longer.
- **Ignore it, build fresh on main** — Treat TM-127 as abandoned and design the primitives independently. Discards working presence/lead/lock code and would collide on merge.

**TM-127 deliberately DISABLED the tmux doorbell — every delivery now reports `rang: false, notification: 'durable-pending'`, because 'pane liveness proves neither an empty composer nor a safe tool-input state'. So an idle agent never wakes up; it only sees mail when it polls. The transcripts show the swarm working around this by hand (save composer draft, steer, restore). What should replace it?** → chose **Subscribe-then-ring (Recommended)**.

Rejected:
- **Ring + save/restore draft** — Always ring; capture the composer contents first and re-type them after. Matches what agents did by hand, but re-typing another agent's draft is lossy and racy.
- **Ring on a settle timer** — Ring if the pane has been unchanged for N seconds. Simple, but a paused agent with a half-typed draft still gets clobbered.
- **Keep polling only** — Leave delivery durable-pending and instead make agents poll their inbox on a cadence. Safest, but idle agents stay idle until their next turn.

**Beyond landing TM-127 and the bell, which coordination primitives from the transcripts should this plan actually build? (The swarm hand-rolled 138 python heredocs, 82 capture-pane probes and 32 status.md appends to fake these.)** → chose **Named serial slots, Liveness + idle census, Broadcast addressing, Idle dispatch + quota failover**.

Rejected:
- **Named serial slots** — `slot request|grant|release|status <name>` with a queue — productizes the conductor's hand-run 'serial slot', 'cutover lock', 'deploy-safe lock'. Built on the existing lockfile.mjs.
- **Liveness + idle census** — `agents --live` deriving working / idle / needs-input / quota-blocked / dead from pane state + provider patterns. Nothing tracks idle today.
- **Broadcast addressing** — `--to @repo`, `@run`, `@role:worker`, `@idle`. Today only intra-run fan-out ids expand; nothing crosses runs or repos.
- **Idle dispatch + quota failover** — Hand the next ready tm task to a live idle enrolled agent; auto-failover when a provider returns a usage-limit 403 (both implementers died on Kimi quota mid-task).

## Consequences

_TODO: what this makes easy, what it makes hard, and what would have to be true to revisit it._