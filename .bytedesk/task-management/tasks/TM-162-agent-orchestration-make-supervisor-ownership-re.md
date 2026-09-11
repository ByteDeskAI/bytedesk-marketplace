---
id: "TM-162"
kind: "task"
status: "done"
created: "2026-09-10T20:59:07.748Z"
board: "bytedeskai/bytedesk-marketplace"
title: "agent-orchestration: make supervisor ownership records authoritative"
epic: "EP-019"
acceptance: [{"text":"The live lifetime-lock owner and process record identify the same PID, process identity, token, canonical consumer, and source.","done":true,"at":"2026-09-10T21:09:18.131Z"},{"text":"A losing supervisor cannot overwrite or retire the winner's process record.","done":true,"at":"2026-09-10T21:09:18.313Z"},{"text":"Linked-worktree contention and legacy stale-owner diagnosis are covered by tests.","done":true,"at":"2026-09-10T21:09:18.481Z"},{"text":"The current stale supervisor is replaced only after exact owner identity verification.","done":true,"at":"2026-09-10T21:09:18.627Z"}]
evidence: [".bytedesk/task-management/evidence/TM-162-topology-supervision.test.mjs",".bytedesk/task-management/evidence/TM-162-topology-lockfile.test.mjs",".bytedesk/task-management/evidence/TM-162-topology-repoid.test.mjs"]
commits: ["119006c"]
blockedBy: []
blocks: ["TM-164"]
actor: "main"
session: "01a088d4-54f3-7781-a6df-8860bd57ba9a"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
updated: "2026-09-11T18:22:08.229Z"
labels: ["ready-for-agent"]
type: "bug"
touches: ["agent-orchestration/tests/unit/topology-supervision-consistency.test.mjs","agent-orchestration/tests/unit/topology-supervision.test.mjs","agent-orchestration/topology/lib/doctor.mjs","agent-orchestration/topology/lib/lockfile.mjs","agent-orchestration/topology/lib/repoid.mjs","agent-orchestration/topology/lib/supervision.mjs"]
evidenceSources: {".bytedesk/task-management/evidence/TM-162-topology-supervision.test.mjs":{"source":"/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace/agent-orchestration/tests/unit/topology-supervision.test.mjs","sha256":"90854fc597ffdb3f6b7938fd3afa443b1204707c290cd36080c6c6dd3ceecf75","bytes":18826,"at":"2026-09-10T21:09:17.405Z"},".bytedesk/task-management/evidence/TM-162-topology-lockfile.test.mjs":{"source":"/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace/agent-orchestration/tests/unit/topology-lockfile.test.mjs","sha256":"0c692a8b2b9dede54a76293ce4d0fd4505d48ce8ffd176767f0dde781800c6f3","bytes":6771,"at":"2026-09-10T21:09:17.702Z"},".bytedesk/task-management/evidence/TM-162-topology-repoid.test.mjs":{"source":"/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace/agent-orchestration/tests/unit/topology-repoid.test.mjs","sha256":"a5edcdc023f4fb1fdc3e3223d8da5f024269882b99909f5286da1d5e883d73a6","bytes":2692,"at":"2026-09-10T21:09:17.941Z"}}
closed: "2026-09-10T21:09:18.763Z"
---

Fix repository supervision so the lifetime-lock winner is the only process allowed to publish the authoritative process record. Normalize repository-scoped consumers, record exact process and source identity, preserve loser non-authority, and make doctor report the actual owner.