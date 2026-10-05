---
id: "TM-220"
kind: "task"
status: "open"
created: "2026-09-24T20:42:02.627Z"
board: "bytedeskai/bytedesk-marketplace"
title: "agent-orchestration reviewer: refuse to collect a failed request; mention note in approve refusal"
epic: "EP-019"
acceptance: [{"text":"collectReview refuses a failed request without escalating again; unit test","done":true,"at":"2026-10-02T13:53:23.639Z"},{"text":"Approve refusal message names minor, nit and note","done":true,"at":"2026-10-02T13:53:24.280Z"},{"text":"the NATS collect path (reviewer.mjs:1266-1272) also refuses a failed request without escalating again; unit test","done":true,"at":"2026-10-02T13:53:24.961Z"}]
evidence: [".bytedesk/task-management/evidence/TM-220-reviewer-findings.txt"]
commits: ["77070208","https://github.com/ByteDeskAI/bytedesk-marketplace/pull/152"]
blockedBy: []
blocks: []
actor: "main"
session: "1b07de2e-6b73-47c6-ad14-aa29eeea67fd"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["ready-for-agent"]
triagedBy: "auto"
updated: "2026-10-02T13:53:35.979Z"
comments: [{"author":"main","ts":"2026-09-24T21:27:52.059Z","text":"Add to reviewer follow-ups: reviewer.md must tell the reviewer to escape double quotes inside JSON strings (or use single quotes when quoting code). 2026-09-24 Cleo's TM-444 approval (nonce b73a0c42) was invalid JSON because evidence quoted a code comment with bare \" characters; collection correctly refused it."},{"author":"main","ts":"2026-10-02T05:14:47.359Z","text":"TM-288 board review (approved by Ryan 2026-10-02): scope widened: the new NATS collect path (reviewer.mjs:1266-1272) also lacks the failed-request guard. Added an AC covering it."},{"author":"@dc778cb2","ts":"2026-10-02T12:38:30.780Z","text":"Scheduled with TM-195 (Bastion TM-003): the same worker covers all three ACs, including the NATS collect-path guard."},{"author":"@main","ts":"2026-10-02T13:53:35.974Z","text":"Delivered with TM-195 in PR #152 (770702086b44). All three ACs covered by tests in topology-reviewer-findings.test.mjs; see TM-195 READY-FOR-REVIEW."}]
links: [{"type":"relates to","id":"TM-195"}]
evidenceSources: {".bytedesk/task-management/evidence/TM-220-reviewer-findings.txt":{"source":"/tmp/tm195-evidence/reviewer-findings.txt","sha256":"97e9579e8edccbc6a8e6f249ce2ab25b05a2dc8712aaa820087245e465f22b92","bytes":6885,"at":"2026-10-02T13:53:22.973Z"}}
---

From Faro's recorded TM-215 approval (nonce b0d19bf7). (1) minor, reviewer.mjs ~960: collectReview has no guard for a request in state failed; ao-topology reviewer collect (cli.mjs:434) can re-parse it, escalating again or, once the refused copy scrolls out, recording a verdict under the failed nonce. Refuse collection of failed requests. (2) nit, reviewer.mjs ~713: the approve refusal message lists minor or nit but not note.