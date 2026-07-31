---
id: "TM-008"
kind: "task"
status: "done"
created: "2026-07-29T23:08:50.821Z"
title: "Dependency writes are the one mutation with no lib/ function, log no event, and cannot be undone — and the boa"
epic: "EP-002"
acceptance: []
evidence: []
commits: ["https://github.com/ByteDeskAI/bytedesk-marketplace/pull/66"]
blockedBy: ["TM-007"]
blocks: []
actor: "main"
branch: "feat/task-management-plugin"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
updated: "2026-07-30T00:29:51.875Z"
labels: ["ux","rank-06"]
priority: "medium"
comments: [{"author":"main","ts":"2026-07-29T23:08:50.942Z","text":"Build plan (from the ranked survey): deps(id, { add = [], remove = [] }, p) in lib/issue.mjs, in the shape addLink (issue.mjs:106) already uses for two-sided writes: both ends through mutate(), removals mirrored off the other end's blocks, then logEvent('dep', { id, add, remove }, p). | The removal branch must not hand-roll reopening: reuse the two predicates unblockDependents is built on — blockedByDependency and dependenciesMet (lib/store.mjs:501-511) — so a task left blocked with nothing blocking it returns to open. Otherwise doctor's stuck-blocked (doctor.mjs:123) fires the moment the feature is used. | bin/tm:334-345 becomes a call to deps() with the leading-dash removal convention tm label already documents (README:85) and label() implements at bin/tm:536-541 — that is undep for free. Update the help line at bin/tm:850. | case 'dep': return ok({ blockedBy: deps(id, { add: payload.add || [], remove: payload.remove || ["},{"author":"main","ts":"2026-07-29T23:08:50.981Z","text":"Watch out for: Do not put a transitive-root tooltip on the card's ⊘ lozenge (TaskCard.tsx:211) — boardPayload carries only blockedBy, and the root comes from why(), so a tooltip per blocked card means a fetch per card or a graph walk added to the 15s poll. Cutting it is what keeps this one reviewable PR."},{"author":"main","ts":"2026-07-29T23:08:51.070Z","text":"Blocked by: Rank 5 — it lands the  branch in  plus its forwarding branch in bin/tm-dashboard that  copies, and the drawer section layout the chain sits inside."},{"author":"main","ts":"2026-07-29T23:09:12.553Z","text":"Blocked by rank 5 (TM-007): it lands the GET /api/task/:id branch in handleWrite that this builds on."}]
closed: "2026-07-30T00:29:51.875Z"
---

