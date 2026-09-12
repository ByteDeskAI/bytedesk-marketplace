---
id: "ADR-0014"
kind: "adr"
status: "proposed"
created: "2026-09-11T21:35:26.821Z"
board: "bytedeskai/bytedesk-marketplace"
title: "Merge timing: use Hold until TM-180 (Recommended)"
epic: "EP-021"
decisionKey: "f0cbcbfe626b"
date: "2026-09-11"
updated: "2026-09-11T21:35:26.827Z"
---

## Context

Captured from an AskUserQuestion during a Claude Code session on 2026-09-11.
The question asked was: TM-178 (pool on by default) passes every test. Once merged, 24 other task-management boards on this machine start a pool at their next session, because none sets dispatch.enabled; only this repo is set to off. Workers are `claude` with permissions skipped, and the TM-177 guard blocks force-push, merge, deploy and similar commands. The PR finish line (TM-180) isn't built yet, so until it lands a worker's result stays committed in a worktree. When should I merge?

## Decision

**TM-178 (pool on by default) passes every test. Once merged, 24 other task-management boards on this machine start a pool at their next session, because none sets dispatch.enabled; only this repo is set to off. Workers are `claude` with permissions skipped, and the TM-177 guard blocks force-push, merge, deploy and similar commands. The PR finish line (TM-180) isn't built yet, so until it lands a worker's result stays committed in a worktree. When should I merge?** → chose **Hold until TM-180 (Recommended)**.

Rejected:
- **Merge TM-178 now** — Merge now. Pools start in the 24 boards at their next session and pick up tasks as they become ready. Until TM-180 lands, a worker's result stays committed in a worktree with no PR opened.
- **Merge now, default off** — Merge TM-178, but keep the default off until TM-180 lands, then switch it on. The code is on main sooner, at the cost of one extra change to flip later.

**A waiting (standby) pool process uses about 60 MB of memory. With the pool on, every open session in a repo with a board keeps one, so a second session can take over when the first closes. Keep that?** → chose **How can we fix this so a pool runs out-of-band from any session but keep a pool per repo**.

Rejected:
- **Keep standby (Recommended)** — About 60 MB per extra session per repo. The pool survives the session that started it, as long as any session in that repo stays open.
- **No standby** — Extra sessions exit at once, so there's one pool process per repo. When the session running the pool closes, no pool runs until the next session starts or someone runs `tm pool start`.

## Consequences

_TODO: what this makes easy, what it makes hard, and what would have to be true to revisit it._