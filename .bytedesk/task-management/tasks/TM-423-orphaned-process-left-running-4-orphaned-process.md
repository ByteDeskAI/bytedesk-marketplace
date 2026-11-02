---
id: "TM-423"
kind: "task"
status: "open"
created: "2026-10-05T14:52:00.276Z"
board: "bytedeskai/bytedesk-marketplace"
title: "Orphaned process left running: 4 orphaned process-compose process(es) (217 MiB) left running in …/tmp/ao-activation-JetLU5/repo (deleted) after their owner exit"
epic: "EP-028"
acceptance: [{"text":"The process that should own this child is identified","done":false},{"text":"When that owner exits (normally or by crash), the child exits too (process group, prctl/PR_SET_PDEATHSIG, or explicit cleanup)","done":false},{"text":"A test or scripted check shows no orphan remains 1 minute after the owner is killed","done":false}]
evidence: []
commits: []
blockedBy: []
blocks: []
actor: "main"
session: "daa70b0a-77c3-4cb3-ac4b-cf212a3b1cc1"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["ready-for-agent"]
triagedBy: "auto"
updated: "2026-11-01T20:56:28.393Z"
priority: "high"
comments: [{"author":"main","ts":"2026-10-05T14:53:45.110Z","text":"Seen again on mass-laptop01 at 2026-10-05T14:53:41.605Z: 4 orphaned process-compose process(es) (217 MiB) left running in …/tmp/ao-activation-JetLU5/repo (deleted) after their owner exited. Evidence: /home/ryan/.local/state/bytedesk/proceval/evidence/ecccb740f48b/2026-10-05T14-53-41-605Z"},{"author":"main","ts":"2026-10-05T20:53:44.990Z","text":"Seen again on mass-laptop01 at 2026-10-05T20:53:41.027Z: 4 orphaned process-compose process(es) (217 MiB) left running in …/tmp/ao-activation-JetLU5/repo (deleted) after their owner exited. Evidence: /home/ryan/.local/state/bytedesk/proceval/evidence/ecccb740f48b/2026-10-05T20-53-41-027Z"},{"author":"main","ts":"2026-11-01T20:56:28.384Z","text":"Seen again on mass-laptop01 at 2026-11-01T20:56:18.908Z: 4 orphaned process-compose process(es) (94 MiB) left running in …/tmp/ao-activation-JetLU5/repo (deleted) after their owner exited. Evidence: /home/ryan/.local/state/bytedesk/proceval/evidence/ecccb740f48b/2026-11-01T20-56-18-908Z"}]
---

Filed automatically by the infrastructure process evaluator (ByteDeskAI/infrastructure, skill process-evaluator) on host mass-laptop01 at 2026-10-05T14:51:15.470Z.

## What happened
4 orphaned process-compose process(es) (217 MiB) left running in …/tmp/ao-activation-JetLU5/repo (deleted) after their owner exited

- Kind: orphan
- Severity: medium
- Fingerprint: `orphan:process-compose@/tmp/*/repo (deleted)`
- Why this repo: owners path /tmp/ao-activation-
- Full evidence on mass-laptop01: `/home/ryan/.local/state/bytedesk/proceval/evidence/ecccb740f48b/2026-10-05T14-51-15-470Z`

