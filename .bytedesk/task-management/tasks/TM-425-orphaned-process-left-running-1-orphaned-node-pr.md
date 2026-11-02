---
id: "TM-425"
kind: "task"
status: "open"
created: "2026-10-05T14:53:47.398Z"
board: "bytedeskai/bytedesk-marketplace"
title: "Orphaned process left running: 1 orphaned node process(es) (61 MiB) left running in …//tmp/tm-store-SxPhIJ (deleted) after their owner exited"
epic: "EP-028"
acceptance: [{"text":"The process that should own this child is identified","done":false},{"text":"When that owner exits (normally or by crash), the child exits too (process group, prctl/PR_SET_PDEATHSIG, or explicit cleanup)","done":false},{"text":"A test or scripted check shows no orphan remains 1 minute after the owner is killed","done":false}]
evidence: []
commits: []
blockedBy: []
blocks: []
actor: "main"
session: "d47a6bcf-6dde-48db-9d54-70ce76b04f0a"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["ready-for-agent"]
triagedBy: "auto"
updated: "2026-10-05T14:53:47.788Z"
priority: "high"
---

Filed automatically by the infrastructure process evaluator (ByteDeskAI/infrastructure, skill process-evaluator) on host mass-laptop01 at 2026-10-05T14:53:41.605Z.

## What happened
1 orphaned node process(es) (61 MiB) left running in …//tmp/tm-store-SxPhIJ (deleted) after their owner exited

- Kind: orphan
- Severity: medium
- Fingerprint: `orphan:node@/tmp/* (deleted)`
- Why this repo: path /home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace/.claude/worktrees/ep028-int/task-management/bin/tm
- Full evidence on mass-laptop01: `/home/ryan/.local/state/bytedesk/proceval/evidence/6f4877eb5f0e/2026-10-05T14-53-41-605Z`

## Evidence
```json
{
  "processes": [
    {
      "pid": 753330,
      "ppid": 5760,
      "comm": "node",
      "cmdline": "/home/ryan/.nvm/versions/node/v22.22.0/bin/node /home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace/.claude/worktrees/ep028-int/task-management/bin/tm pool run",
      "cwd": "/tmp/tm-store-SxPhIJ (deleted)",
      "exe": "/home/ryan/.nvm/versions/node/v22.22.0/bin/node",
      "cgroup": "/user.slice/user-1000.slice/user@1000.service/app.slice/tmux-spawn-12d3986c-bf3a-43f1-a468-bba40715dab5.scope",
      "rssMiB": 61,
      "swapMiB": 0,
      "threads": 7,
      "parentChain": [
        "753330 node",
        "5760 systemd",
        "1 systemd"
      ],
      "ageMinutes": 60
    }
  ],
  "count": 1,
  "totalRssMiB": 61
}
```

## How to check the fix
Run `/home/ryan/Documents/GitHub/ByteDeskAI/infrastructure/.claude/skills/process-evaluator/scripts/proceval.mjs scan` on mass-laptop01; this fingerprint should not reappear.