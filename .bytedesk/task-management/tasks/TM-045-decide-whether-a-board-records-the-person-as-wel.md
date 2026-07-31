---
id: "TM-045"
kind: "task"
status: "done"
created: "2026-07-31T05:23:36.539Z"
board: "bytedeskai/bytedesk-marketplace"
title: "Decide whether a board records the person as well as the repo"
epic: "EP-004"
acceptance: [{"text":"The question is answered in writing, either way, with the reason","done":true,"at":"2026-07-31T05:38:17.462Z"},{"text":"If a person is recorded, it is a separate field from the board and does not weaken TM-036's guard","done":true,"at":"2026-07-31T05:38:17.529Z"}]
evidence: [".bytedesk/task-management/evidence/TM-045-ADR-0002-a-board-is-a-repo-the-person-is-recorded-beside-.md"]
commits: ["6c9e01a"]
blockedBy: []
blocks: []
actor: "main"
session: "61c67728-2ff2-46ea-87eb-2a99db9c96bd"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
updated: "2026-07-31T05:38:40.941Z"
comments: [{"author":"main","ts":"2026-07-31T05:38:26.143Z","text":"Decided in ADR-0002: the board is the repo, the person is recorded beside it. Keying identity on git user.name/email would make bytedesk-persona and bytedesk-marketplace the same board — they share one git user — and re-open the leak TM-036 closed, with tests to prove it. So boardId stays owner/name from the origin remote, and a new owner field records git's user for the store's directory. Read-only for the same reason boardId is: derived, so writing it changes a file and nothing else. One deliberate asymmetry: a board keeps the owner recorded at init rather than re-labelling for each person who opens it, and owner drift is not reported — unlike boardId drift, which re-labels every entity. owner is a fact, not access control."}]
closed: "2026-07-31T05:38:26.201Z"
links: [{"type":"relates to","id":"ADR-0002"}]
---

## Problem
The request that became TM-041 said board identity should come from "the git user for the current
directory". TM-041 shipped the repo as the identity instead, because two of these repos share one
git user and keying on the person would collapse `bytedesk-persona` and `bytedesk-marketplace` into
one board — undoing TM-036 and failing its tests.

That was the right call for the guard and it may still be the wrong answer to the question. "Who
owns this board" is a reasonable thing to want recorded, and nothing records it.

## Proposal
Decide, and write the decision down as an ADR rather than leaving it in a commit message. If the
answer is yes, `git config user.name`/`user.email` becomes an owner field beside `boardId`, read-only
for the same reason, and the cross-board guard keeps reading the repo.
