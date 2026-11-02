---
id: "TM-536"
kind: "task"
status: "open"
created: "2026-11-01T20:56:30.617Z"
board: "bytedeskai/bytedesk-marketplace"
title: "Orphaned process left running: 2 orphaned tmux: server process(es) (8 MiB) left running in …/scratchpad/wp/agent-orchestration (deleted) after their owner exite"
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
updated: "2026-11-01T20:56:31.207Z"
priority: "high"
---

Filed automatically by the infrastructure process evaluator (ByteDeskAI/infrastructure, skill process-evaluator) on host mass-laptop01 at 2026-11-01T20:56:18.908Z.

## What happened
2 orphaned tmux: server process(es) (8 MiB) left running in …/scratchpad/wp/agent-orchestration (deleted) after their owner exited

- Kind: orphan
- Severity: medium
- Fingerprint: `orphan:tmux: server@/tmp/claude-1000/-home-ryan-Documents-GitHub-ByteDeskAI-bytedesk-marketplace--bytedesk-agent-orchestration-agents-fd2b831f/0070d3a6-ed13-49eb-bd23-58d49baf221e/scratchpad/wp/agent-orchestration (deleted)`
- Why this repo: owners rule ^orphan:[^@]+@.*(agent-orchestration|/tmp/ao-topology-)
- Full evidence on mass-laptop01: `/home/ryan/.local/state/bytedesk/proceval/evidence/500384f1ac5b/2026-11-01T20-56-18-908Z`

## Evidence
```json
{
  "processes": [
    {
      "pid": 2172501,
      "ppid": 5760,
      "comm": "tmux: server",
      "cmdline": "tmux -S /tmp/aot-SXjkdO/tmux-1000/default new-session -d -s agents1--app--worker--dot -e FAKE_TURN_LOG=/tmp/ao-respawn-b2B6PC/agent.log /home/ryan/.nvm/versions/node/v22.22.0/bin/node /tmp/claude-1000/-home-ryan-Documents-GitHub-ByteDeskAI-bytedesk-marketplace--bytedesk-agent-orchestration-agents-fd2b831f/0070d3a6-ed13-49eb-bd23-58d49baf221e/scratchpad/wp/agent-orchestration/tests/fixtures/fake-turn-agent.mjs",
      "cwd": "/tmp/claude-1000/-home-ryan-Documents-GitHub-ByteDeskAI-bytedesk-marketplace--bytedesk-agent-orchestration-agents-fd2b831f/0070d3a6-ed13-49eb-bd23-58d49baf221e/scratchpad/wp/agent-orchestration (deleted)",
      "exe": "/usr/bin/tmux",
      "cgroup": "/user.slice/user-1000.slice/user@1000.service/app.slice/tmux-spawn-ff2fc42c-ed4f-462c-9338-1f5bb2a0f71e.scope",
      "rssMiB": 4,
      "swapMiB": 0,
      "threads": 1,
      "parentChain": [
        "2172501 tmux: server",
        "5760 systemd",
        "1 systemd"
      ],
      "ageMinutes": 33988
    },
    {
      "pid": 3264994,
      "ppid": 5760,
      "comm": "tmux: server",
      "cmdline": "tmux -S /tmp/aot-qcvDib/tmux-1000/default new-session -d -s agents1--app--worker--dot -e FAKE_TURN_LOG=/tmp/ao-respawn-otAy8L/agent.log /home/ryan/.nvm/versions/node/v22.22.0/bin/node /tmp/claude-1000/-home-ryan-Documents-GitHub-ByteDeskAI-bytedesk-marketplace--bytedesk-agent-orchestration-agents-fd2b831f/0070d3a6-ed13-49eb-bd23-58d49baf221e/scratchpad/wp/agent-orchestration/tests/fixtures/fake-turn-agent.mjs",
      "cwd": "/tmp/claude-1000/-home-ryan-Documents-GitHub-ByteDeskAI-bytedesk-marketplace--bytedesk-agent-orchestration-agents-fd2b831f/0070d3a6-ed13-49eb-bd23-58d49baf221e/scratchpad/wp/agent-orchestration (deleted)",
      "exe": "/usr/bin/tmux",
      "cgroup": "/user.slice/user-1000.slice/user@1000.service/app.slice/tmux-spawn-ff2fc42c-ed4f-462c-9338-1f5bb2a0f71e.scope",
      "rssMiB": 4,
      "swapMiB": 0,
      "threads": 1,
      "parentChain": [
        "3264994 tmux: server",
        "5760 systemd",
        "1 systemd"
      ],
      "ageMinutes": 33962
    }
  ],
  "count": 2,
  "totalRssMiB": 8
}
```

## How to check the fix
Run `/home/ryan/Documents/GitHub/ByteDeskAI/infrastructure/.claude/skills/process-evaluator/scripts/proceval.mjs scan` on mass-laptop01; this fingerprint should not reappear.