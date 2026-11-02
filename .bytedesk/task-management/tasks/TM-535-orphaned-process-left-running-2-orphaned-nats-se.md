---
id: "TM-535"
kind: "task"
status: "open"
created: "2026-11-01T20:56:29.173Z"
board: "bytedeskai/bytedesk-marketplace"
title: "Orphaned process left running: 2 orphaned nats-server process(es) (24 MiB) left running in …/worktrees/TM-525-ao-reviewer-a-reviewer-that-cannot-submit-stale-/a"
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
updated: "2026-11-01T20:56:29.666Z"
priority: "high"
---

Filed automatically by the infrastructure process evaluator (ByteDeskAI/infrastructure, skill process-evaluator) on host mass-laptop01 at 2026-11-01T20:56:18.908Z.

## What happened
2 orphaned nats-server process(es) (24 MiB) left running in …/worktrees/TM-525-ao-reviewer-a-reviewer-that-cannot-submit-stale-/agent-orchestration (deleted) after their owner exited

- Kind: orphan
- Severity: medium
- Fingerprint: `orphan:nats-server@/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace/.bytedesk/worktrees/TM-525-ao-reviewer-a-reviewer-that-cannot-submit-stale-/agent-orchestration (deleted)`
- Why this repo: owners rule ^orphan:[^@]+@.*(agent-orchestration|/tmp/ao-topology-)
- Full evidence on mass-laptop01: `/home/ryan/.local/state/bytedesk/proceval/evidence/8f6a562a1bdb/2026-11-01T20-56-18-908Z`

## Evidence
```json
{
  "processes": [
    {
      "pid": 2096537,
      "ppid": 5760,
      "comm": "nats-server",
      "cmdline": "/home/ryan/.cache/ao-orch/nats-server -c /tmp/ao-nats-holders-hUosBA/nats-home/nats-server.conf",
      "cwd": "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace/.bytedesk/worktrees/TM-525-ao-reviewer-a-reviewer-that-cannot-submit-stale-/agent-orchestration (deleted)",
      "exe": "/home/ryan/.cache/ao-orch/nats-server",
      "cgroup": "/user.slice/user-1000.slice/user@1000.service/app.slice/tmux-spawn-1e0de047-ebb8-484e-af16-b063d2922964.scope",
      "rssMiB": 12,
      "swapMiB": 0,
      "threads": 18,
      "parentChain": [
        "2096537 nats-server",
        "5760 systemd",
        "1 systemd"
      ],
      "ageMinutes": 33882
    },
    {
      "pid": 2097805,
      "ppid": 5760,
      "comm": "nats-server",
      "cmdline": "/home/ryan/.cache/ao-orch/nats-server -js -sd /tmp/ao-nats-holders-hUosBA/js-42747 -a 127.0.0.1 -p 42747",
      "cwd": "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace/.bytedesk/worktrees/TM-525-ao-reviewer-a-reviewer-that-cannot-submit-stale-/agent-orchestration (deleted)",
      "exe": "/home/ryan/.cache/ao-orch/nats-server",
      "cgroup": "/user.slice/user-1000.slice/user@1000.service/app.slice/tmux-spawn-1e0de047-ebb8-484e-af16-b063d2922964.scope",
      "rssMiB": 12,
      "swapMiB": 0,
      "threads": 18,
      "parentChain": [
        "2097805 nats-server",
        "5760 systemd",
        "1 systemd"
      ],
      "ageMinutes": 33882
    }
  ],
  "count": 2,
  "totalRssMiB": 24
}
```

## How to check the fix
Run `/home/ryan/Documents/GitHub/ByteDeskAI/infrastructure/.claude/skills/process-evaluator/scripts/proceval.mjs scan` on mass-laptop01; this fingerprint should not reappear.