---
id: "TM-537"
kind: "task"
status: "open"
created: "2026-11-01T20:56:32.335Z"
board: "bytedeskai/bytedesk-marketplace"
title: "Orphaned process left running: 1 orphaned tmux: server process(es) (4 MiB) left running in …/scratchpad/rb4-214/agent-orchestration (deleted) after their owner "
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
updated: "2026-11-01T20:56:32.912Z"
priority: "high"
---

Filed automatically by the infrastructure process evaluator (ByteDeskAI/infrastructure, skill process-evaluator) on host mass-laptop01 at 2026-11-01T20:56:18.908Z.

## What happened
1 orphaned tmux: server process(es) (4 MiB) left running in …/scratchpad/rb4-214/agent-orchestration (deleted) after their owner exited

- Kind: orphan
- Severity: medium
- Fingerprint: `orphan:tmux: server@/tmp/claude-1000/-home-ryan-Documents-GitHub-ByteDeskAI-bytedesk-marketplace--bytedesk-agent-orchestration-agents-fd2b831f/253de95a-5b3d-4702-b941-9b7ba0507f01/scratchpad/rb4-214/agent-orchestration (deleted)`
- Why this repo: owners rule ^orphan:[^@]+@.*(agent-orchestration|/tmp/ao-topology-)
- Full evidence on mass-laptop01: `/home/ryan/.local/state/bytedesk/proceval/evidence/02b13973da91/2026-11-01T20-56-18-908Z`

## Evidence
```json
{
  "processes": [
    {
      "pid": 2370414,
      "ppid": 5760,
      "comm": "tmux: server",
      "cmdline": "tmux new-session -d -s agents1--app--orchestrator--bell -n main -c /tmp/ao-respawn-PuoDvr/app/.bytedesk/agent-orchestration/agents/de94e271 -x 220 -y 60 bash --noprofile --norc -i",
      "cwd": "/tmp/claude-1000/-home-ryan-Documents-GitHub-ByteDeskAI-bytedesk-marketplace--bytedesk-agent-orchestration-agents-fd2b831f/253de95a-5b3d-4702-b941-9b7ba0507f01/scratchpad/rb4-214/agent-orchestration (deleted)",
      "exe": "/usr/bin/tmux",
      "cgroup": "/user.slice/user-1000.slice/user@1000.service/app.slice/tmux-spawn-3deed497-8b99-45e1-a7c2-53118ea23326.scope",
      "rssMiB": 4,
      "swapMiB": 0,
      "threads": 1,
      "parentChain": [
        "2370414 tmux: server",
        "5760 systemd",
        "1 systemd"
      ],
      "ageMinutes": 34263
    }
  ],
  "count": 1,
  "totalRssMiB": 4
}
```

## How to check the fix
Run `/home/ryan/Documents/GitHub/ByteDeskAI/infrastructure/.claude/skills/process-evaluator/scripts/proceval.mjs scan` on mass-laptop01; this fingerprint should not reappear.