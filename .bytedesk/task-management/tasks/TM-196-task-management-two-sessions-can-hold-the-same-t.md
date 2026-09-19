---
id: "TM-196"
kind: "task"
status: "open"
created: "2026-09-13T19:22:32.589Z"
board: "bytedeskai/bytedesk-marketplace"
title: "task-management: two sessions can hold the same task with no warning"
epic: "EP-019"
acceptance: [{"text":"A second session claiming a task that another session already holds is refused or warned, naming the holder","done":false},{"text":"The guard survives the holder's session being idle rather than busy, since idle is the common case","done":false},{"text":"A cheap behind-not-ahead check is documented for authors: two-dot diff against the integration branch before opening a PR","done":false}]
evidence: []
commits: []
blockedBy: []
blocks: []
actor: "main"
session: "58d7cd20-54ac-45c8-84a6-ea82dbebfad2"
labels: ["plugin:task-management","ready-for-human"]
triagedBy: "human"
updated: "2026-09-13T21:29:47.655Z"
---

Observed live in ByteDeskAI/bytedesk-remote-gateway. Two sessions worked gateway TM-309
simultaneously, thirteen hours apart, and NEITHER was warned.

Outcome: the first session's work landed as a21d16dc (2026-09-11 22:32). The second
implemented the same two acceptance criteria in the same files from a base predating that
commit, and opened a PR. Its branch is now 1 ahead / 58 behind origin/develop, and merging
it would have REVERTED the newer work - RunChat.tsx, pluginSlots.ts, tabOverflow.ts,
ProjectSessionStrip.tsx - and dropped web/tests/orchestration-view-shots.mjs.

Measured on the branch, which is what makes the detector below work:

    git diff --stat origin/develop tm/TM-309-... -- web/src
    23 files changed, 145 insertions(+), 1573 deletions(-)

A branch that deletes 1,573 lines across files its author never opened is BEHIND, not
ahead. That signal is unmissable once looked for, and free.

The repository lead had this branch queued to merge and only excluded it after asking the
owning session, which replied that it was superseded. Nothing in the store said so: the task
showed the work as parked with two criteria shipped, and did not record that they had
shipped from a different session's commit.

## Suggested direction

1. Refuse or warn on a second claim, naming the existing holder. Note the holder is usually
   IDLE rather than busy - an agent waiting on a decision still holds the task - so a
   liveness check that only looks for a busy session will miss the common case.
2. Document the two-dot check for authors before opening a PR. It caught this one twice:
   it would have caught the duplicate before the PR, and it is what confirmed the revert
   risk before a merge.

Reported by the session that wrote the duplicate, which re-verified its own numbers against
origin/develop before filing rather than trusting its earlier measurement.
