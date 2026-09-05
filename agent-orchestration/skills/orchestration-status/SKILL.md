---
name: orchestration-status
description: Inspect, troubleshoot, or stop a running tmux orchestration — which agents are alive, which replies are pending, what the journal shows, what an agent's screen says. Use when the user asks how a run is going, whether an agent is stuck, or wants to stop or clean up runs.
user-invokable: true
argument-hint: "[--run <run_dir>] [stop]"
---

# Status, troubleshooting, and stopping

Resolve `AO` as `../../bin/ao-topology` relative to this skill.

## Find the run

`AO runs --consumer <repo>` lists every run under `<repo>/.bytedesk/agent-orchestration/runs/` with a filled dot
for a live tmux session. The newest is usually the one the user means; confirm if two are live.

## Read the state

- `AO status --run <run_dir>` — agents, pane liveness, pending replies per agent, last journal
  events. Pending replies tell you who the conductor is waiting on.
- `AO journal --run <run_dir> --limit 100` — the full event stream: `message.sent`,
  `message.replied`, `wait.timeout`, `agent.nudged`, `run.stopped`.
- `AO capture --run <run_dir> --agent <id> --lines 100` — the agent's actual screen. This is the
  ground truth when the journal is quiet.
- Files: `<run_dir>/agents/<id>/inbox|outbox`, `<run_dir>/artifacts/`, `GATE-*.md`, `REPORT.md`.

## Diagnose common states

| Symptom | Likely cause | Action |
|---|---|---|
| Agent pane shows a login or trust prompt | CLI needs auth or workspace trust | Tell the user to answer it in tmux; then `AO nudge` the bootstrap pointer again |
| `wait.timeout` repeats, screen shows the agent mid-task | Slow work, not stuck | Conductor should wait again; say so |
| Screen shows the agent asking a question | It wants clarification | Answer through the conductor (`AO send`), or `AO nudge` a one-line answer if the operator prefers |
| Reply file exists but conductor still waiting | Wrong path or filename | Compare the inbox `reply_to` line with the outbox file name; move or rename, then the wait resolves |
| Agent pane shows usage limit / rate limit / quota | Provider stopped serving | `AO failover --run <run_dir> --agent <id>` moves it to the next provider in its chain and re-delivers unanswered messages |
| Pane dead (`○`) | CLI crashed or exited | `AO failover --run <run_dir> --agent <id> --to <current cli:model>` restarts the same provider in place; without `--to` it moves to the next one |
| `NO PROVIDER` in status | Every provider in the chain failed | Fix the underlying CLI (login, install) and `AO failover --agent <id> --to <cli:model>`; or stop and relaunch with a longer chain |
| Conductor idle at its prompt with a GATE file present | Waiting for the human | Tell the user where to answer: the conductor pane |

## Stop

`AO stop --run <run_dir>` kills the tmux session and marks the run stopped; every file stays. To
discard a run's files the user deletes `<run_dir>` themselves — never do it for them, the
artifacts are the evidence trail.
