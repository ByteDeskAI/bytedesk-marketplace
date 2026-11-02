---
id: "TM-239"
kind: "task"
status: "open"
created: "2026-09-24T23:37:53.009Z"
board: "bytedeskai/bytedesk-marketplace"
title: "task-management: worker PR-base guard misses attached -fVALUE fields and GraphQL PR mutations, and blocks a correct REST base"
epic: "EP-021"
acceptance: [{"text":"Attached forms -fbase=x, -Fbase=x, --field=base=x and --raw-field=base=x are parsed like their spaced forms, by both ghApiRequest and ghApiMutates.","done":false},{"text":"gh api graphql calls whose query contains a createPullRequest or updatePullRequest mutation with a baseRefName other than the integration branch are refused; a query with no such mutation is allowed.","done":false},{"text":"A REST pulls write whose base equals the integration branch is allowed; a different base is refused.","done":false},{"text":"worker-guard tests cover each case, including the allowed controls.","done":false}]
evidence: []
commits: []
blockedBy: []
blocks: []
actor: "main"
session: "40645e47-066b-4937-abc2-55d42e9ea247"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["ready-for-agent","plugin:task-management"]
triagedBy: "auto"
updated: "2026-10-02T05:13:41.253Z"
priority: "medium"
comments: [{"author":"main","ts":"2026-10-02T05:13:40.935Z","text":"TM-288 board review (approved by Ryan 2026-10-02): unblocked. TM-235 is done. All three guard defects are still present in worker-guard.mjs:113, :136."}]
---

Follow-up from TM-235 review round 2 (PR 125 at 22c6e24, approved). All three are narrow; each was found by running guardCommand. (1) 'gh api -X PATCH repos/o/r/pulls/3 -fbase=main' is ALLOWED: ghApiRequest does not parse the attached -fVALUE/-FVALUE form, and ghApiMutates shares that parser, so the mutation check has the same blind spot. (2) 'gh api graphql -f query="mutation{updatePullRequest(input:{...baseRefName:\"main\"})}"' is ALLOWED, and createPullRequest would be too. (3) Overblock: a gh api PATCH on pulls with '-f base=develop' (the correct base) is refused, because the rule checks that a base field is present, not its value.