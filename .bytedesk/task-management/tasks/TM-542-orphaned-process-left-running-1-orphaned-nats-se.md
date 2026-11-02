---
id: "TM-542"
kind: "task"
status: "open"
created: "2026-11-01T20:56:39.557Z"
board: "bytedeskai/bytedesk-marketplace"
title: "Orphaned process left running: 1 orphaned nats-server process(es) (13 MiB) left running in …/worktrees/TM-427-security-agent-orchestration-reviewer-any-proces/a"
epic: "EP-029"
acceptance: [{"text":"The process that should own this child is identified","done":false},{"text":"When that owner exits (normally or by crash), the child exits too (process group, prctl/PR_SET_PDEATHSIG, or explicit cleanup)","done":false},{"text":"A test or scripted check shows no orphan remains 1 minute after the owner is killed","done":false}]
evidence: []
commits: []
blockedBy: []
blocks: []
actor: "main"
session: "08673d50-605e-4443-a4a9-6605ef3dff96"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["ready-for-agent"]
triagedBy: "auto"
updated: "2026-11-01T20:56:40.103Z"
priority: "high"
---

Filed automatically by the infrastructure process evaluator (ByteDeskAI/infrastructure, skill process-evaluator) on host mass-laptop01 at 2026-11-01T20:56:18.908Z.

## What happened
1 orphaned nats-server process(es) (13 MiB) left running in …/worktrees/TM-427-security-agent-orchestration-reviewer-any-proces/agent-orchestration (deleted) after their owner exited

- Kind: orphan
- Severity: medium
- Fingerprint: `orphan:nats-server@/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace/.bytedesk/worktrees/*/agent-orchestration (deleted)`
- Why this repo: owners rule ^orphan:[^@]+@.*(agent-orchestration|/tmp/ao-topology-)
- Full evidence on mass-laptop01: `/home/ryan/.local/state/bytedesk/proceval/evidence/e1a96c373be4/2026-11-01T20-56-18-908Z`

## Evidence
```json
{
  "processes": [
    {
      "pid": 643669,
      "ppid": 5760,
      "comm": "nats-server",
      "cmdline": "/home/ryan/.cache/ao-orch/nats-server -js -a 127.0.0.1 -p 45453 -sd /tmp/ao-supervise-nats-live-gCI0aR/jetstream",
      "cwd": "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace/.bytedesk/worktrees/TM-427-security-agent-orchestration-reviewer-any-proces/agent-orchestration (deleted)",
      "exe": "/home/ryan/.cache/ao-orch/nats-server",
      "cgroup": "/user.slice/user-1000.slice/user@1000.service/app.slice/tmux-spawn-7f9c225c-b326-496e-b617-4480b95bf2ac.scope",
      "rssMiB": 13,
      "swapMiB": 0,
      "threads": 19,
      "parentChain": [
        "643669 nats-server",
        "5760 systemd",
        "1 systemd"
      ],
      "ageMinutes": 33822
    }
  ],
  "count": 1,
  "totalRssMiB": 13
}
```

## How to check the fix
Run `/home/ryan/Documents/GitHub/ByteDeskAI/infrastructure/.claude/skills/process-evaluator/scripts/proceval.mjs scan` on mass-laptop01; this fingerprint should not reappear.