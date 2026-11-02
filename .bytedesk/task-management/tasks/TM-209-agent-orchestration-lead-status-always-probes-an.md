---
id: "TM-209"
kind: "task"
status: "done"
created: "2026-09-23T22:21:27.766Z"
board: "bytedeskai/bytedesk-marketplace"
title: "agent-orchestration: 'lead status' always probes and can block 30s; add a non-blocking read"
epic: "EP-028"
acceptance: [{"text":"'ao-topology lead status --cached' (or an equivalent documented default) returns in under 1s and writes no probe file.","done":true,"at":"2026-10-05T13:16:53.632Z"},{"text":"The output includes proof_age_ms and the source of the verdict (cached, late, fresh probe).","done":true,"at":"2026-10-05T13:16:53.983Z"},{"text":"The blocking behaviour that remains is documented in the CLI help, and a test asserts no probe file is created by the cached path.","done":true,"at":"2026-10-05T13:16:54.310Z"}]
evidence: [".bytedesk/task-management/evidence/TM-209-1791206214648.log"]
commits: ["https://github.com/ByteDeskAI/bytedesk-marketplace/pull/193"]
blockedBy: []
blocks: []
actor: "main"
session: "d82e2db7-2daf-4130-8dff-71d57be2583d"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["ready-for-agent","plugin:agent-orchestration"]
triagedBy: "auto"
updated: "2026-10-05T15:54:49.454Z"
evidenceSources: {".bytedesk/task-management/evidence/TM-209-1791206214648.log":{"source":null,"sha256":"132496feba4aab4462a78ad785871d20c5cc93b00263a6b7174923e5acefd234","bytes":266,"at":"2026-10-05T13:16:54.649Z"}}
closed: "2026-10-05T13:16:55.016Z"
comments: [{"author":"review-sweep","ts":"2026-10-05T15:18:08.422Z","text":"review-sweep: TM-209 is done with commits and no reviewer verdict — needs an independent review or a decision."},{"author":"review-sweep","ts":"2026-10-05T15:18:22.552Z","text":"review-sweep: TM-209 is done with commits and no reviewer verdict — needs an independent review or a decision."},{"author":"main","ts":"2026-10-05T15:54:49.449Z","text":"review verdict: changes requested — https://github.com/ByteDeskAI/bytedesk-marketplace/pull/193 (independent post-merge review rv-193: all ACs met; test isolation TM-464, MCP identity TM-466, forgeability noted on TM-427)"}]
---

topology/cli.mjs:486 calls leadState without a timeout, so it uses DEFAULT_ACK_TIMEOUT_MS 30000 (lead.mjs:58, 302) and, with no stored proof, polls to the deadline (lead.mjs:164-173). The readOnly flag added in 570a6bb is never passed by the CLI. The observer measured its own poll loop stretching from 62s to 97s per cycle because of this, and each status call also mints a probe that can ring the lead's pane.