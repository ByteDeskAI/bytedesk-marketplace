---
id: "TM-431"
kind: "task"
status: "open"
created: "2026-10-05T15:29:02.185Z"
board: "bytedeskai/bytedesk-marketplace"
title: "agent-orchestration: a lead cannot mailbox its own dispatched topology worker (unknown_recipient, also for task:<TM-id>)"
epic: "EP-028"
acceptance: [{"text":"Lead→dispatched-worker mail resolves via --to task:<TM-id> (and/or --run <dir> --to worker) and is delivered to a live topology worker","done":false},{"text":"A regression test covers lead→worker delivery for a tm-pool-dispatched topology run whose consumer is a task worktree","done":false}]
evidence: []
commits: []
blockedBy: []
blocks: []
actor: "main"
session: "04f25c3d-c746-48cb-a504-8c1257e21c81"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["ready-for-agent"]
triagedBy: "auto"
updated: "2026-10-05T15:39:18.471Z"
comments: [{"author":"main","ts":"2026-10-05T15:39:18.466Z","text":"Lead triage (fd2b831f): (1) task:<TM-id> (TM-384, PR #196) is merged only on fix/ao-local-nats-autostart, not main, so it is not live for any consumer yet; it reaches main with PR #221 (TM-400). (2) TM-384 resolves task:<id> via the management record's record.worker (bindTaskWorker); a topology run worker that is not management-bound, and '--run <dir> --to worker', are not covered and stay unknown_recipient. After #221 lands: re-test (1); fix (2) by resolving run-agent recipients from the run's own roster for the run's lead (same-repo, run-scoped)."}]
---

Reported 2026-10-05 by design-system lead d04c2baa (Yara Prentice).

Repo: ByteDeskAI/design-system (main checkout on branch chore/ao-global-install-only). ao-topology = /home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace/agent-orchestration/bin/ao-topology at marketplace HEAD 0d511f68 (agent-orchestration last touched 2026-10-05 10:56 -0400).

Setup: tm pool dispatched TM-145 and TM-144 as topology runs: 20261005-112218-3j3r (session mass-laptop01--design-system--tm-145--bell, agent id 'worker', run consumer = the task worktree) and 20261005-112144-jed2 (tm-144--ada). The worker CAN reach the lead: message 728aa4ab-ac6f-48b2-b025-8b72e2fed58a was delivered to d04c2baa.

Lead → worker fails. Every one of these returns status=held, last_error=unknown_recipient:
  ao-topology mailbox send --run <run_dir> --to worker --body ...                       (from repo root)
  cd <worktree>; ao-topology mailbox send --consumer <worktree> --run <run_dir> --to worker --body ...
  ao-topology mailbox send --to task:TM-145 --body ...      (TM-384 says this recipient form shipped)
  ao-topology mailbox send --to task:TM-144 --body ...
'--dry-run' of the first form resolves the envelope without complaint, so the failure only shows on a real send.

Impact: a lead can't send review findings, a corrected PR base or a 'file your finish report' instruction to a live worker. The documented fallback (pane typing) is blocked whenever the worker's composer is nonempty, as it was for tm-145--bell.

Rule context: ~/.agents/AGENTS.md 'Talk to other agents through the agent-orchestration mailbox' says a mailbox failure is filed as a defect.

Related: TM-384 (task:<TM-id> worker recipient, marked done), TM-353 (presence resolution).
Code pointer: topology/lib/standing-mailbox.mjs:195-198 returns unknown_recipient when the decision isn't resolved.