---
id: "TM-007"
kind: "task"
status: "done"
created: "2026-07-29T23:08:50.607Z"
title: "The board collects a markdown body and throws it away, and no HTTP route can read a task's detail"
epic: "EP-002"
acceptance: []
evidence: []
commits: ["https://github.com/ByteDeskAI/bytedesk-marketplace/pull/64","pr"]
blockedBy: []
blocks: ["TM-008"]
actor: "main"
branch: "feat/task-management-plugin"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
updated: "2026-07-31T03:50:39.014Z"
labels: ["ux","rank-05"]
priority: "medium"
comments: [{"author":"main","ts":"2026-07-29T23:08:50.725Z","text":"Build plan (from the ranked survey): The defect first, or the new body pane renders blank for exactly the tasks the board created: add body to the payload at dashboard/src/components/CreateModal.tsx:32 and to the create: payload type at dashboard/src/api.ts:39. One line each. | GET /api/task/:id in handleWrite (lib/dashboard-api.mjs:44): the regex route at :50 already parses id+action and requireTask (:37) already 404s, but GET falls through to fail(405) at :59 — add if (method === 'GET' && !action) return ok(...) returning read(id, p) minus file, body included. | bin/tm-dashboard forwards exactly one GET into handleWrite (if (req.url === '/api/backlog') at line 154) — add a branch matching /^\\/api\\/task\\/[^/]+$/ and forward it, or the request 200s the SPA shell instead. Bodies stay OUT of boardPayload (which strips them at dashboard-api.mjs:226-227): a 200-task poll every 15s must not carry every description, so detail is"},{"author":"main","ts":"2026-07-29T23:08:50.771Z","text":"Watch out for: Markdown renders as pre-wrap text, not parsed HTML — no new dependency, no XSS surface; a renderer is the upgrade path, never a hand-rolled parser. Do NOT add the guarded store-file read (readInside) for evidence files or the epic plan relpath (written at bin/tm:1146 and :1150) in this PR: that is a new HTTP surface streaming arbitrary store files and it must not share a review with six layout changes. @compiled extracts statically, so any expanded/collapsed styling uses the css={[base, open &&"}]
closed: "2026-07-30T00:11:58.290Z"
---

