---
id: "TM-178"
kind: "task"
status: "done"
created: "2026-09-11T19:43:00.594Z"
board: "bytedeskai/bytedesk-marketplace"
title: "task-management: always-available pool with live config, standby takeover, and on by default"
epic: "EP-021"
acceptance: [{"text":"one poolEnabled(cfg) decides for both runPool and poolTick; enabled defaults to true in the settings catalog","done":true,"at":"2026-09-12T01:46:35.768Z"},{"text":"poolTick skips a ready-labelled task that fails agentReadiness and records the missing fields as the skip reason","done":true,"at":"2026-09-12T01:46:35.899Z"},{"text":"the monitor stream prints only state changes, not one line per tick","done":true,"at":"2026-09-12T01:46:36.011Z"},{"text":"session-start prints one line with pool state, ready count and running count","done":true,"at":"2026-09-12T01:46:36.143Z"},{"text":"tests for each of the above; node --test task-management/tests/unit and tests/test-pool.sh exit 0","done":true,"at":"2026-09-12T01:46:36.273Z"},{"text":"one pool per repo runs out-of-band from any session: tm pool ensure (run at session start via the monitor, on each prompt, and after a dispatch config change from CLI or dashboard) starts one detached pool when enabled and none is live; it survives the session that started it; extra sessions add no process; it exits after dispatch.idleExitMinutes with no work (default 60) and the next ensure restarts it","done":true,"at":"2026-09-12T01:46:36.406Z"},{"text":"an explicit dispatch.enabled false makes ensure start nothing and a running pool exit within one poll; setting it back to true starts the pool at once through the config or dashboard trigger","done":true,"at":"2026-09-12T01:46:36.533Z"}]
evidence: [".bytedesk/task-management/evidence/TM-178-VERIFY.md"]
commits: ["59e72e4"]
blockedBy: ["TM-175","TM-176"]
blocks: ["TM-179","TM-180"]
actor: "main"
session: "c3738e82-1fbf-4fc3-a6a3-06f965eac51c"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
updated: "2026-09-12T02:07:26.614Z"
labels: ["ready-for-agent"]
triagedBy: "auto"
comments: [{"author":"main","ts":"2026-09-11T20:29:17.280Z","text":"lead design call before dispatch: an explicit dispatch.enabled false makes run --auto exit at once (no idle process in repos that turned the pool off); unset or true runs the pool or waits in standby. So an off-to-on flip takes effect at next session start or tm pool start, not within one poll. Reason: standby for every session in every repo costs one Node process each. Delegated to Agent-tool worker w-pool-live."},{"author":"main","ts":"2026-09-11T21:37:36.415Z","text":"Ryan 2026-09-11: hold merge until TM-180 lands, then merge TM-178, TM-179 and TM-180 together. Standby rejected (about 60 MB per extra session per repo). Redesign: one detached pool per repo, ensured at session start, on prompt and on dispatch config change, with idle exit. Worker w-pool-live resumed on the same branch; the 2e198f3 evidence stays as the pre-redesign record."},{"author":"main","ts":"2026-09-11T21:58:45.599Z","text":"worker w-pool-live was stopped by accident and cannot be resumed; its uncommitted redesign survives in worktree .claude/worktrees/agent-a4f55b50b8c70bbad (branch worktree-agent-a4f55b50b8c70bbad, tip 2e198f3 + uncommitted pool.mjs/pool-ensure.test.mjs). New worker w-pool2 continues in that same worktree."},{"author":"main","ts":"2026-09-12T01:46:37.681Z","text":"merged to main as 59e72e4 via the EP-021 merge; lead verified unit 1481/1481 and contract all green at f240f1f, plus a live ensure/idle-exit/off-switch check in a temp store."}]
parkedReason: "not abandoned: Agent-tool worker w-pool-live is live on its own worktree branch. Parked only because the Stop gate re-blocks every turn (its once-only release state is store-wide and other sessions' stops clear it). Lead resumes with tm start TM-178 when the worker reports."
evidenceSources: {".bytedesk/task-management/evidence/TM-178-VERIFY.md":{"source":"/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace/.bytedesk/task-management/evidence/TM-178-VERIFY.md","sha256":"66db1f524c9bb671f5c4a1b30bda3ab20c39121648d212629459b7daba109d4d","bytes":4678,"at":"2026-09-12T01:46:37.412Z"}}
closed: "2026-09-12T01:46:37.950Z"
---

tm pool run --auto reads dispatch.enabled once and exits (pool.mjs:257); monitors never restart, so enabling mid-session does nothing. The tick and the loop also test the flag differently (=== false vs === true). Change: one poolEnabled(cfg) used by both; --auto idles and re-reads config every pollSeconds, printing only state changes; a second session's --auto waits in standby and takes over when the owning pid dies; dispatch.enabled defaults to true (decision, Ryan 2026-09-11); poolTick skips tasks failing agentReadiness (B3: pool dispatch skipped gateStart's requireOnStart); session-start prints one pool status line.