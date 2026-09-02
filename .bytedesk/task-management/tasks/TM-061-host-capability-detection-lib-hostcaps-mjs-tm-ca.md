---
id: "TM-061"
kind: "task"
status: "done"
created: "2026-09-02T06:55:40.104Z"
board: "bytedeskai/bytedesk-marketplace"
title: "Host capability detection (lib/hostcaps.mjs + tm caps)"
epic: "EP-007"
acceptance: [{"text":"`tm caps --json` reports each backend (orchestration, fleet, tmux, manual) as available/unavailable with a reason","done":true,"at":"2026-09-02T07:26:15.792Z"},{"text":"hostcaps never throws on a bare machine (no tmux, no sibling plugins, no sandbox deps)","done":true,"at":"2026-09-02T07:26:15.889Z"},{"text":"unit tests stub PATH/probers and cover each detection branch","done":true,"at":"2026-09-02T07:26:15.991Z"}]
evidence: [".bytedesk/task-management/evidence/TM-061-tm061.log",".bytedesk/task-management/evidence/TM-061-waveA-full.log"]
commits: []
blockedBy: []
blocks: ["TM-062"]
actor: "main"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
updated: "2026-09-02T07:26:17.562Z"
touches: ["task-management/lib/hostcaps.mjs","task-management/tests/unit/hostcaps.test.mjs"]
labels: ["ready-for-agent"]
closed: "2026-09-02T07:26:17.558Z"
---

