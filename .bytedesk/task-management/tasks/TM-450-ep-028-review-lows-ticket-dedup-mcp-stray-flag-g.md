---
id: "TM-450"
kind: "task"
status: "open"
created: "2026-10-05T15:37:02.615Z"
board: "bytedeskai/bytedesk-marketplace"
title: "EP-028 review LOWs: ticket dedup, MCP stray-flag guard, leftover .env, pool wait conditions, NATS error redaction"
epic: "EP-028"
acceptance: [{"text":"Each of the five is fixed or explicitly rejected with a reason","done":false},{"text":"Tests for each fix","done":false}]
evidence: []
commits: ["https://github.com/ByteDeskAI/bytedesk-marketplace/pull/224"]
blockedBy: []
blocks: []
actor: "main"
session: "d82e2db7-2daf-4130-8dff-71d57be2583d"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["ready-for-agent"]
triagedBy: "auto"
updated: "2026-10-09T00:13:46.870Z"
comments: [{"author":"main","ts":"2026-10-05T16:24:45.726Z","text":"review verdict: approved — #224 @ 7dd1f3f8 covers TM-450 items 1-4; item 5 (NATS error redaction) still open"},{"author":"main","ts":"2026-10-09T00:13:46.866Z","text":"Items 1-4 merged in PR #224 (0c34a357); item 5 (NATS error redaction) still open."}]
---

rv-197 LOW items: (1) ticket dedup key written before send, and auto 'done' vs manual 'done:' keys differ; (2) MCP tm_ticket lacks the CLI stray-'--' title guard (rule 3); (3) launch.mjs removes the 0600 .env only inside if (env.AO_CONSUMER); (4) pool wait --until done never resolves for failed/blocked, --until idle never resolves while paused with poolable tasks; (5) NATS fallback.error / connect error text stored unredacted.