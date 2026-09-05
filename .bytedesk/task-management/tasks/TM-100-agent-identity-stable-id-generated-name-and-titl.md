---
id: "TM-100"
kind: "task"
status: "blocked"
created: "2026-09-05T04:17:35.900Z"
board: "bytedeskai/bytedesk-marketplace"
title: "Agent identity: stable id, generated name and title"
epic: "EP-014"
acceptance: [{"text":"Creating an agent mints a static id and stores it; the id never changes for the life of the agent","done":false},{"text":"A first name, last name and title are generated at creation from role and supplied data, and are stable across regeneration","done":false},{"text":"Name collisions resolve deterministically rather than producing two identical identities","done":false},{"text":"Human-facing surfaces show full name and title and never the id; the surfaces where the id legitimately appears are named","done":false},{"text":"Every built-in role, including lead, has a title mapping","done":false}]
evidence: []
commits: []
blockedBy: ["TM-089"]
blocks: ["TM-101","TM-102","TM-092"]
actor: "main"
session: "a7da6c38-57d4-464b-b856-ebdb3dd72e1b"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
updated: "2026-09-05T04:17:47.461Z"
touches: ["agent-orchestration/topology/lib/resolve.mjs","agent-orchestration/topology/lib/spec.mjs"]
---

An agent gets a durable identity at creation time: a static id (generated, stored, used as the stable address in every machine surface) and a human identity - first name, last name and a title derived from its role and the other data supplied at creation. The id is the address; the name and title are the presentation. Nothing user-facing shows the id: the CLI, the board, the dashboard and the gateway all display 'Nadia Okonkwo, Staff Reviewer'. Design points that need settling rather than assuming: names must be stable once minted (regeneration must never produce a different name for the same agent), collisions need a deterministic resolution because a generator will eventually repeat, and 'never displayed' needs a scope - it can hold for human-facing surfaces but the id will necessarily appear in journals, tmux session names and event payloads, so state where the rule applies. Titles derive from role, so the seven built-in roles plus lead need a title mapping.