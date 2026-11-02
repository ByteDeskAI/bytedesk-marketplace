---
id: "TM-424"
kind: "task"
status: "open"
created: "2026-10-05T14:52:01.587Z"
board: "bytedeskai/bytedesk-marketplace"
title: "Orphaned process left running: 1 orphaned node process(es) (75 MiB) left running in …/GitHub/ByteDeskAI/bytedesk-marketplace after their owner exited"
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
updated: "2026-10-05T14:53:45.547Z"
priority: "high"
comments: [{"author":"main","ts":"2026-10-05T14:53:45.542Z","text":"Seen again on mass-laptop01 at 2026-10-05T14:53:41.605Z: 1 orphaned node process(es) (76 MiB) left running in …/GitHub/ByteDeskAI/bytedesk-marketplace after their owner exited. Evidence: /home/ryan/.local/state/bytedesk/proceval/evidence/9d2ffc2af76f/2026-10-05T14-53-41-605Z"}]
---

Filed automatically by the infrastructure process evaluator (ByteDeskAI/infrastructure, skill process-evaluator) on host mass-laptop01 at 2026-10-05T14:51:15.470Z.

## What happened
1 orphaned node process(es) (75 MiB) left running in …/GitHub/ByteDeskAI/bytedesk-marketplace after their owner exited

- Kind: orphan
- Severity: medium
- Fingerprint: `orphan:node@/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace`
- Why this repo: path /home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace
- Full evidence on mass-laptop01: `/home/ryan/.local/state/bytedesk/proceval/evidence/9d2ffc2af76f/2026-10-05T14-51-15-470Z`

## Evidence
```json
{
  "processes": [
    {
      "pid": 2027915,
      "ppid": 5760,
      "comm": "node",
      "cmdline": "/home/ryan/.nvm/versions/node/v22.22.0/bin/node /home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace/task-management/bin/tm pool run",
      "cwd": "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace",
      "exe": "/home/ryan/.nvm/versions/node/v22.22.0/bin/node",
      "cgroup": "/user.slice/user-1000.slice/user@1000.service/app.slice/tmux-spawn-8c473172-7c7a-4d7c-9037-e6de0622915b.scope",
      "rssMiB": 75,
      "swapMiB": 0,
      "threads": 7,
      "parentChain": [
        "2027915 node",
        "5760 systemd",
        "1 systemd"
      ],
      "ageMinutes": 148
    }
  ],
  "count": 1,
  "totalRssMiB": 75
}
```

## How to check the fix
Run `/home/ryan/Documents/GitHub/ByteDeskAI/infrastructure/.claude/skills/process-evaluator/scripts/proceval.mjs scan` on mass-laptop01; this fingerprint should not reappear.