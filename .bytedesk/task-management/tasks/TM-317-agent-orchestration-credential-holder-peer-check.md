---
id: "TM-317"
kind: "task"
status: "open"
created: "2026-10-03T04:06:53.939Z"
board: "bytedeskai/bytedesk-marketplace"
title: "agent-orchestration: credential holder peer check is Linux-only; add macOS support and verify on the Mac build host"
epic: "EP-026"
acceptance: [{"text":"Holder refuses a non-descendant caller on macOS, printed","done":false},{"text":"Linux behaviour unchanged, suite green","done":false}]
evidence: []
commits: ["https://github.com/ByteDeskAI/bytedesk-marketplace/pull/179","https://github.com/ByteDeskAI/bytedesk-marketplace/pull/180"]
blockedBy: []
blocks: []
actor: "main"
session: "177a0074-f13b-446a-92db-45e161f580ba"
branch: "fix/ao-local-nats-autostart"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["ready-for-agent"]
triagedBy: "auto"
updated: "2026-10-04T00:58:17.454Z"
comments: [{"author":"main","ts":"2026-10-04T00:58:17.450Z","text":"macOS caller-check code and a manual verification script are on nats/hardening, draft PR https://github.com/ByteDeskAI/bytedesk-marketplace/pull/180. NOT verified on a real Mac: run agent-orchestration/scripts/verify-macos-holder.sh there."}]
---

Holder identifies the caller from ss plus /proc. macOS needs LOCAL_PEERPID/getpeereid or lsof. Verify on the macbook (see infrastructure repo for access).