---
id: "TM-040"
kind: "task"
status: "done"
created: "2026-07-31T02:37:53.763Z"
title: "Motion on the board: show that work is happening, and that something changed"
epic: "EP-003"
acceptance: [{"text":"A card being worked on animates from real activity — the claiming session's last write — not a decorative spinner that runs whether or not anything is happening","done":true,"at":"2026-07-31T04:14:08.783Z"},{"text":"A card that moves column, arrives, or leaves animates the transition, so a change made by another session or the CLI is noticed rather than silently swapped in","done":true,"at":"2026-07-31T04:14:08.856Z"},{"text":"Numbers that change animate their change: column counts, epic progress bars, acceptance tallies","done":true,"at":"2026-07-31T04:14:08.915Z"},{"text":"prefers-reduced-motion removes every animation, leaving the same information in a static form","done":true,"at":"2026-07-31T04:14:08.971Z"},{"text":"No animation loops forever on an idle board — a board nobody is working on is still","done":true,"at":"2026-07-31T04:14:09.052Z"}]
evidence: [".bytedesk/task-management/evidence/TM-040-motion.ts"]
commits: ["225ebf8"]
blockedBy: []
blocks: []
actor: "main"
session: "61c67728-2ff2-46ea-87eb-2a99db9c96bd"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
updated: "2026-07-31T04:15:19.167Z"
comments: [{"author":"main","ts":"2026-07-31T04:12:31.989Z","text":"probe: a fresh write, to see the card move"},{"author":"main","ts":"2026-07-31T04:14:18.550Z","text":"Verified in a real browser over CDP, at 1600px. Claimed-but-quiet card: animationName none. Same card one second after a write: tmPulse. Idle todo card and a done card: none — an idle board is still, which is the whole difference between motion and wallpaper. Under prefers-reduced-motion (emulated as an OS setting would deliver it): none everywhere. A status change moved a card between columns and Atlaskit's FadeIn keyframe ran, gone three seconds later while the live pulse continued. Built on @atlaskit/motion, already a dependency — its FadeIn/ExitingPersistence honour reduced motion themselves, so there is no second switch to keep in sync. Two build-time constraints worth remembering: @compiled cannot extract a ternary (css={[a, cond && b]} is the form), and hooks must sit above App's early return — the first draft put useLiveWork below it and React error #310 blanked the board."}]
closed: "2026-07-31T04:14:18.614Z"
---

## Problem
The board is multi-writer — the CLI, the MCP server, hooks and other sessions all write to it, and
SSE pushes the result — but every change lands as a silent swap. A card appears in another column
between glances and nothing says it moved. Worse, a task that is actively being worked on looks
identical to one that has sat claimed for four hours: the in-progress column is a status, not a
sign of life.

## Proposal
Motion as information, never decoration. Two jobs:

1. **Liveness** — a card whose session is writing right now should show it. The data already
   exists: TM-035 built a transcript reader, so the board can know when the claiming session last
   produced a message. Pulse on real activity and go still when it stops, so the animation means
   something. A spinner that always spins says nothing.
2. **Change** — when a card moves, arrives, or leaves, animate the transition so the eye catches
   what changed. This matters most for changes the viewer did not make.

Everything is subordinate to `prefers-reduced-motion`: it must remove motion without removing
information.

## Candidates, roughly in order of value
- card enters / leaves / crosses columns (the multi-writer case)
- liveness pulse driven by the work stream
- epic progress bar growing when a task completes
- column count and acceptance tally bumping on change
- a newly unblocked card highlighting when its blocker closes
- activity feed entries sliding in
- epic lane collapse/expand easing its height (TM-038 shipped it instant)
- the live/offline dot reflecting SSE reconnect
- optimistic writes settling from pending to confirmed (the outbox already tracks this)
- first paint: skeleton rather than five empty columns
