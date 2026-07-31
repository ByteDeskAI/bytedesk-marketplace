---
id: "TM-005"
kind: "task"
status: "done"
created: "2026-07-29T23:08:50.154Z"
title: "One claim interlock, three writers, and only the CLI obeys it"
epic: "EP-002"
acceptance: [{"text":"the MCP start path refuses a live foreign claim with the CLI's own wording","done":true,"at":"2026-07-29T23:20:05.416Z"},{"text":"a stolen claim is explicit and lands a claim_stolen event","done":true,"at":"2026-07-29T23:20:05.476Z"},{"text":"claim records keep actor, worktree, branch and pid so expired() still works","done":true,"at":"2026-07-29T23:20:05.526Z"},{"text":"no claim read-modify-write remains outside the lock","done":true,"at":"2026-07-29T23:20:05.575Z"}]
evidence: []
commits: ["https://github.com/ByteDeskAI/bytedesk-marketplace/pull/60"]
blockedBy: []
blocks: []
actor: "main"
branch: "feat/task-management-plugin"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
updated: "2026-07-29T23:20:05.620Z"
labels: ["store-cli","rank-02"]
priority: "medium"
comments: [{"author":"main","ts":"2026-07-29T23:08:50.285Z","text":"Build plan (from the ranked survey): lib/mcp.mjs:226 (tm_task_update case 'start'): replace writeState({ claims: { ...state(p).claims, [id]: { session: session(), ts: now() } } }, p) with claimTask(id, { session: session(), actor: actorLabel(actor()), steal, p }) and return fail(res.reason) when it refuses — order the claim BEFORE the update(id, {status:'in_progress'}) so a refusal leaves no status change behind. | lib/mcp.mjs:233-235 (case 'done'): the hand-rolled const claims = {...state(p).claims}; delete claims[id]; writeState({claims}, p) becomes releaseClaim(id, p), which also emits the release event the MCP path never logs today. | lib/mcp.mjs:363-366 (tm_claim): it does check a holder but never calls expired(), so a claim from a crashed session blocks an MCP agent forever while the CLI treats the same claim as dead — replace the check and the bare writeState at :368 with claimTask(...), keeping the update(id, {statu"},{"author":"main","ts":"2026-07-29T23:08:50.337Z","text":"Watch out for: Do NOT add a mutateState() to lib/store.mjs — withLock (store.mjs:104) is reentrant on heldDepth, and claimTask (claims.mjs:34), releaseClaim (:61) and sweepClaims already wrap read→mutate→writeState in it, so that primitive would be pure churn. Do NOT move stamp() (bin/tm:86-93) into lib/actor.mjs or start stamping the task doc from the dashboard in this PR: what counts as 'mine' is read by the session-end hook (bin/tm:1012) and gateStopLocked (lib/enforce.mjs:117), and that is a separate decis"}]
closed: "2026-07-29T23:20:05.619Z"
---

