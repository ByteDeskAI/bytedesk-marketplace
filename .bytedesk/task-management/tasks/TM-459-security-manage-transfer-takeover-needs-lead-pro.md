---
id: "TM-459"
kind: "task"
status: "done"
created: "2026-10-05T15:50:15.577Z"
board: "bytedeskai/bytedesk-marketplace"
title: "SECURITY manage transfer takeover needs lead proof and owner absence"
epic: "EP-028"
acceptance: [{"text":"Takeover requires the caller to pass requireLeadCaller","done":true,"at":"2026-10-09T00:59:01.283Z"},{"text":"Takeover requires proof the owner is absent (no live lead pane/heartbeat), not just a released claim","done":true,"at":"2026-10-09T00:59:01.716Z"},{"text":"Tests cover a live owner with a released claim","done":true,"at":"2026-10-09T00:59:02.075Z"}]
evidence: [".bytedesk/task-management/evidence/TM-459-1791507542484.log"]
commits: ["https://github.com/ByteDeskAI/bytedesk-marketplace/pull/226"]
blockedBy: []
blocks: []
actor: "main"
session: "d82e2db7-2daf-4130-8dff-71d57be2583d"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["ready-for-agent"]
triagedBy: "auto"
updated: "2026-10-09T00:59:02.877Z"
priority: "high"
comments: [{"author":"main","ts":"2026-10-05T17:20:35.485Z","text":"review verdict: changes requested — https://github.com/ByteDeskAI/bytedesk-marketplace/pull/226 (independent review rv-222: HIGH filter '=' escape, HIGH forged integration ref defeats merge-in, MED worker-defined origin, LOW LFS)"},{"author":"main","ts":"2026-10-05T17:45:47.122Z","text":"review verdict: approved — https://github.com/ByteDeskAI/bytedesk-marketplace/pull/226 @ 63e3c0c6 (independent delta review rv-222: all four findings closed; final hardening round adds record-landing server check, GIT_* env allowlist, gh realpath)"},{"author":"main","ts":"2026-10-05T18:12:57.617Z","text":"review verdict: approved — https://github.com/ByteDeskAI/bytedesk-marketplace/pull/226 @ 7d8ab34e (independent final delta review rv-222; LOW follow-ups TM-475)"}]
evidenceSources: {".bytedesk/task-management/evidence/TM-459-1791507542484.log":{"source":null,"sha256":"84e1c16a3ee5507badbb078e694e5e9198973613006af10f6385585844b53f61","bytes":198,"at":"2026-10-09T00:59:02.496Z"}}
closed: "2026-10-09T00:59:02.871Z"
---

rv-gov on #215: transferTask takeover only needs the owner to hold no live claim; tm block or park releases the claim while the lead is alive, so any session with its own TM_SESSION_ID can take ownership.