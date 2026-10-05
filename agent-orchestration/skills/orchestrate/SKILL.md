---
name: orchestrate
description: Pick the right way to get work done by another agent, across agent-orchestration and task-management — dispatch a board task, drain the ready queue, ticket another repo, message one lead or all leads, wait for a reply, launch a team, ask another model, run a goal, check status or health, or mine for issues. Use when the user says "/orchestrate", "run this on another agent", "which skill do I use", "send this to the other repo", "tell the lead", "message all leads", "wait for the reply", "spin up a team", "what's running", or is unsure which of dispatch, pool, agent-orchestrate or orchestration-launch fits.
user-invokable: true
argument-hint: "[what you want done]"
---

# Orchestrate: one entry point

Two plugins can run work on another agent. They work alone or together:

- **task-management** (`tm`) owns the board: tasks, claims, workers it dispatches, tickets.
- **agent-orchestration** (`ao-topology`, `agent-orchestration`, `orchestration_*` MCP tools) owns
  agents: provider runs, tmux teams, repository leads, mail, services.

Find the user's intent below and go to that skill or verb. Do not run two of them for the same
work: a task that is dispatched must not also be launched as a team.

## Which one?

| I want to… | Use | Needs |
|---|---|---|
| Run one board task on a worker | `/task-management:dispatch` → `tm dispatch <TM-id>`; first `tm dispatch-check <TM-id>` so you do not start a second worker | tm |
| Run every `ready-for-agent` task | `/task-management:pool` → `tm pool status`, then `tm pool wait --until done <TM-id>` instead of a sleep loop | tm |
| Bring a dispatched worker's result back | `/task-management:collect` → `tm collect <TM-id>` | tm |
| Record a worker subagent I started myself | `tm claim note <TM-id> --worker <name>` so the claim is not reaped while it runs | tm |
| File work on another repository's board | `tm ticket <repo-path-or-slug> "<title>" --ac "<criterion>" --from-task <TM-id>` (MCP `tm_ticket`). Progress comes back as comments on the origin task | tm in both repos; AO optional (it mails the target lead) |
| Message one repository's lead | `ao-topology mailbox send --to-repo <repo-path-or-slug> --subject "<s>" --body "<text>"`; add `--dry-run` to preview who receives it (MCP `orchestration_mailbox_send`) | AO |
| Message every lead | `ao-topology mailbox send --to @all-leads --subject "<s>" --body "<text>"` (one send per lead; `--dry-run` first) | AO |
| Wait for a reply to that mail | `ao-topology mailbox wait <message-id> --timeout 20m` (exit 2 on timeout; MCP `orchestration_mailbox_wait`) | AO |
| Check whether a repository's lead is alive | `ao-topology lead status --cached` (answers from disk, rings nobody) | AO |
| Ask another model (Claude, Codex, Grok, Kimi) for a bounded job or competing reviews | `/agent-orchestration:agent-orchestrate` (MCP `orchestration_spawn`, `orchestration_wait`) | AO |
| Design a multi-agent team | `/agent-orchestration:orchestration-compose` | AO + tmux |
| Launch a saved team workflow | `/agent-orchestration:orchestration-launch` → `ao-topology launch --workflow <name>` | AO + tmux |
| Talk to agents inside a running team | `ao-topology send`, `ao-topology wait`, `ao-topology reply` (MCP `orchestration_run_mail_send`, `orchestration_run_mail_wait`, `orchestration_run_mail_reply`) | AO |
| Drive an admitted goal to proven criteria | `/agent-orchestration:goal-feedback-loop` (`tm goal show <EP-id> --json`, `ao-topology goal-loop list`) | both |
| See the board | `/task-management:board` → `tm board` | tm |
| See how a team run is going, or stop it | `/agent-orchestration:orchestration-status` → `ao-topology status --run <run_dir>` | AO |
| Wait for the managed services | `agent-orchestration services wait --until healthy --timeout 120` | AO |
| Check overall health | `/agent-orchestration:agent-orchestration-doctor`; for the store alone `tm doctor` | either |
| Find finished work nobody reviewed | `tm review-sweep` (`--apply` files the findings) | tm |
| Find recurring problems and improvements | `/task-management:enhance-mine` → `tm enhance-mine` (`--apply` files them) | tm |
| Pick a task-management flow (spec, map, tickets…) | `/task-management:route` | tm |

## When the other plugin is absent

Check first: `tm` is present when the repository has `.bytedesk/task-management/bin/tm`; AO is
present when `ao-topology` resolves (the `orchestration_*` tools are listed, or `tm caps` shows
the `topology` backend as available).

- **No agent-orchestration.** `tm dispatch` and `tm pool` still work through the `tmux` or `manual`
  backends. `tm ticket` still files the task on the target board; it reports that no mail was
  sent. Mail, leads, teams, provider runs and goal loops are unavailable: say so, and offer
  `tm ticket` or a manual hand-off instead.
- **No task-management.** There is no board, so there is nothing to dispatch, pool, ticket or
  sweep. Use `ao-topology mailbox send` to hand work to a lead, `/agent-orchestration:agent-orchestrate`
  for a bounded provider job, or `/agent-orchestration:orchestration-launch` for a team.
- **Neither.** Do the work in this session, or tell the user which plugin to install.

## Words that mean three things

| Word | task-management | agent-orchestration | elsewhere |
|---|---|---|---|
| route | `/task-management:route` picks a tm flow | MCP `orchestration_route` picks a provider and model | `/orchestrate` (this skill) picks between the plugins |
| cap | `tm cap` is the enhancement backlog (`CAP-nnn`) | MCP `orchestration_capabilities` lists providers | `tm caps` lists what this host can dispatch to |
| agent | `tm agent` is the dispatched-worker registry | `ao-topology agent` manages durable agent identities (lead, reviewer) | a host subagent (the Agent tool) is neither |

When a user says one of these words, ask yourself which column they mean before acting.
