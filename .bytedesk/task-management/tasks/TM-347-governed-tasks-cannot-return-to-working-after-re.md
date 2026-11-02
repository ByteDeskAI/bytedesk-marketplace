---
id: "TM-347"
kind: "task"
status: "done"
created: "2026-10-05T10:42:26.429Z"
board: "bytedeskai/bytedesk-marketplace"
title: "Governed tasks cannot return to working after review requests changes"
acceptance: [{"text":"After a changes_requested verdict, one supported command returns the task to working and 'manage start-worker' then succeeds.","done":true,"at":"2026-10-05T14:02:02.410Z"},{"text":"The new finish report requires a new revision, and the reviewer verdict for the old revision cannot satisfy integration.","done":true,"at":"2026-10-05T14:02:02.792Z"},{"text":"Tests cover changes_requested, then rework, re-finish, re-review and integrate.","done":true,"at":"2026-10-05T14:02:03.218Z"},{"text":"Released: plugin-rsync or /reload-plugins delivers the fix to bytedesk-agent-browser, and its TM-010 rework dispatch works.","done":true,"at":"2026-10-08T23:33:38.536Z"}]
evidence: [".bytedesk/task-management/evidence/TM-400-landing.md"]
commits: ["https://github.com/ByteDeskAI/bytedesk-marketplace/pull/192","https://github.com/ByteDeskAI/bytedesk-marketplace/pull/211","https://github.com/ByteDeskAI/bytedesk-marketplace/pull/212","https://github.com/ByteDeskAI/bytedesk-marketplace/pull/221"]
blockedBy: ["TM-400"]
blocks: ["TM-350","TM-383","TM-393","TM-415"]
actor: "main"
session: "253de95a-5b3d-4702-b941-9b7ba0507f01"
branch: "fix/ao-local-nats-autostart"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
triagedBy: "human"
updated: "2026-10-08T23:48:32.919Z"
priority: "high"
type: "bug"
links: [{"type":"relates to","id":"TM-365"}]
comments: [{"author":"main","ts":"2026-10-05T12:49:45.097Z","text":"Worker done at b61b096c (tm/TM-347-348-349-rework-admit-base). Lead reran checks: AO test:unit exit 0 (1049 pass/0 fail/4 skip), build:check exit 0, tm unit exit 0 (1603/1603). PR #192 -> fix/ao-local-nats-autostart; independent review running."},{"author":"main","ts":"2026-10-05T14:02:03.587Z","text":"PR #192 merged into fix/ao-local-nats-autostart at 08fb40048e040ef0071159632d39f3ef6e8a6890 after 3 independent review rounds (record: https://github.com/ByteDeskAI/bytedesk-marketplace/pull/192#issuecomment-5996030129). Not yet on main: the installed ao-topology runs from the main checkout on main (48e58846). Delivery waits on TM-400 (sync main into the fix branch, then fix -> main)."},{"author":"main","ts":"2026-10-08T23:33:39.239Z","text":"Independent review verdict: approved (PR #192, 3 rounds; https://github.com/ByteDeskAI/bytedesk-marketplace/pull/192#issuecomment-5996030129). Landed on main via PR #221 at 44b030d4."},{"author":"main","ts":"2026-10-08T23:48:32.915Z","text":"Consumer confirmation 2026-10-08: bytedesk-agent-browser TM-010 went through 'manage rework' and round 2 is with its reviewer at ef520af (Ines, c1b0c1fd)."}]
evidenceSources: {".bytedesk/task-management/evidence/TM-400-landing.md":{"source":"/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace/.bytedesk/task-management/evidence/TM-400-landing.md","sha256":"d20428878421a129cc1ef6448861e8579c984a5646e1f081efeb64389588b221","bytes":974,"at":"2026-10-08T23:33:38.871Z"}}
closed: "2026-10-08T23:33:39.616Z"
---

Reported by bytedesk-agent-browser lead (Ines, c1b0c1fd), 2026-10-05. Operator (Ryan) asked for high priority.

Problem: there is no rework step after an independent review returns changes_requested. Once the worker files its finish report, management.workerReport sets the record state to ready-for-review, and governance.readyForReview sets task.governance.state to ready-for-review. Nothing ever sets either back to working. governance-check.governedAdmission requires g.state === 'working', so 'tm dispatch' (and 'ao-topology manage start-worker') refuse every new worker with TM_GOVERNED_ADMISSION_REQUIRED. Running 'manage admit' again only returns 'admitted (resumed)' and changes nothing. The review findings can never reach a worker, and the task deadlocks.

Repro: bytedesk-agent-browser TM-010. Admit, start worker, finish report at 29b9e71, reviewer verdict changes_requested (6 findings). Then manage stop-worker (ok) followed by manage start-worker gives TM_GOVERNED_ADMISSION_REQUIRED.

Wanted: a supported, mechanically gated transition from review findings back to working, for example 'ao-topology manage rework --task <id>' (or 'reviewer collect' doing it on changes_requested). It should bind the findings to the reviewed revision, reset record.state and governance.state to working, clear finish/collected, keep owner/worktree/branch, and allow dispatch of a fresh worker. It must never let the old review approve a newer revision. A lead-started manual worker plus 'manage bind' is not an acceptable workaround: auto-mode refuses it.

Release: publish so consumers pick it up via plugin-rsync or /reload-plugins.