---
id: "TM-430"
kind: "task"
status: "open"
created: "2026-10-05T15:28:15.486Z"
board: "bytedeskai/bytedesk-marketplace"
title: "agent-orchestration: check evidence must match the configured command for its check name"
epic: "EP-028"
acceptance: [{"text":"Evidence whose command differs from the configured argv for that check does not satisfy it (test)","done":false},{"text":"Finish-report and --checks paths share the comparison","done":false}]
evidence: []
commits: ["https://github.com/ByteDeskAI/bytedesk-marketplace/pull/226","https://github.com/ByteDeskAI/bytedesk-marketplace/pull/new/release/agent-orchestration-0.16.1"]
blockedBy: []
blocks: []
actor: "main"
session: "d82e2db7-2daf-4130-8dff-71d57be2583d"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["ready-for-agent"]
triagedBy: "auto"
updated: "2026-10-09T01:21:47.515Z"
comments: [{"author":"main","ts":"2026-10-05T15:35:39.834Z","text":"Raised by security review (w-secreview, MEDIUM-1): beyond the argv mismatch, worker check evidence is entirely self-reported and under integrate_via pull-request is the ONLY check gate. Scope: worker evidence is labelled 'claimed' and never satisfies required checks; only a lead/host run of the configured argv counts."},{"author":"main","ts":"2026-10-05T17:20:34.453Z","text":"review verdict: changes requested — https://github.com/ByteDeskAI/bytedesk-marketplace/pull/226 (independent review rv-222: HIGH filter '=' escape, HIGH forged integration ref defeats merge-in, MED worker-defined origin, LOW LFS)"},{"author":"main","ts":"2026-10-05T17:45:46.039Z","text":"review verdict: approved — https://github.com/ByteDeskAI/bytedesk-marketplace/pull/226 @ 63e3c0c6 (independent delta review rv-222: all four findings closed; final hardening round adds record-landing server check, GIT_* env allowlist, gh realpath)"},{"author":"main","ts":"2026-10-05T18:12:56.586Z","text":"review verdict: approved — https://github.com/ByteDeskAI/bytedesk-marketplace/pull/226 @ 7d8ab34e (independent final delta review rv-222; LOW follow-ups TM-475)"},{"author":"main","ts":"2026-10-09T00:59:09.437Z","text":"Integration side merged in PR #226 (0110e0b7): worker check runs are labelled claimed and the host runs required checks in a fresh worktree. Remaining: the reviewer checklist (unsatisfiedChecks/checkEvidenceReasons in reviewer.mjs, marketplace lead's TM-427/428 work) must ignore claimed runs and compare command to argv."}]
---

From TM-418: a worker's check run is self-reported; nothing verifies its command matches management.required_checks argv for that name. Compare in unsatisfiedChecks for both the finish-report and lead --checks paths.