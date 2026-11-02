---
id: "TM-349"
kind: "task"
status: "done"
created: "2026-10-05T10:53:02.836Z"
board: "bytedeskai/bytedesk-marketplace"
title: "agent-orchestration: a late manage admit records the worker's own commit as base_revision, hiding it from review"
epic: "EP-026"
acceptance: [{"text":"admit (fresh or adopting an existing worktree with commits) records base_revision = merge-base(HEAD, integration branch ref), not HEAD; fresh worktree behaviour is unchanged (merge-base == HEAD)","done":true,"at":"2026-10-05T14:02:07.403Z"},{"text":"Base resolution fails closed (refuses admit with a clear code) when the integration ref cannot be resolved, rather than falling back to HEAD silently","done":true,"at":"2026-10-05T14:02:07.769Z"},{"text":"Unit test: worktree with one own commit before admit, then merge of the integration branch, then finish -> base is the pre-commit merge-base and the review range contains the own commit; the test fails against the old code","done":true,"at":"2026-10-05T14:02:08.127Z"},{"text":"Landed on the marketplace default branch; merge commit reported to c1b0c1fd","done":true,"at":"2026-10-08T23:33:43.350Z"}]
evidence: [".bytedesk/task-management/evidence/TM-400-landing.md"]
commits: ["https://github.com/ByteDeskAI/bytedesk-marketplace/pull/192","https://github.com/ByteDeskAI/bytedesk-marketplace/pull/221"]
blockedBy: ["TM-400"]
blocks: ["TM-350","TM-383","TM-393"]
actor: "main"
session: "253de95a-5b3d-4702-b941-9b7ba0507f01"
branch: "fix/ao-local-nats-autostart"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["ready-for-agent"]
triagedBy: "auto"
updated: "2026-10-08T23:33:44.628Z"
comments: [{"author":"main","ts":"2026-10-05T12:49:45.849Z","text":"Worker done at b61b096c (tm/TM-347-348-349-rework-admit-base). Lead reran checks: AO test:unit exit 0 (1049 pass/0 fail/4 skip), build:check exit 0, tm unit exit 0 (1603/1603). PR #192 -> fix/ao-local-nats-autostart; independent review running."},{"author":"main","ts":"2026-10-05T12:57:00.464Z","text":"PR #192 review round 1 CHANGES_REQUESTED: base resolved from worker-writable local refs (update-ref attack gives base = worker commit, permanently unreviewed). Fix requested: server-anchored compare merge_base; PR base only when it matches the recorded/target branch; offline = oldest merge-base across candidates, recorded as base_source."},{"author":"main","ts":"2026-10-05T14:02:08.485Z","text":"PR #192 merged into fix/ao-local-nats-autostart at 08fb40048e040ef0071159632d39f3ef6e8a6890 after 3 independent review rounds (record: https://github.com/ByteDeskAI/bytedesk-marketplace/pull/192#issuecomment-5996030129). Not yet on main: the installed ao-topology runs from the main checkout on main (48e58846). Delivery waits on TM-400 (sync main into the fix branch, then fix -> main)."},{"author":"main","ts":"2026-10-08T23:33:44.165Z","text":"Independent review verdict: approved (PR #192, 3 rounds; https://github.com/ByteDeskAI/bytedesk-marketplace/pull/192#issuecomment-5996030129). Landed on main via PR #221 at 44b030d4."}]
evidenceSources: {".bytedesk/task-management/evidence/TM-400-landing.md":{"source":"/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace/.bytedesk/task-management/evidence/TM-400-landing.md","sha256":"d20428878421a129cc1ef6448861e8579c984a5646e1f081efeb64389588b221","bytes":974,"at":"2026-10-08T23:33:43.765Z"}}
closed: "2026-10-08T23:33:44.622Z"
---

Reported by bytedesk-agent-browser lead (Ines, c1b0c1fd) 2026-10-05; repro agent-browser TM-030. admitTask (management.mjs ~386) sets record.base_revision = rev-parse HEAD of the worktree. When admit runs after the worker already committed (d373c57 on 8810b7f), the base is the worker's own commit; after merging origin/main the finish at 796cf1a makes reviewer request refuse TOPOLOGY_REVIEWER_RANGE ('server merge-base is not between the admitted task base and the revision'), and the range would hide the implementation anyway. Base must be the merge-base of HEAD with the integration branch (the TM-325 admission-record integration branch / PR base), so the review covers every task-owned commit.