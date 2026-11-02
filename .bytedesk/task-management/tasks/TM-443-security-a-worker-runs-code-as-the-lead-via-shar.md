---
id: "TM-443"
kind: "task"
status: "done"
created: "2026-10-05T15:35:35.672Z"
board: "bytedeskai/bytedesk-marketplace"
title: "SECURITY a worker runs code as the lead via shared git config (core.fsmonitor, hooksPath, diff.external, pager, filters)"
epic: "EP-028"
acceptance: [{"text":"Every host-side git call goes through one helper with -c core.fsmonitor=false -c core.hooksPath=/dev/null -c core.pager=cat, GIT_CONFIG_NOSYSTEM=1 and --no-ext-diff / no filters","done":true,"at":"2026-10-09T00:58:51.781Z"},{"text":"A test plants core.fsmonitor and each other vector and proves nothing runs during eligibility, integrate and release readiness","done":true,"at":"2026-10-09T00:58:52.182Z"}]
evidence: [".bytedesk/task-management/evidence/TM-443-1791507532595.log"]
commits: ["https://github.com/ByteDeskAI/bytedesk-marketplace/pull/226"]
blockedBy: []
blocks: []
actor: "main"
session: "d82e2db7-2daf-4130-8dff-71d57be2583d"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["ready-for-agent"]
triagedBy: "auto"
updated: "2026-10-09T00:58:52.949Z"
priority: "highest"
comments: [{"author":"main","ts":"2026-10-05T17:20:33.717Z","text":"review verdict: changes requested — https://github.com/ByteDeskAI/bytedesk-marketplace/pull/226 (independent review rv-222: HIGH filter '=' escape, HIGH forged integration ref defeats merge-in, MED worker-defined origin, LOW LFS)"},{"author":"main","ts":"2026-10-05T17:45:45.233Z","text":"review verdict: approved — https://github.com/ByteDeskAI/bytedesk-marketplace/pull/226 @ 63e3c0c6 (independent delta review rv-222: all four findings closed; final hardening round adds record-landing server check, GIT_* env allowlist, gh realpath)"},{"author":"main","ts":"2026-10-05T18:12:55.750Z","text":"review verdict: approved — https://github.com/ByteDeskAI/bytedesk-marketplace/pull/226 @ 7d8ab34e (independent final delta review rv-222; LOW follow-ups TM-475)"},{"author":"review-sweep","ts":"2026-10-06T18:07:01.941Z","text":"review-sweep: PR #226 \"TM-443 TM-444 TM-441 TM-442 TM-430 TM-457 TM-458 TM-459: governance gate security fixes (EP-028, 0.16.1)\" has had no activity for 24h — needs an independent review or a decision."}]
evidenceSources: {".bytedesk/task-management/evidence/TM-443-1791507532595.log":{"source":null,"sha256":"84e1c16a3ee5507badbb078e694e5e9198973613006af10f6385585844b53f61","bytes":198,"at":"2026-10-09T00:58:52.596Z"}}
closed: "2026-10-09T00:58:52.944Z"
---

w-secreview on #216, verified: git config core.fsmonitor /tmp/evil.sh from the worker worktree writes the shared .git/config; the lead's next git status (foreignDirtyPaths, integrationEligibility, releaseReadiness) runs it as the lead's child, passing delegation pane-ancestry checks.