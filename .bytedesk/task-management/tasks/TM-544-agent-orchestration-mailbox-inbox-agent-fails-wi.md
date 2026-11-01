---
id: "TM-544"
kind: "task"
status: "in_progress"
created: "2026-11-01T21:01:44.941Z"
board: "bytedeskai/bytedesk-marketplace"
title: "agent-orchestration: mailbox inbox --agent fails with TOPOLOGY_DELEGATION_ACTOR after a lead's pane is respawned, unless --consumer is passed"
epic: "EP-029"
acceptance: [{"text":"After a lead respawn and prompt ack, mailbox inbox --agent <id> works without --consumer (test)","done":false}]
evidence: []
commits: []
blockedBy: []
blocks: []
actor: "main"
session: "fd2b831f"
branch: "tm/TM-544-agent-orchestration-mailbox-inbox-agent-fails-wi"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace/.bytedesk/worktrees/TM-544-agent-orchestration-mailbox-inbox-agent-fails-wi"
labels: ["ready-for-agent"]
triagedBy: "auto"
updated: "2026-11-01T21:02:55.314Z"
comments: [{"author":"main","ts":"2026-11-01T21:02:35.353Z","text":"Second repro (lead fd2b831f, 2026-11-01 ~20:45Z, bytedesk-marketplace): after a controlled-restart respawn of pane %17 (new pane_pid 2535009), 'ao-topology mailbox inbox --agent fd2b831f' from the agent dir failed: 'TOPOLOGY_DELEGATION_ACTOR: Pane %17 now runs pane_pid 2535009, not the 88351 the census recorded for fd2b831f'. After 'prompt ack' it still needed --consumer."},{"author":"main","ts":"2026-11-01T21:02:54.793Z","text":"{\"event\":\"start\",\"at\":\"2026-11-01T21:02:54.686Z\",\"owner\":\"fd2b831f\",\"worktree\":\"/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace/.bytedesk/worktrees/TM-544-agent-orchestration-mailbox-inbox-agent-fails-wi\",\"branch\":\"tm/TM-544-agent-orchestration-mailbox-inbox-agent-fails-wi\",\"base_revision\":\"8189a6bd34faf7bcb0885492301c2d12078b3c8a\",\"base_source\":\"server-tip\",\"intent\":\"Implement TM-544: mailbox inbox --agent resolves the caller after a lead respawn and prompt ack without --consumer, with a regression test.\",\"boundaries\":[\"agent-orchestration/topology/lib/delegation.mjs\",\"agent-orchestration/topology/cli.mjs\",\"agent-orchestration/tests/unit\",\"agent-orchestration/dist\"],\"dependencies\":[],\"checks\":[\"agent-orchestration: npm ci\",\"agent-orchestration: unit\",\"agent-orchestration: build:check\",\"task-management: unit\",\"agent-orchestration: plugin validate\",\"task-management: plugin validate\",\"plugin-rsync: tests\"],\"files\":[\"agent-orchestration/dist\",\"agent-orchestration/tests/unit\",\"agent-orchestration/topology/cli.mjs\",\"agent-orchestration/topology/lib/delegation.mjs\"]}"}]
priority: "medium"
touches: ["agent-orchestration/dist","agent-orchestration/tests/unit","agent-orchestration/topology/cli.mjs","agent-orchestration/topology/lib/delegation.mjs"]
governance: {"version":1,"runtime":"topology","workflowRunId":"tm-TM-544","leadId":"fd2b831f","recordPath":"/home/ryan/.local/state/bytedesk/agent-orchestration/management/8890762dbb279261/TM-544.json","state":"working"}
---

Repo: ByteDeskAI/agent-fabric, lead c2c984bc, 2026-11-01. After a controlled-restart respawned the lead in pane %42 (new pane_pid 2534181), 'ao-topology mailbox inbox --agent c2c984bc' (run from the agent directory) fails, both before and after 'prompt ack': 'error TOPOLOGY_DELEGATION_ACTOR: Pane %42 now runs pane_pid 2534181, not the 916967 the census recorded for c2c984bc; a different incarnation holds that pane.' The same command with '--consumer /home/ryan/Documents/GitHub/ByteDeskAI/agent-fabric' works. The common prompt tells agents to use the form without --consumer. Expected: prompt ack (or the respawn) refreshes the census incarnation, or the prompt's documented command includes --consumer.