---
id: "TM-101"
kind: "task"
status: "blocked"
created: "2026-09-05T04:17:36.046Z"
board: "bytedeskai/bytedesk-marketplace"
title: "Session addressing: stable agent id plus a per-spawn discriminator"
epic: "EP-014"
acceptance: [{"text":"A spawned session is named from the agent's static id plus a per-spawn discriminator","done":false},{"text":"Two concurrent spawns of the same agent produce two distinct, separately addressable sessions","done":false},{"text":"The discriminator's uniqueness scope is stated and enforced","done":false},{"text":"Resolving an agent by name or title reaches the agent; resolving a session reaches one spawn","done":false}]
evidence: []
commits: ["25c5664"]
blockedBy: ["TM-100","TM-096","TM-097"]
blocks: []
actor: "main"
session: "a7da6c38-57d4-464b-b856-ebdb3dd72e1b"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
updated: "2026-09-05T04:18:03.759Z"
touches: ["agent-orchestration/topology/lib/launch.mjs","agent-orchestration/topology/lib/util.mjs"]
---

An agent has one stable address and many independently trackable sessions. The session identifier is the agent's static id plus a per-spawn discriminator - a randomly generated short hex string in the shape of an abbreviated git sha, long enough that collisions are not a practical concern within the set of live sessions. Stable agent, distinct sessions: 'who' is the agent id, 'which run' is the discriminator. This constrains the gateway work: TM-087 established that a gateway tab id and its derived tmux session name are server-minted (launch_request_builder.go:205-206) and that req.Session is decoded then overwritten, so a session cannot currently be named by the caller at all. Carrying an agent id into the session name therefore depends on TM-097's fix landing - honouring req.Session in the builder is the cheapest of the three options. Also settle the uniqueness scope of the discriminator: unique per agent, per repo, or across all live sessions on the host.