## Evidence
```json
{
  "processes": [
    {
      "pid": 1404347,
      "ppid": 5760,
      "comm": "process-compose",
      "cmdline": "/tmp/ao-activation-JetLU5/home/.local/share/bytedesk/agent-orchestration/bin/process-compose-v1.122.0/process-compose up -f /tmp/ao-activation-JetLU5/state/services/process-compose.yaml -t=false --keep-project --disable-dotenv --address 127.0.0.1 -p 45101 --token-file /tmp/ao-activation-JetLU5/state/services/api-token -L /tmp/ao-activation-JetLU5/state/services/logs/process-compose.log",
      "cwd": "/tmp/ao-activation-JetLU5/repo (deleted)",
      "exe": "/tmp/ao-activation-JetLU5/home/.local/share/bytedesk/agent-orchestration/bin/process-compose-v1.122.0/process-compose (deleted)",
      "cgroup": "/user.slice/user-1000.slice/user@1000.service/app.slice/tmux-spawn-f36622e0-bab9-4f13-9920-271717b0e4b5.scope",
      "rssMiB": 57,
      "swapMiB": 0,
      "threads": 17,
      "parentChain": [
        "1404347 process-compose",
        "5760 systemd",
        "1 systemd"
      ],
      "ageMinutes": 190
    },
    {
      "pid": 1404885,
      "ppid": 5760,
      "comm": "process-compose",
      "cmdline": "/tmp/ao-activation-Uuq0SU/home/.local/share/bytedesk/agent-orchestration/bin/process-compose-v1.122.0/process-compose up -f /tmp/ao-activation-Uuq0SU/state/services/process-compose.yaml -t=false --keep-project --disable-dotenv --address 127.0.0.1 -p 45102 --token-file /tmp/ao-activation-Uuq0SU/state/services/api-token -L /tmp/ao-activation-Uuq0SU/state/services/logs/process-compose.log",
      "cwd": "/tmp/ao-activation-Uuq0SU/repo (deleted)",
      "exe": "/tmp/ao-activation-Uuq0SU/home/.local/share/bytedesk/agent-orchestration/bin/process-compose-v1.122.0/process-compose (deleted)",
      "cgroup": "/user.slice/user-1000.slice/user@1000.service/app.slice/tmux-spawn-f36622e0-bab9-4f13-9920-271717b0e4b5.scope",
      "rssMiB": 52,
      "swapMiB": 0,
      "threads": 17,
      "parentChain": [
        "1404885 process-compose",
        "5760 systemd",
        "1 systemd"
      ],
      "ageMinutes": 190
    },
    {
      "pid": 1405250,
      "ppid": 5760,
      "comm": "process-compose",
      "cmdline": "/tmp/ao-activation-Uuq0SU/home/.local/share/bytedesk/agent-orchestration/bin/process-compose-v1.122.0/process-compose up -f /tmp/ao-activation-Uuq0SU/state/services/process-compose.yaml -t=false --keep-project --disable-dotenv --address 127.0.0.1 -p 45103 --token-file /tmp/ao-activation-Uuq0SU/state/services/api-token -L /tmp/ao-activation-Uuq0SU/state/services/logs/process-compose.log",
      "cwd": "/tmp/ao-activation-Uuq0SU/repo (deleted)",
      "exe": "/tmp/ao-activation-Uuq0SU/home/.local/share/bytedesk/agent-orchestration/bin/process-compose-v1.122.0/process-compose",
      "cgroup": "/user.slice/user-1000.slice/user@1000.service/app.slice/tmux-spawn-f36622e0-bab9-4f13-9920-271717b0e4b5.scope",
      "rssMiB": 52,
      "swapMiB": 0,
      "threads": 17,
      "parentChain": [
        "1405250 process-compose",
        "5760 systemd",
        "1 systemd"
      ],
      "ageMinutes": 190
    },
    {
      "pid": 1405379,
      "ppid": 5760,
      "comm": "process-compose",
      "cmdline": "/tmp/ao-activation-oBwLkr/home/.local/share/bytedesk/agent-orchestration/bin/process-compose-v1.122.0/process-compose up -f /tmp/ao-activation-oBwLkr/state/services/process-compose.yaml -t=false --keep-project --disable-dotenv --address 127.0.0.1 -p 45104 --token-file /tmp/ao-activation-oBwLkr/state/services/api-token -L /tmp/ao-activation-oBwLkr/state/services/logs/process-compose.log",
      "cwd": "/tmp/ao-activation-oBwLkr/repo (deleted)",
      "exe": "/tmp/ao-activation-oBwLkr/home/.local/share/bytedesk/agent-orchestration/bin/process-compose-v1.122.0/process-compose (deleted)",
      "cgroup": "/user.slice/user-1000.slice/user@1000.service/app.slice/tmux-spawn-f36622e0-bab9-4f13-9920-271717b0e4b5.scope",
      "rssMiB": 56,
      "swapMiB": 0,
      "threads": 18,
      "parentChain": [
        "1405379 process-compose",
        "5760 systemd",
        "1 systemd"
      ],
      "ageMinutes": 190
    }
  ],
  "count": 4,
  "totalRssMiB": 217
}
```

## How to check the fix
Run `/home/ryan/Documents/GitHub/ByteDeskAI/infrastructure/.claude/skills/process-evaluator/scripts/proceval.mjs scan` on mass-laptop01; this fingerprint should not reappear.