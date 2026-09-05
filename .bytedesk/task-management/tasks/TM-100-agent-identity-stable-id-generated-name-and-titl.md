---
id: "TM-100"
kind: "task"
status: "done"
created: "2026-09-05T04:17:35.900Z"
board: "bytedeskai/bytedesk-marketplace"
title: "Agent identity: stable id, generated name and title"
epic: "EP-014"
acceptance: [{"text":"Creating an agent mints a static id and stores it; the id never changes for the life of the agent","done":true,"at":"2026-09-05T07:36:54.584Z"},{"text":"A first name, last name and title are generated at creation from role and supplied data, and are stable across regeneration","done":true,"at":"2026-09-05T07:36:54.698Z"},{"text":"Name collisions resolve deterministically rather than producing two identical identities","done":true,"at":"2026-09-05T07:36:54.802Z"},{"text":"Human-facing surfaces show full name and title and never the id; the surfaces where the id legitimately appears are named","done":true,"at":"2026-09-05T07:36:54.936Z"},{"text":"Every built-in role, including lead, has a title mapping","done":true,"at":"2026-09-05T07:36:55.054Z"},{"text":"Id generation is independent of name generation; the id is never derived from the name","done":true,"at":"2026-09-05T07:36:55.179Z"},{"text":"Name generation checks existing agents and will not mint a name already in use","done":true,"at":"2026-09-05T07:36:55.302Z"}]
evidence: [".bytedesk/task-management/evidence/TM-100-topology-identity.test.mjs"]
commits: ["25c5664","d547b0e","df9696c"]
blockedBy: ["TM-089"]
blocks: ["TM-101","TM-102","TM-092"]
actor: "main"
session: "a7da6c38-57d4-464b-b856-ebdb3dd72e1b"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
updated: "2026-09-05T07:39:04.212Z"
touches: ["agent-orchestration/topology/lib/resolve.mjs","agent-orchestration/topology/lib/spec.mjs"]
comments: [{"author":"main","ts":"2026-09-05T05:02:38.542Z","text":"Decisions (owner, 2026-09-05): (1) The never-display rule is scoped to HUMAN interaction only — full name and title for people; the static id may be shown in any agent-facing or machine interaction that needs it, including agent-to-agent messages, journals, session names and event payloads. (2) Names are stable once minted; regeneration never yields a different name for an existing agent. (3) Name generation and id generation are DECOUPLED — the id is minted independently and is never derived from the name, so a name collision can never disturb an address. At name-generation time the generator verifies no existing agent already holds that name and regenerates until unique."},{"author":"main","ts":"2026-09-05T07:36:54.470Z","text":"All seven AC met. identity.mjs mints the id independently of the name (mintId takes nothing from the name and vice versa), so a name collision can never disturb an address; mintName checks the existing roster and gives up loudly rather than handing back a taken name; every built-in role plus lead has a title. AC4's scope is stated in the module header and now in docs/topology.md: the never-display rule covers HUMAN surfaces only, and the id deliberately appears in tmux session names, mailbox paths, routing predicates, delegation tokens, journal events, message envelopes and spec agents[].id. One integration defect found by the live harness and fixed: mintId emitted digit-leading hex, which the spec's agent-id validator rejects, so a minted id could never be used as a spec agent id — and since routing finds the lead by minted id among a run's agents, cross-repo routing could not be exercised in a real run at all. A minted id is now a valid spec agent id, pinned by a test."}]
closed: "2026-09-05T07:36:55.569Z"
---

An agent gets a durable identity at creation time: a static id (generated, stored, used as the stable address in every machine surface) and a human identity - first name, last name and a title derived from its role and the other data supplied at creation. The id is the address; the name and title are the presentation. Nothing user-facing shows the id: the CLI, the board, the dashboard and the gateway all display 'Nadia Okonkwo, Staff Reviewer'. Design points that need settling rather than assuming: names must be stable once minted (regeneration must never produce a different name for the same agent), collisions need a deterministic resolution because a generator will eventually repeat, and 'never displayed' needs a scope - it can hold for human-facing surfaces but the id will necessarily appear in journals, tmux session names and event payloads, so state where the rule applies. Titles derive from role, so the seven built-in roles plus lead need a title mapping.