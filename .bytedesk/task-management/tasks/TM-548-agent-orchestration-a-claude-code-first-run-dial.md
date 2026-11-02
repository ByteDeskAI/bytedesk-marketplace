---
id: "TM-548"
kind: "task"
status: "open"
created: "2026-11-01T21:21:27.335Z"
board: "bytedeskai/bytedesk-marketplace"
title: "agent-orchestration: a Claude Code first-run dialog in a standing reviewer pane silently blocks every review request (composer not empty after 5 wakes)"
epic: "EP-019"
acceptance: [{"text":"Standing Claude roles launch with the auto-mode environment prompt suppressed (test asserts the launch config/flag)","done":false},{"text":"A wake that finds a native modal reports it by its first line, not as composer-not-empty (test with a captured modal fixture)","done":false},{"text":"ao doctor flags a standing pane that shows a modal","done":false}]
evidence: []
commits: []
blockedBy: []
blocks: []
actor: "main"
session: "72f1fc09-2253-4281-a926-682424a11029"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["ready-for-agent"]
triagedBy: "auto"
updated: "2026-11-02T01:10:30.241Z"
priority: "high"
comments: [{"author":"main","ts":"2026-11-01T21:24:08.323Z","text":"Second repro, design-system (lead d04c2baa, 2026-11-01 21:23Z): reviewer e16d04f0, pane %59, stuck on the same 'Teach auto mode about your environment?' dialog with unsent text in its input. Two repos the same day: this affects every standing Claude role launched since the dialog appeared."},{"author":"main","ts":"2026-11-02T01:10:30.233Z","text":"See TM-554 (census/reviewer status detection of the same dialog); agent-fabric reviewer bf039c07 is a third live instance."}]
---

2026-11-01 ~21:20Z, bytedesk-marketplace. Reviewer Faro (c164bf8b, pane %171, relaunched by lead via 'agent restart --mode handoff' at ~20:56Z) ended its turn, then Claude Code drew a native modal 'Teach auto mode about your environment? 1. Yes 2. Not now 3. Don't show again'. Its composer also held 'check the inbox again'. ao-supervisor then reported 'REVIEW REQUEST FAILED: TM-292 at 534c231a ... after 5 wake attempts (the composer is not empty)'. Nothing in AO detects or names the modal; the failure text blames the composer only. The lead cannot clear it: sending a key to another agent's pane is correctly refused.

Asked for: (1) launch standing Claude roles with the setting that suppresses this first-run prompt (or pre-seed its 'don't show again' state) so a modal never appears in an unattended pane; (2) the wake/landing check recognises a native modal and reports 'pane blocked by a dialog: <first line>' instead of 'composer not empty'; (3) doctor flags a standing pane showing a modal.