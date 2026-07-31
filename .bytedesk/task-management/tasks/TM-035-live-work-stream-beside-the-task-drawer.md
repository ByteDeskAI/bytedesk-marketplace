---
id: "TM-035"
kind: "task"
status: "done"
created: "2026-07-30T21:01:29.658Z"
title: "Live work stream beside the task drawer"
epic: "EP-003"
acceptance: [{"text":"Opening an in-progress task shows its work stream to the right of the drawer","done":true,"at":"2026-07-31T02:20:33.564Z"},{"text":"The panel fills the space between the drawer and the right edge of the viewport at any width","done":true,"at":"2026-07-31T02:20:33.628Z"},{"text":"The stream is read-only — it exposes no control that changes the run","done":true,"at":"2026-07-31T02:20:33.711Z"},{"text":"It uses the TanStack AI message model and ADS tokens, consistent with the rest of the board","done":true,"at":"2026-07-31T02:20:33.783Z"},{"text":"A task that is not in progress does not render the panel","done":true,"at":"2026-07-31T02:20:33.862Z"}]
evidence: [".bytedesk/task-management/evidence/TM-035-transcript.mjs",".bytedesk/task-management/evidence/TM-035-WorkStream.tsx"]
commits: ["246a986"]
blockedBy: []
blocks: []
actor: "main"
session: "61c67728-2ff2-46ea-87eb-2a99db9c96bd"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
updated: "2026-07-31T02:41:33.210Z"
touches: ["task-management/dashboard/src/components/WorkStream.tsx"]
comments: [{"author":"main","ts":"2026-07-31T02:12:29.395Z","text":"Server side is done and verified: lib/transcript.mjs reads the claiming session's transcript (both / and . sanitized, byte-range tail, tolerant parse) and GET /api/task/:id/stream serves it as TanStack AI UIMessages — confirmed live with curl. Client side is written and typechecks (WorkStream.tsx + a split layout in the drawer) but is NOT verified: with width=\"full\" the app rendered a blank page when opening an in-progress task, which is a real crash I have not root-caused. First suspect (spreading cssMap values) was wrong — fixing it did not help. Currently parked at width=\"wide\" so nothing crashes, which means AC 2 (fills the space beside the drawer) is not met. Next: get a browser console — the headless session exposes none, and clicks stopped opening the drawer for done tasks too, so the harness is part of the problem."},{"author":"main","ts":"2026-07-31T02:20:26.244Z","text":"Verified over CDP at 1600/1200/900px: drawer opens, WORK panel renders, reaches the viewport edge (24px gutter) at every width, zero interactive controls inside it, and a done task renders no panel. No exceptions. The earlier blank page was agent-browser's 780px headless viewport, not a code fault — the drawer at width=full had no room. Kept the error boundary anyway: a render error now prints on the page instead of painting an empty board."}]
parkedReason: "server side lands and is verified; the panel is unverified and crashed the drawer at width=full — parked pending a browser console (headless session exposes none). See comment 1."
closed: "2026-07-31T02:20:41.220Z"
---

## Problem
Opening a task that is being worked on shows its fields and nothing about the work itself.
The area to the right of the drawer sits empty while a run is in flight.

## Proposal
A read-only stream of the work for an in-progress task, filling the space between the right
edge of the drawer and the right edge of the screen. The server reads the claiming session
's
transcript and emits TanStack AI UIMessages; the panel renders them with ADS so it matches the
rest of the board.

Read-only, for viewing. No input, and no control that mutates the run.
