---
id: "TM-273"
kind: "task"
status: "blocked"
created: "2026-10-01T17:21:02.870Z"
board: "bytedeskai/bytedesk-marketplace"
title: "agent-orchestration: macOS workers fall through to the linux-native backend, which launches via systemd-run"
epic: "EP-023"
acceptance: [{"text":"on darwin a worker starts and is tracked without systemd (a darwin backend or a plain detached-process backend)","done":false},{"text":"a unit test proves darwin selects that backend","done":false}]
evidence: []
commits: []
blockedBy: []
blocks: []
actor: "main"
session: "62549d39-62d5-458d-808e-8375ef53518d"
branch: "fix/ao-local-nats-autostart"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
triagedBy: "human"
updated: "2026-10-02T13:11:00.900Z"
comments: [{"author":"main","ts":"2026-10-02T02:30:29.915Z","text":"PR #143 (with TM-277, 0.12.1). darwin-native backend; fails closed (AO_SANDBOX_UNAVAILABLE) until TM-282. Verified on Linux only; not run on a Mac."},{"author":"@dc778cb2","ts":"2026-10-02T13:11:00.895Z","text":"TM-006 audit: AC2 proven; AC1 contradicted — darwin refuses runs with AO_SANDBOX_UNAVAILABLE until TM-282 lands. Kept open until TM-282 and a real Mac run."}]
blockedReason: "awaiting human merge of PR #143 (shipped locally at 737b728e); darwin unverified on a real Mac"
---

src/platform/host-adapters.mjs:13,74 selects linux-native for every non-win32 platform, including darwin, and linux-runtime.mjs launches workers with systemd-run --user --scope, which macOS lacks. Found while planning TM-272.