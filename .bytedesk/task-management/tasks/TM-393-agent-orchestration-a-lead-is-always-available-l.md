---
id: "TM-393"
kind: "task"
status: "open"
created: "2026-10-05T11:28:43.931Z"
board: "bytedeskai/bytedesk-marketplace"
title: "agent-orchestration: a lead is always available — load on demand, respawn when killed, apply restart-required prompts"
epic: "EP-028"
acceptance: [{"text":"Any message, route or probe addressed to a repo's lead ensures a live lead first, spawning one if none exists; no caller ever gets 'no lead'","done":false},{"text":"The supervisor respawns a dead or missing lead pane with a handoff and backoff, recorded in leads/<hash>.recovery.json; an alive-but-unresponsive lead is reported, never killed","done":false},{"text":"A restart-required prompt change is applied at the lead's next safe boundary without operator action; in-pane prompt ack accepts the bound process or names the process it expected","done":false},{"text":"agent restart run from inside the target agent detaches itself instead of waiting on its own turn","done":false},{"text":"Regression tests: no lead -> delivered to a fresh lead; killed lead -> respawned; queued restart-required prompt -> applied","done":false}]
evidence: []
commits: []
blockedBy: ["TM-384","TM-347","TM-348","TM-349"]
blocks: []
actor: "main"
session: "95dc235f-893f-40c7-b24c-d2b91771b6f4"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["ready-for-agent","plugin:agent-orchestration"]
triagedBy: "human"
updated: "2026-10-08T23:33:45.426Z"
priority: "high"
comments: [{"author":"main","ts":"2026-10-05T11:30:24.694Z","text":"Lead (fd2b831f): sequenced after TM-384 (mailbox send/route path, standing-mailbox.mjs + routing.mjs) and TM-347..349 (management.mjs, cli.mjs), which are in flight in the same files."},{"author":"main","ts":"2026-10-05T13:47:03.551Z","text":"Second failure mode seen 2026-10-05 in agent-fabric: governed launch sends the lead a readiness AO_PROBE with a 30s wait. When the lead is mid-turn (here: running 'tm pool once', which itself triggered the launch), the probe arrives only as a queued mid-turn message, the ack lands after waited_until, and launch fails TOPOLOGY_STARTUP_NOT_READY. A lead driving its own pool can never pass its own probe. Readiness should accept a live, bound, working lead pane (or the lead's own process as caller), not only a timely typed ack."},{"author":"main","ts":"2026-10-05T18:11:04.103Z","text":"Probe noise, 2026-10-05: the agent-fabric lead received ~40 typed AO_PROBE readiness pings over a few hours while idle, with no launches in pool.log after resume. Each one costs the lead a full turn and fills the operator's terminal. Readiness should be proven from the bound pane and process (live, idle composer), keeping typed probes for real launches only, or rate-limited and coalesced."},{"author":"main","ts":"2026-10-06T02:43:03.264Z","text":"Batch-delivery evidence, 2026-10-05: 17 AO_PROBE lines reached the agent-fabric lead in ONE prompt; all 17 were already expired (TOPOLOGY_LEAD_PROBE_UNKNOWN) when acked immediately. Probes are being queued in the composer while the lead is idle-or-busy and flushed together, so the 30s window cannot be met. Readiness via typed probe is unreliable by design; prove it from the bound pane/process instead."}]
---

# HIGH PRIORITY — leads must always be available, loaded on demand and reloaded when killed

**From:** Hana Braith (c2c984bc), lead of agent-fabric. **On behalf of:** Ryan (operator), 2026-10-05.
**Please:** create a high-priority task (with acceptance criteria) on the agent-orchestration board in bytedesk-marketplace, then implement it.

## Operator requirement (Ryan's words, paraphrased)
A request to a repository lead must never find no lead available. If a repo has no lead, or its
lead is killed or dead, the lead must be loaded on demand, automatically, with no human step.

## What happened today (evidence)
1. agent-fabric lead (c2c984bc, pane %42, pane pid 916967) had prompt-state `status: queued`,
   `replacement: restart-required`. `ao-topology prompt ack c2c984bc --revision 3f85c1559412abce --nonce ...`
   run INSIDE that pane returned `TOPOLOGY_PROMPT_ACK_INVALID: Only the exact started process can
   acknowledge its current staged prompt.` So the live lead could not apply its own prompt, and the
   staged revision then moved on to 6f49c04cb1ea90b5 (`agent list --json`: applied_revision null,
   restart_required true).
2. The only fix was `ao-topology agent restart c2c984bc --mode resume`, which the operator had to ask
   for. Run from the lead itself it must wait out the lead's own turn, so it had to be detached
   (setsid nohup). Nothing did this automatically.
3. `ao-topology lead status --consumer /home/ryan/Documents/GitHub/ByteDeskAI/agent-orchestration`
   returns `record: null, status: none` — that checkout is a broken worktree (`.git` points at a
   deleted /tmp/agent-orchestration-git.*/repo.git). A message routed to that repo's lead has no one to reach.

## Required behaviour (acceptance criteria to adopt)
- **On demand:** any send/route/probe addressed to a repo's lead (`mailbox send`, `send --to @role:lead`,
  `lead probes`, outsider routing) calls the equivalent of `lead ensure` first; if no live lead exists, one
  is spawned and the message is delivered to it. No caller ever gets "no lead".
- **Reload when killed:** the repository supervisor (`supervise`) detects a dead/missing lead pane and
  re-spawns it with a handoff, with backoff and the existing recovery state file
  (`leads/<hash>.recovery.json`) recording attempts and errors. Alive-but-unresponsive is still reported,
  never killed (keep that rule).
- **Prompt refresh:** a `restart-required` prompt change is applied by the supervisor at the lead's next
  safe boundary (idle composer), not left queued forever. And either the in-pane `prompt ack` accepts the
  bound process (pane %42 / pid 916967 was the bound pane and was refused — find out why), or the error
  says exactly what process it expected.
- **Self-restart:** `agent restart` invoked from inside the target agent detaches itself, so it does not
  wait on its own caller's turn.
- **Regression test** for each: no lead → message delivered to a freshly spawned lead; lead pane killed →
  supervisor respawns it; queued restart-required prompt → applied without operator action.

## Not in scope
Do not change agent-fabric. Reply to my outbox with the task id, PR link and landing evidence when done.
