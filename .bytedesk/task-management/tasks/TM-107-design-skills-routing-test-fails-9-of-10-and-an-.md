---
id: "TM-107"
kind: "task"
status: "done"
created: "2026-09-05T12:44:45.147Z"
board: "bytedeskai/bytedesk-marketplace"
title: "design-skills routing test fails 9 of 10, and an uncommitted change would wire it into CI"
epic: "EP-015"
acceptance: [{"text":"The routing test passes, or is removed if it no longer describes intended routing","done":true,"at":"2026-09-05T14:14:24.811Z"},{"text":"The workflow either runs it or does not, as a committed decision rather than an uncommitted edit","done":true,"at":"2026-09-05T14:14:24.937Z"}]
evidence: [".bytedesk/task-management/evidence/TM-107-marketplace.yml",".bytedesk/task-management/evidence/TM-107-routing.test.mjs"]
commits: ["320bf43"]
blockedBy: []
blocks: []
actor: "main"
session: "4e1d7087-d606-432e-9341-3ce779b4baf8"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
updated: "2026-09-05T14:14:33.791Z"
type: "bug"
priority: "medium"
comments: [{"author":"main","ts":"2026-09-05T14:14:30.300Z","text":"Reconciled rather than fixed: commit b055e18 (on origin/main) restored the agent catalog and the routing selector, and both halves of this task went with it. The test now passes 10 of 10 (`node --test design-skills/agents/validation/routing.test.mjs`), and the workflow line that was an uncommitted local edit is committed at .github/workflows/marketplace.yml:31 — the Marketplace run for that merge (33968462751) is green on main, so it is a committed decision that CI actually honours."}]
closed: "2026-09-05T14:14:33.786Z"
---

Noticed while finishing EP-013, not caused by it. design-skills/agents/validation/routing.test.mjs fails 9 of its 10 cases (agent counts and profile-architect-native routing both disagree with the fixtures). Separately, .github/workflows/marketplace.yml has an UNCOMMITTED local line adding 'node --test design-skills/agents/validation/routing.test.mjs' to the marketplace workflow. origin/main does not have that line and no commit contains it.

Committing it as-is would turn the marketplace CI red on every push. I have deliberately left the working-tree change alone rather than reverting someone else's edit or staging it - my commits stage paths explicitly so it is not swept in.

Either the test's fixtures are stale against the current agent set, or the routing changed and the test is the thing that is right. Whoever wrote the test knows which; the workflow line should land only once it passes.