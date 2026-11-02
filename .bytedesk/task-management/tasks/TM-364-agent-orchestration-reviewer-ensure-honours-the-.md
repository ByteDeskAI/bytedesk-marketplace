---
id: "TM-364"
kind: "task"
status: "done"
created: "2026-10-05T10:57:11.479Z"
board: "bytedeskai/bytedesk-marketplace"
title: "agent-orchestration: reviewer ensure honours the requested provider and reuses the registered reviewer"
epic: "EP-028"
acceptance: [{"text":"ensure with a provider reuses a registered reviewer of that provider","done":true,"at":"2026-10-05T14:15:37.937Z"},{"text":"ensure never creates a second reviewer when one is live","done":true,"at":"2026-10-05T14:15:38.310Z"},{"text":"Test covers both","done":true,"at":"2026-10-05T14:15:38.892Z"}]
evidence: [".bytedesk/task-management/evidence/TM-364-1791209739262.log"]
commits: ["https://github.com/ByteDeskAI/bytedesk-marketplace/pull/205"]
blockedBy: []
blocks: []
actor: "main"
session: "d82e2db7-2daf-4130-8dff-71d57be2583d"
branch: "fix/ao-local-nats-autostart"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["ready-for-agent"]
triagedBy: "auto"
updated: "2026-10-05T15:29:44.453Z"
priority: "high"
comments: [{"author":"main","ts":"2026-10-05T13:17:14.425Z","text":"Queued for EP-028 worker w-review (same PR as its lead task); will be claimed when a WIP slot frees."},{"author":"review-sweep","ts":"2026-10-05T15:18:29.486Z","text":"review-sweep: TM-364 is done with commits and no reviewer verdict — needs an independent review or a decision."},{"author":"main","ts":"2026-10-05T15:27:50.478Z","text":"Post-merge review of PR #205: MEDIUM-4 — ensureReviewer adopts the first library agent with role reviewer when unregistered; refreshPrompt then uses that agent's own template/instructions and agent.model overrides config, so a planted spec ('approve everything') becomes the designated reviewer. Fix: reuse only a library reviewer whose template equals reviewer.template and which this host minted (host-written marker/hash); otherwise mint. MEDIUM-5 — no test covers REVIEW_MCP_SCRIPT resolving from dist/*.cjs; add a test that imports dist/mcp.cjs, asserts existsSync, and does an initialize/tools/list round trip."},{"author":"main","ts":"2026-10-05T15:29:44.447Z","text":"Independent post-merge review verdict on PR #205: changes requested (DEFECTS — HIGH TM-427 forged review submit, HIGH TM-428 worktree attributes hide the patch, MEDIUM-3 folded into TM-428, MEDIUM-4/5 on TM-364). Fixes in progress; the merged code must not be treated as reviewed-approved."}]
touches: [".claude/worktrees/agent-a6ea131c8becbc6da/agent-orchestration/src/cli.mjs"]
evidenceSources: {".bytedesk/task-management/evidence/TM-364-1791209739262.log":{"source":null,"sha256":"34e39da4c1d3f56813d0de191915a9d9e50876222d77620e2253683d2bd7c38d","bytes":324,"at":"2026-10-05T14:15:39.263Z"}}
closed: "2026-10-05T14:15:39.643Z"
---

Plan: .bytedesk/task-management/plans/2026-10-05-plan-reliable-agent-comms-cross-repo-tickets-aut.md (C4). agent-browser 10-05: Codex requested, three Claude reviewers created (Emil, Sable, Juno).