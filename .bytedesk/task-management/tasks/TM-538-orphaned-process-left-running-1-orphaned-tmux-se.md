---
id: "TM-538"
kind: "task"
status: "open"
created: "2026-11-01T20:56:33.902Z"
board: "bytedeskai/bytedesk-marketplace"
title: "Orphaned process left running: 1 orphaned tmux: server process(es) (5 MiB) left running in …/worktrees/TM-427-security-agent-orchestration-reviewer-any-proces/a"
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
updated: "2026-11-01T20:56:34.414Z"
priority: "high"
---

Filed automatically by the infrastructure process evaluator (ByteDeskAI/infrastructure, skill process-evaluator) on host mass-laptop01 at 2026-11-01T20:56:18.908Z.

## What happened
1 orphaned tmux: server process(es) (5 MiB) left running in …/worktrees/TM-427-security-agent-orchestration-reviewer-any-proces/agent-orchestration (deleted) after their owner exited

- Kind: orphan
- Severity: medium
- Fingerprint: `orphan:tmux: server@/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace/.bytedesk/worktrees/*/agent-orchestration (deleted)`
- Why this repo: owners rule ^orphan:[^@]+@.*(agent-orchestration|/tmp/ao-topology-)
- Full evidence on mass-laptop01: `/home/ryan/.local/state/bytedesk/proceval/evidence/45578c286420/2026-11-01T20-56-18-908Z`

## Evidence
```json
{
  "processes": [
    {
      "pid": 2498037,
      "ppid": 5760,
      "comm": "tmux: server",
      "cmdline": "tmux new-session -d -s mass-laptop01--ao-topology-deaf-6hcmrt--deaf--ada -n main -c /tmp/ao-topology-deaf-6HcMRt -x 220 -y 60 bash --noprofile --norc -i",
      "cwd": "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace/.bytedesk/worktrees/TM-427-security-agent-orchestration-reviewer-any-proces/agent-orchestration (deleted)",
      "exe": "/usr/bin/tmux",
      "cgroup": "/user.slice/user-1000.slice/user@1000.service/app.slice/tmux-spawn-7f9c225c-b326-496e-b617-4480b95bf2ac.scope",
      "rssMiB": 5,
      "swapMiB": 0,
      "threads": 1,
      "parentChain": [
        "2498037 tmux: server",
        "5760 systemd",
        "1 systemd"
      ],
      "ageMinutes": 33877
    }
  ],
  "count": 1,
  "totalRssMiB": 5
}
```

## How to check the fix
Run `/home/ryan/Documents/GitHub/ByteDeskAI/infrastructure/.claude/skills/process-evaluator/scripts/proceval.mjs scan` on mass-laptop01; this fingerprint should not reappear.