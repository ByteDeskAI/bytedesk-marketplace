---
id: "TM-101"
kind: "task"
status: "done"
created: "2026-09-05T04:17:36.046Z"
board: "bytedeskai/bytedesk-marketplace"
title: "Session addressing: stable agent id plus a per-spawn discriminator"
epic: "EP-014"
acceptance: [{"text":"A spawned session is named from the agent's static id plus a per-spawn discriminator","done":true,"at":"2026-09-05T10:46:28.002Z"},{"text":"Two concurrent spawns of the same agent produce two distinct, separately addressable sessions","done":true,"at":"2026-09-05T10:46:28.140Z"},{"text":"The discriminator's uniqueness scope is stated and enforced","done":true,"at":"2026-09-05T10:46:28.281Z"},{"text":"Resolving an agent by name or title reaches the agent; resolving a session reaches one spawn","done":true,"at":"2026-09-05T10:46:28.443Z"}]
evidence: [".bytedesk/task-management/evidence/TM-101-two-projects.sh"]
commits: ["25c5664"]
blockedBy: ["TM-100","TM-096","TM-097"]
blocks: []
actor: "main"
session: "4e1d7087-d606-432e-9341-3ce779b4baf8"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
updated: "2026-09-05T10:46:28.973Z"
touches: ["agent-orchestration/topology/lib/launch.mjs","agent-orchestration/topology/lib/util.mjs"]
comments: [{"author":"main","ts":"2026-09-05T10:46:28.799Z","text":"Uniqueness scope settled: LIVE SESSIONS ON THIS HOST, which is the scope tmux itself enforces, so uniqueSessionName probes has-session rather than trusting 28 bits of entropy and fails loudly after 10 attempts. Two cases deliberately stay run-addressed: a team has no single agent to name it after, and an inline spec agent has no stable id — an id written in a spec file is a label local to that file, so two unrelated specs both saying id:'worker' would collide into one session name. A spec that sets session itself is always honoured. TM-097's req.Session fix in bytedesk-remote-gateway is what lets these names reach the gateway; it is on branch ep014/session-pinning there and NOT yet pushed."}]
closed: "2026-09-05T10:46:28.967Z"
---

An agent has one stable address and many independently trackable sessions. The session identifier is the agent's static id plus a per-spawn discriminator - a randomly generated short hex string in the shape of an abbreviated git sha, long enough that collisions are not a practical concern within the set of live sessions. Stable agent, distinct sessions: 'who' is the agent id, 'which run' is the discriminator. This constrains the gateway work: TM-087 established that a gateway tab id and its derived tmux session name are server-minted (launch_request_builder.go:205-206) and that req.Session is decoded then overwritten, so a session cannot currently be named by the caller at all. Carrying an agent id into the session name therefore depends on TM-097's fix landing - honouring req.Session in the builder is the cheapest of the three options. Also settle the uniqueness scope of the discriminator: unique per agent, per repo, or across all live sessions on the host.