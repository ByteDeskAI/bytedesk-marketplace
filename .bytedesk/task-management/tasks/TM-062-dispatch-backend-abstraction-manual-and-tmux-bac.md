---
id: "TM-062"
kind: "task"
status: "done"
created: "2026-09-02T06:55:55.925Z"
board: "bytedeskai/bytedesk-marketplace"
title: "Dispatch backend abstraction + manual and tmux backends"
epic: "EP-007"
acceptance: [{"text":"backend interface lib/dispatch/backend.mjs with {name, available(caps), spawn(req)} and registry","done":true,"at":"2026-09-02T07:26:16.186Z"},{"text":"manual backend preserves today's tm parallel print-the-command behavior as the always-available floor","done":true,"at":"2026-09-02T07:26:16.283Z"},{"text":"tmux backend starts a detached session per task in the provisioned worktree, prompt via load-buffer, argv-only spawn (shell:false), TM_SESSION_ID/TM_ACTOR injected","done":true,"at":"2026-09-02T07:26:16.383Z"},{"text":"dispatch refuses with holder named when claim is held; refused claim leaves nothing on disk","done":true,"at":"2026-09-02T07:26:16.482Z"}]
evidence: [".bytedesk/task-management/evidence/TM-062-tm062.log",".bytedesk/task-management/evidence/TM-062-waveA-full.log"]
commits: []
blockedBy: ["TM-061"]
blocks: ["TM-063"]
actor: "main"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
updated: "2026-09-02T07:26:17.685Z"
touches: ["task-management/lib/dispatch/backend.mjs","task-management/lib/dispatch/index.mjs","task-management/lib/dispatch/manual.mjs","task-management/lib/dispatch/tmux.mjs","task-management/tests/unit/dispatch.test.mjs"]
labels: ["ready-for-agent"]
closed: "2026-09-02T07:26:17.682Z"
---

