---
id: "TM-540"
kind: "task"
status: "open"
created: "2026-11-01T20:56:36.478Z"
board: "bytedeskai/bytedesk-marketplace"
title: "Orphaned process left running: 1 orphaned tmux: server process(es) (4 MiB) left running in …/tmp.SpY2sro4Ic/base/agent-orchestration (deleted) after their owner"
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
updated: "2026-11-01T20:56:37.001Z"
priority: "high"
---

Filed automatically by the infrastructure process evaluator (ByteDeskAI/infrastructure, skill process-evaluator) on host mass-laptop01 at 2026-11-01T20:56:18.908Z.

## What happened
1 orphaned tmux: server process(es) (4 MiB) left running in …/tmp.SpY2sro4Ic/base/agent-orchestration (deleted) after their owner exited

- Kind: orphan
- Severity: medium
- Fingerprint: `orphan:tmux: server@/tmp/tmp.SpY2sro4Ic/base/agent-orchestration (deleted)`
- Why this repo: owners rule ^orphan:[^@]+@.*(agent-orchestration|/tmp/ao-topology-)
- Full evidence on mass-laptop01: `/home/ryan/.local/state/bytedesk/proceval/evidence/aacfd7bea749/2026-11-01T20-56-18-908Z`

## Evidence
```json
{
  "processes": [
    {
      "pid": 2678801,
      "ppid": 5760,
      "comm": "tmux: server",
      "cmdline": "tmux -S /tmp/aot-EsTLNt/tmux-1000/default new-session -d -s agents1--app--worker--dot -e FAKE_TURN_LOG=/tmp/ao-respawn-a14d4K/agent.log /home/ryan/.hermes/node/bin/node /tmp/tmp.SpY2sro4Ic/base/agent-orchestration/tests/fixtures/fake-turn-agent.mjs",
      "cwd": "/tmp/tmp.SpY2sro4Ic/base/agent-orchestration (deleted)",
      "exe": "/usr/bin/tmux",
      "cgroup": "/user.slice/user-1000.slice/user@1000.service/app.slice/tmux-spawn-b288394b-dd08-4dd0-b606-022103580925.scope",
      "rssMiB": 4,
      "swapMiB": 0,
      "threads": 1,
      "parentChain": [
        "2678801 tmux: server",
        "5760 systemd",
        "1 systemd"
      ],
      "ageMinutes": 34089
    }
  ],
  "count": 1,
  "totalRssMiB": 4
}
```

## How to check the fix
Run `/home/ryan/Documents/GitHub/ByteDeskAI/infrastructure/.claude/skills/process-evaluator/scripts/proceval.mjs scan` on mass-laptop01; this fingerprint should not reappear.