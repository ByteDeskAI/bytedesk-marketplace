---
id: "TM-187"
kind: "task"
status: "in_progress"
created: "2026-09-12T01:38:55.402Z"
board: "bytedeskai/bytedesk-marketplace"
title: "agent-orchestration: a swept probe silently destroys a valid lead ack, so a responsive lead reads unresponsive"
epic: "EP-019"
acceptance: [{"text":"A valid, unexpired ack whose probe file has already been swept is either counted as proof (rememberAck runs) or refused with a reason naming the swept probe — never deleted silently","done":false},{"text":"The lateAck discard path is observable: which branch fired is recorded, so a discarded ack is distinguishable from an ack that never arrived","done":false},{"text":"A test reproduces the gap — probe file removed, valid ack present — and fails against the current lead.mjs","done":false},{"text":"sweepExpired and lateAck agree on ownership of .ack.json files; every caller that removes a probe handles its ack too","done":false}]
evidence: []
commits: []
blockedBy: []
blocks: []
actor: "main"
session: "83631657-6f99-4269-9c51-643b8f81a54b"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["ready-for-agent"]
triagedBy: "auto"
updated: "2026-09-12T01:42:16.254Z"
type: "bug"
priority: "high"
touches: [".claude/worktrees/agent-a63fd5d76aaa94ddb/task-management/CHANGELOG.md",".claude/worktrees/agent-a63fd5d76aaa94ddb/task-management/docs/agent-first.md",".claude/worktrees/agent-a63fd5d76aaa94ddb/task-management/skills/pool/SKILL.md"]
---

A lead that acknowledges a probe correctly and promptly can still be recorded as unresponsive,
because its ack file is deleted without ever being counted.

## Observed, 2026-09-11 ~21:32 (lead fd2b831f, consumer bytedesk-marketplace)

- `ao-topology lead ack 65db9a2b-e1c4-4e56-8041-cb65ba539495` returned
  `{"ok": true, "ack_path": ".../probes/65db9a2b-....ack.json"}`. `leadNonceAck` enforces both
  probe existence and `expires_at >= Date.now()`, so the probe was live and the ack was valid.
- By 21:33:40 that `.ack.json` was gone, and `probes/fd2b831f.answered.json` still read
  `at: 1789162765697` (17:39) — the memo from a much earlier probe. The proof was consumed
  without being recorded.
- The next probe (`c64a9ec9-...`) was then unanswerable: `lead ack` refused with
  `TOPOLOGY_LEAD_PROBE_UNKNOWN`, and `lead probes` returned `[]`.

## Hypothesis — NOT yet verified

In `agent-orchestration/topology/lib/lead.mjs`:

- `sweepExpired` (line ~178) deletes probe files only: it skips any name ending `.ack.json`,
  so an ack outlives the probe it answered.
- `lateAck` (line ~187) then finds that orphan ack, cannot read the probe (`probe` is null),
  falls past the `probe && expires_at >= now` branch into the unconditional
  `rm(probe); rm(ack)`, and continues the loop — returning `null`.
- Because it returns null, the caller's `rememberAck` at line ~134 never runs.

Net effect: the TM-161 late-ack path works only while the probe file survives. Once the probe
is swept first, a correct ack is destroyed silently and the lead reads unresponsive. Discarding
is defensible when the probe is gone (expiry is then unknowable), but doing it silently is not —
it is indistinguishable from a lead that never answered.

## What would settle it

The inference is from reading the code plus a missing memo, not from watching the branch run.
Record which `lateAck` branch fires (or stamp the deletion) and re-run a probe whose file is
swept before the ack arrives. See `.claude/rules/verification-that-can-fail.md` rules 6 and 7 —
this is the same shape as the ack-timeout default that no caller consulted.

Related: TM-172 (prompt ack trusts the caller's TMUX_PANE). Same subsystem, different defect.
