---
id: "TM-407"
kind: "task"
status: "open"
created: "2026-10-05T13:41:33.933Z"
board: "bytedeskai/bytedesk-marketplace"
title: "agent-orchestration: no stalled agents: detect and resolve leads waiting on prompts, paused pools, unadmitted ready tasks and silent workers"
epic: "EP-028"
acceptance: [{"text":"The supervisor detects and records stalls (prompt-waiting composer, unresponsive lead, paused or dead pool with ready work, ready tasks skipped for missing admission, silent worker) and shows them in services status and orchestration_doctor","done":false},{"text":"A lead waiting on a question with a Recommended option takes that option within standing autonomy and records it; a question that really needs Ryan goes out as one durable message, never left sitting in a composer","done":false},{"text":"A paused pool with ready work is diagnosed and resumed (a task that looks done is verified and closed); it escalates only when the same cause repeats","done":false},{"text":"Ready tasks that pass readiness are admitted by the repo's own lead, or admission is derived automatically, so none needs a person to run manage admit","done":false},{"text":"A silent worker is nudged by mailbox, then handed off and restarted; a live busy worker is never killed","done":false},{"text":"The lead role prompt forbids ending a turn waiting on a person when a recommended option or standing rule answers the question","done":false},{"text":"Regression tests for each stall kind","done":false}]
evidence: []
commits: ["TM-350"]
blockedBy: []
blocks: []
actor: "main"
session: "83f65be5-7b0d-41d9-a894-03d84e1227d5"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["ready-for-agent","plugin:agent-orchestration"]
triagedBy: "human"
updated: "2026-11-01T20:54:46.132Z"
priority: "high"
comments: [{"author":"main","ts":"2026-10-05T13:58:55.824Z","text":"Evidence from 2026-10-05 13:58Z. A cross-repo broadcast went from agent-fabric to 8 repo leads with orchestration_mailbox_send. Delivered: 2 (Bastion, bytedesk-passport). Held: 6. Four were held as leads_not_ready with the destination lead unresponsive: bytedesk-clients (supervisor restarts=12), bytedesk-agent-browser (restarts=5351, state starting, ready false), infrastructure (restarts=626) and bytedesk-remote-gateway (restarts=728). design-system was leads_not_ready with its supervisor in state died-before-first-tick (restarts=7). agent-fabric, mail to its own repo, was held as unknown_recipient for to=lead, although a managed lead (c2c984bc) is registered. Restart counts in the hundreds or thousands are crash loops that nothing escalates. The supervision logs are under ~/.local/state/bytedesk/agent-orchestration/supervision/<hash>.log. Also, the ao-topology mailbox send CLI held every message as source_identity_required when run from a non-agent shell, so a lead outside a bound pane cannot send from the CLI."},{"author":"main","ts":"2026-11-01T20:54:46.122Z","text":"Live evidence 2026-11-01 (lead fd2b831f): pool pid 2027915 ran 27 days and dispatched nothing after 2026-10-11 while 'tm pool status' reported '123 ready'. Causes: (1) every ready task needs 'ao-topology manage admit', and ~115 of them declare no touches, so admission refuses with TOPOLOGY_MANAGEMENT_SCOPE — nothing can admit them unattended; (2) admission also refused while reviewer session faro was down (TOPOLOGY_MANAGEMENT_REVIEWER), and nothing restarted it; (3) TM-417 sat in_progress after its PR #237 merged, holding agent-orchestration/CHANGELOG.md so overlapping tasks were skipped. pool.log holds one line and records none of these skips. 'tm pool status' should count admittable work, not label-ready work."}]
---

Reported by Ryan, 2026-10-05: "I don't want any stalled agents." Part of TM-350; complements TM-393, which covers dead or missing leads. This task covers agents that are alive but not making progress.

## Stalls observed on 2026-10-05

1. **A lead blocked on a question for a person.** The marketplace lead (fd2b831f, pane %17) sat on an AskUserQuestion prompt about the TM-392 rule conflict. Its own option 1 was marked "(Recommended)". `ao-topology lead status` reported `TOPOLOGY_LEAD_UNRESPONSIVE: the lead is alive but did not acknowledge a probe; it is left running and untouched`. Nothing escalated it or routed the question anywhere. The work only resumed because another session typed into the pane.
2. **A pool paused for three weeks.** The bytedesk-marketplace pool paused on 2026-09-14 after 3 consecutive dispatch failures (the last was TM-205, "looks already done"). It stayed paused until 2026-10-05, and 103 tasks waited. Its pid file was stale; the pool had already exited "idle".
3. **Ready tasks that are never admitted.** After `tm pool resume`, every one of the 104 ready tasks was skipped with `persistent-lead admission is missing; run ao-topology manage admit --task TM-n`. The pool then idles and exits. The lead never admits them, so ready-for-agent work never starts.
4. **Long-running workers with no check on progress.** For example, `tm384-c4` had run for 2h25m. Nothing checks whether a worker is still making progress or is waiting on input.

## Required behaviour

- **Stall detection.** The supervisor treats each of these as a stall: the composer is waiting on a question or permission prompt, the lead is unresponsive past a threshold, the pool is paused or dead while ready work exists, ready tasks are skipped only for missing admission, or a worker shows no commits, events or output past a threshold. It records each stall (repo, agent, kind, since) and shows it in `services status` and `orchestration_doctor`.
- **Stall resolution, without a person.**
  - A question to a person that carries a "(Recommended)" option falls within Ryan's standing autonomy (~/.agents/AGENTS.md). The lead takes that option and records the decision on the task. A question that genuinely needs Ryan, an action from the "still ask first" list, goes out as one durable mailbox message or notification. It never sits in a composer.
  - A paused pool is diagnosed and resumed. For example, a task that looks already done is verified and closed, not left to block the queue. The pause is escalated only if the same cause repeats.
  - The repository's own lead admits ready tasks that pass the readiness check, using the task's own touches, ACs and checks. Alternatively, admission is derived automatically, so a ready task never needs a person to run `manage admit`.
  - A stalled worker gets a mailbox nudge, then a handoff and restart through `manage stop-worker` / `start-worker`. A live, busy worker is never killed (the TM-393 rule).
- **Rule in the lead role prompt.** A lead never ends a turn waiting on a person when a recommended option or a standing rule answers the question. It never leaves the pool paused while ready work exists.
- **Regression tests for each.** A lead stuck on a recommended-option prompt continues. A paused pool with ready work resumes. An unadmitted ready task gets admitted and dispatched. A silent worker is nudged and then restarted.
