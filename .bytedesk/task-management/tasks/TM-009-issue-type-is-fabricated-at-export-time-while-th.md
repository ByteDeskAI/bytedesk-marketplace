---
id: "TM-009"
kind: "task"
status: "done"
created: "2026-07-29T23:08:51.120Z"
title: "Issue Type is fabricated at export time while the templates already know the answer"
epic: "EP-002"
acceptance: []
evidence: []
commits: ["https://github.com/ByteDeskAI/bytedesk-marketplace/pull/67"]
blockedBy: []
blocks: []
actor: "main"
branch: "feat/task-management-plugin"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
updated: "2026-07-30T00:37:42.403Z"
labels: ["jira-parity","rank-07"]
priority: "medium"
comments: [{"author":"main","ts":"2026-07-29T23:08:51.232Z","text":"Build plan (from the ranked survey): lib/issue.mjs, copying prioritise() (issue.mjs:66-75) verbatim in shape: export const TYPES = ['task','bug','story','spike','chore'] and setType(id, value) → validate, update(id, {type}), logEvent('type', …). The store is genuinely free-form — create spreads ...fields (store.mjs:411), list returns {...data} (:464), reindex copies everything but body/file (:479) — so index.json and the board pick the field up with zero plumbing. | type: on the three STARTERS in lib/templates.mjs (keep their labels; applyTemplate's caller-wins merge needs no change). tm type <id> <value> in VERBS, one line in the help block at bin/tm:850-852, one in renderShow near bin/tm:874. | Both exporters read t.type ?? (t.parent ? 'Sub-task' : 'Task') at export.mjs:97 and the same mapping for issue_type at :220 — Jira's sub-task is structural, so parent still wins for that one value. Put that reasoning in a comment i"},{"author":"main","ts":"2026-07-29T23:08:51.273Z","text":"Watch out for: The typed-by-label auto-fix removes a label a human may have meant as a plain tag — it must fire only on an exact vocabulary match with type unset. Keep the template labels in place so no existing filter or saved view breaks. Pick five names and let a label carry anything else; story vs feature is not worth a thread. This touches ten files with tiny diffs each — small per file, medium to review."}]
closed: "2026-07-30T00:37:42.402Z"
---

